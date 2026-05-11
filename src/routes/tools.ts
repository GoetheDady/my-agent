import { Hono } from "hono";
import { getConfig, saveConfig } from "../core/config";
import { getSessionMessages } from "../sessions/service";
import { normalizePath } from "../tools/service";

const app = new Hono();

function findToolCallById(messages: unknown[], toolCallId: string): { args: Record<string, unknown> } | null {
  // 从历史 assistant parts 里找对应工具调用参数。
  // 这个接口用于用户批准某个文件路径后，把路径加入工具白名单。
  for (const msg of messages) {
    const message = msg as { role: string; content: string };
    if (message.role !== 'assistant') continue;

    try {
      const parts = JSON.parse(message.content) as Array<{
        type: string;
        toolInvocation?: { toolCallId: string; args: Record<string, unknown> };
      }>;

      for (const part of parts) {
        if (part.type === 'tool-invocation' &&
            part.toolInvocation?.toolCallId === toolCallId) {
          return { args: part.toolInvocation.args };
        }
      }
    } catch {
      // 忽略解析错误
    }
  }

  return null;
}

app.post("/whitelist", async (c) => {
  // 白名单接口只根据已有工具调用里的 path 扩权，不接受任意 path 直接写入。
  // 这样用户是在具体上下文中授权，降低误把大目录放开的风险。
  const body = await c.req.json().catch(() => ({})) as {
    toolCallId?: string;
    sessionId?: string;
  };

  if (!body.toolCallId || !body.sessionId) {
    return c.json({ error: "缺少 toolCallId 或 sessionId" }, 400);
  }

  try {
    // 从会话消息中查找工具调用
    const messages = getSessionMessages(body.sessionId);
    const toolCall = findToolCallById(messages, body.toolCallId);

    if (!toolCall) {
      return c.json({ error: "工具调用不存在" }, 404);
    }

    // 提取路径参数
    const path = toolCall.args.path as string;
    if (!path) {
      return c.json({ error: "工具调用中没有 path 参数" }, 400);
    }

    const normalizedPath = normalizePath(path);

    // 更新配置
    const config = getConfig();
    if (!config.tools.allowedPaths.includes(normalizedPath)) {
      config.tools.allowedPaths.push(normalizedPath);
      saveConfig(config);
    }

    return c.json({ ok: true, path: normalizedPath });
  } catch (error) {
    return c.json({
      error: error instanceof Error ? error.message : "更新白名单失败"
    }, 500);
  }
});

export default app;
