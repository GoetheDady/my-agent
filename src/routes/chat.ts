import { Hono } from "hono";
import { generateText } from "ai";
import { deepseek, createDeepSeek } from "@ai-sdk/deepseek";
import { createSession, appendMessage, getSession, updateSessionTitle, type SessionMessage } from "../sessions/service";
import { getConfig } from "../core/config";
import { extractAssistantText, serializeAssistantPartsForStorage } from "../channels/message-parts";
import { AgentBusyError, runAgentTask, toAgentUiMessageStreamResponse, toModelMessages } from "../runtime/agent-runtime";
import { defaultChannelService } from "../channels/service";
import { emitLifecycleHook } from "../lifecycle/hooks";

const app = new Hono();

app.get("/health", (c) => c.json({ status: "ok" }));

/**
 * Chat 主入口流程：
 * 1. 前端先确保 sessionId 存在，再把 UI messages 发到这里。
 * 2. ChannelService 把 Web 会话消息转换为内部 task，并写入 user.message 事件。
 * 3. runAgentTask 接管 Agent 串行执行、工具调用和模型流式输出。
 * 4. 流结束后把助手消息写入 sessions/messages，再触发 assistant.message.persisted hook。
 * 5. 记忆提取 worker 由 hook 异步触发，不阻塞用户看到助手回复。
 */
app.post("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body || !body.messages || body.messages.length === 0) {
    return c.json({ error: "消息为空" }, 400);
  }

  const { messages: uiMessages, sessionId, thinkingEnabled, agentId } = body;
  console.log("[chat] received sessionId:", sessionId, "type:", typeof sessionId);
  const requestedAgentId = typeof agentId === "string" && agentId.trim() ? agentId.trim() : "default";
  // 理想情况下前端永远传 sessionId；这里保留兜底，避免旧客户端直接请求时崩溃。
  const session = typeof sessionId === "string" && sessionId.trim()
    ? getSession(sessionId)
    : createSession({ agentId: requestedAgentId });
  if (!session) {
    return c.json({ error: "Session not found" }, 404);
  }
  if (typeof agentId === "string" && agentId.trim() && agentId.trim() !== session.agent_id) {
    return c.json({
      error: "agentId 与 session 绑定的 Agent 不一致",
      sessionAgentId: session.agent_id,
      requestedAgentId: agentId.trim(),
    }, 400);
  }
  const capturedSessionId = session.id;
  const targetAgentId = session.agent_id;
  if (!sessionId) {
    console.log("[chat] WARNING: sessionId is null/undefined, creating new session:", capturedSessionId);
  }

  // 只取最后一条用户消息作为本轮 task 输入；历史上下文仍由 uiMessages 转成模型消息传入。
  const lastUserMsg = [...uiMessages].reverse().find((m: { role: string }) => m.role === "user");
  const userText = (lastUserMsg as { parts?: Array<{ type: string; text?: string }>; content?: string } | undefined)?.parts
    ?.filter((p) => p.type === "text" && p.text)
    .map((p) => p.text!)
    .join("\n")
    ?? (typeof (lastUserMsg as { content?: string } | undefined)?.content === "string" ? (lastUserMsg as { content: string }).content : "")
    ?? "";

  const received = defaultChannelService.receiveMessage({
    channel: "web",
    externalConversationId: capturedSessionId,
    externalUserId: "default",
    text: userText,
    agentId: targetAgentId,
  });
  const { task } = received;

  const modelMessages = await toModelMessages(body.messages as Array<{ role: string; parts?: unknown; content?: unknown }>);

  let persisted = false;
  let run;
  try {
    run = runAgentTask({
      task,
      messages: modelMessages,
      thinkingEnabled,
      abortSignal: c.req.raw.signal,
    });
  } catch (error) {
    if (error instanceof AgentBusyError) {
      return c.json({ queued: true, taskId: task.id }, 202);
    }
    throw error;
  }

  return toAgentUiMessageStreamResponse(run, ({ responseMessage }) => {
      if (persisted) return;
      persisted = true;
      const persistedAssistant = persistUiConversation(capturedSessionId, userText, responseMessage);
      if (persistedAssistant) {
        // 选择“消息已落库”作为生命周期点，是因为后台 worker 需要 assistantMessageId
        // 才能把 memory_extract / memory_reconsolidate 合成工具卡挂回对应消息。
        emitLifecycleHook({
          type: "assistant.message.persisted",
          agentId: task.agent_id,
          userId: task.source_user_id,
          taskId: task.id,
          conversationId: task.conversation_id,
          sessionId: capturedSessionId,
          assistantMessageId: persistedAssistant.id,
          userText,
          assistantText: persistedAssistant.assistantText,
          createdAt: Date.now(),
        });
      }
  });
});

function persistUiConversation(
  sessionId: string,
  userText: string,
  responseMessage: unknown,
): (SessionMessage & { assistantText: string }) | null {
  if (userText) {
    appendMessage(sessionId, "user", userText);
  }

  const parts = serializeAssistantPartsForStorage((responseMessage as { parts?: unknown[] } | undefined)?.parts);
  const assistantText = extractAssistantText(parts);

  // messages.content 存储的是结构化 parts JSON，不能只存纯文本，否则历史工具卡会丢失。
  const assistantMessage = parts.length > 0
    ? appendMessage(sessionId, "assistant", JSON.stringify(parts))
    : null;

  ensureFallbackTitle(sessionId, userText);
  void generateAndSaveTitle(sessionId, userText, assistantText);

  return assistantMessage ? { ...assistantMessage, assistantText } : null;
}

function buildFallbackTitle(userMessage: string): string {
  const normalized = userMessage
    .replace(/\s+/g, " ")
    .replace(/^["""'「『]+|["""'」』]+$/g, "")
    .trim();
  if (!normalized) return "新对话";
  return normalized.slice(0, 20);
}

function ensureFallbackTitle(sessionId: string, userMessage: string): void {
  const session = getSession(sessionId);
  if (!session || session.title !== "新对话") return;

  const title = buildFallbackTitle(userMessage);
  if (title !== "新对话") {
    updateSessionTitle(sessionId, title);
  }
}

async function generateAndSaveTitle(sessionId: string, userMessage: string, assistantText: string): Promise<void> {
  try {
    const config = getConfig();
    const provider = config.provider.baseURL
      ? createDeepSeek({ baseURL: config.provider.baseURL })
      : deepseek;
    const model = provider(config.provider.model);

    // 标题生成是辅助体验，失败时只记录 warn，不能影响主对话保存。
    const prompt = assistantText
      ? `根据以下对话，生成一个简短的标题（不超过20个字，不要引号和句号）：\n用户：${userMessage}\n助手：${assistantText}`
      : `根据以下用户消息，生成一个简短的标题（不超过20个字，不要引号和句号）：\n${userMessage}`;

    const { text: title } = await generateText({
      model,
      system: "你是标题生成器。只返回标题文本，不要任何额外内容。",
      prompt,
      maxOutputTokens: 50,
      abortSignal: AbortSignal.timeout(8000),
    });

    const cleaned = title.trim().replace(/^["""']+|["""']+$/g, "").slice(0, 30);
    if (cleaned && cleaned !== "新对话") {
      updateSessionTitle(sessionId, cleaned);
    }
  } catch (err) {
    console.warn("[chat] title generation failed:", err);
  }
}

export default app;
