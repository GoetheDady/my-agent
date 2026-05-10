import { Hono } from "hono";
import { generateText } from "ai";
import { deepseek, createDeepSeek } from "@ai-sdk/deepseek";
import { createSession, appendMessage, getSession, updateSessionTitle, type SessionMessage } from "../channels/session-api";
import { getConfig } from "../core/config";
import { extractAssistantText, serializeAssistantPartsForStorage } from "../channels/message-parts";
import { AgentBusyError, runAgentTask, toAgentUiMessageStreamResponse, toModelMessages } from "../agents/agent-runner";
import { WebChannelAdapter } from "../channels/web-channel";
import { emitLifecycleHook } from "../lifecycle/hooks";

const app = new Hono();
const webChannel = new WebChannelAdapter();

app.get("/health", (c) => c.json({ status: "ok" }));

app.post("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body || !body.messages || body.messages.length === 0) {
    return c.json({ error: "消息为空" }, 400);
  }

  const { messages: uiMessages, sessionId, thinkingEnabled } = body;
  console.log("[chat] received sessionId:", sessionId, "type:", typeof sessionId);
  const capturedSessionId = sessionId ?? createSession().id;
  if (!sessionId) {
    console.log("[chat] WARNING: sessionId is null/undefined, creating new session:", capturedSessionId);
  }

  const lastUserMsg = [...uiMessages].reverse().find((m: { role: string }) => m.role === "user");
  const userText = (lastUserMsg as { parts?: Array<{ type: string; text?: string }>; content?: string } | undefined)?.parts
    ?.filter((p) => p.type === "text" && p.text)
    .map((p) => p.text!)
    .join("\n")
    ?? (typeof (lastUserMsg as { content?: string } | undefined)?.content === "string" ? (lastUserMsg as { content: string }).content : "")
    ?? "";

  const received = await webChannel.receive({
    externalConversationId: capturedSessionId,
    externalUserId: "default",
    text: userText,
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
