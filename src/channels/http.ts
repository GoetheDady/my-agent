/**
 * 信道系统 — HTTP + SSE 端点
 *
 * 职责：接收 HTTP POST 请求，调用 Agent Loop，以 SSE 流式返回打字机效果。
 *
 * 为什么用 Bun.serve 而不是 Express/Hono？
 *   MVP 阶段零依赖。Bun.serve 内置 HTTP 服务器 + ReadableStream + SSE 支持，
 *   20 行代码能完成，加框架反而增加依赖和复杂度。
 *
 * SSE 协议要点：
 *   - Content-Type: text/event-stream
 *   - 每个事件格式: "event: <type>\ndata: <json>\n\n"
 *   - 空行 "\n\n" 是事件分隔符，缺了客户端无法解析
 */

import { runLoop } from "../brain/loop";
import type { Message, ChatEvent } from "../brain/provider";

/** SSE 事件类型 */
type SSEEventType = "text_delta" | "thinking" | "tool_start" | "tool_done" | "done" | "error";

/** SSE 事件 */
interface SSEEvent {
  event: SSEEventType;
  data: unknown;
}

/**
 * 返回 JSON 错误响应
 *
 * 为什么 400 错误不用 SSE 格式返回？
 *   400 是请求格式错误，此时还没开始 SSE 流。
 *   返回 JSON 让客户端可以直接解析错误信息，而不是等一个不会来的 SSE 流。
 */
function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * 格式化 SSE 事件为协议文本
 *
 * 必须严格遵循 SSE 格式：event + data + 空行。
 * 如果 data 行缺少 '\n\n'，客户端会一直等待后续数据，事件永远不触发。
 */
function formatSSE(ev: SSEEvent): string {
  const json = JSON.stringify(ev.data);
  return `event: ${ev.event}\ndata: ${json}\n\n`;
}

/**
 * 启动 HTTP 服务
 *
 * 端点：
 *   POST /api/chat   - 发送消息，返回 SSE 流
 *   GET  /api/health  - 健康检查
 *   GET  /            - 前端页面（后续由 web/ 提供）
 */
export function serve(port: number = 3000) {
  // 默认系统提示——后续会从 agent 配置文件或 soul.md 读取
  const DEFAULT_SYSTEM_PROMPT = "你是一个有用的 AI 助手。使用中文回复。回答简洁明了。";

  Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);

      // 健康检查
      if (req.method === "GET" && url.pathname === "/api/health") {
        return new Response(JSON.stringify({ status: "ok" }), {
          headers: { "content-type": "application/json" },
        });
      }

      // 聊天端点
      if (req.method === "POST" && url.pathname === "/api/chat") {
        return handleChat(req, DEFAULT_SYSTEM_PROMPT);
      }

      // 前端页面
      if (req.method === "GET" && url.pathname === "/") {
        return serveIndex();
      }

      return new Response("Not Found", { status: 404 });
    },
  });

  console.log(`[server] 服务已启动: http://localhost:${port}`);
}

/**
 * 处理聊天请求
 *
 * 将 HTTP 请求体解析为消息，调用 Agent Loop，
 * 将流式事件转换为 SSE 格式逐条返回。
 */
async function handleChat(req: Request, defaultSystemPrompt: string): Promise<Response> {
  // 解析请求体
  let body: { message?: string; messages?: Message[] };
  try {
    body = await req.json();
  } catch {
    return jsonError("请求体必须是 JSON", 400);
  }

  // 构造消息列表
  // 支持两种格式：
  //   1. { message: "你好" } — 单条消息，简洁格式
  //   2. { messages: [...] } — 完整消息历史，用于多轮对话
  const messages: Message[] = body.messages ?? [
    { role: "user", content: body.message ?? "" },
  ];

  if (messages.length === 0) {
    return jsonError("消息为空", 400);
  }

  /**
   * SSE 流式响应
   *
   * 使用 ReadableStream + AbortSignal 实现可取消的 SSE 流。
   *
   * 客户端断开时：
   *   1. req.signal 触发 abort 事件
   *   2. 通过 iterator.return() 中止 runLoop 生成器
   *   3. runLoop 的 signal.aborted 检查 → 停止下一轮循环
   *   4. streamChat 的 fetch signal → 中止 HTTP 请求
   *   5. parseSSEStream 的 reader 自动释放
   *   全链路取消，不浪费 API token。
   */
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      // 获取 runLoop 的生成器句柄，同时用于迭代和中止
      // async function* 返回的 AsyncGenerator 既是 AsyncIterable 也有 .return() 方法
      const loopGen = runLoop({
        systemPrompt: defaultSystemPrompt,
        messages,
        signal: req.signal,
      });

      // 客户端断开时主动清理生成器
      // .return() 触发生成器的 finally 块（如果有），干净退出
      // 不调用 .return() 的话，生成器继续异步迭代，底层 fetch 继续运行
      const abortHandler = () => {
        (loopGen as { return?: () => void }).return?.();
        try { controller.close(); } catch { /* 已关闭 */ }
      };
      req.signal.addEventListener("abort", abortHandler, { once: true });

      try {
        for await (const event of loopGen) {
          if (req.signal.aborted) break;

          if (event.type === "loop_done") {
            // 最终事件：携带完整消息历史
            // 前端不需要这些信息（MVP 阶段前端不做持久化），跳过
            continue;
          }

          const sse = chatEventToSSE(event);
          if (sse) {
            controller.enqueue(encoder.encode(formatSSE(sse)));
          }
        }
      } catch (err) {
        if (!req.signal.aborted) {
          const message = err instanceof Error ? err.message : "未知错误";
          controller.enqueue(
            encoder.encode(
              formatSSE({ event: "error", data: { message } }),
            ),
          );
        }
      } finally {
        req.signal.removeEventListener("abort", abortHandler);
        try { controller.close(); } catch { /* 已关闭 */ }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      "connection": "keep-alive",
      // CORS：允许前端跨域访问
      "access-control-allow-origin": "*",
    },
  });
}

/**
 * 将 ChatEvent 转换为 SSE 事件
 *
 * SSE 事件类型比 ChatEvent 更简化——前端不需要关心内部细节。
 * "done" 事件触发后前端停止监听，关闭连接。
 *
 * 返回 null 表示该事件不需要通知前端（如 tool_use_delta 的中间状态）。
 */
function chatEventToSSE(event: ChatEvent): SSEEvent | null {
  switch (event.type) {
    case "text_delta":
      return { event: "text_delta", data: { content: event.content } };

    case "thinking_delta":
      return { event: "thinking", data: { content: event.content } };

    case "tool_use_start":
      return { event: "tool_start", data: { name: event.name } };

    case "tool_use_done":
      return { event: "tool_done", data: { name: event.name, input: event.input } };

    case "message_done":
      return {
        event: "done",
        data: {
          stopReason: event.stopReason,
          inputTokens: event.inputTokens,
          outputTokens: event.outputTokens,
        },
      };

    // 以下事件不需要通知前端
    case "thinking_done":
    case "tool_use_delta":
      return null;

    default:
      return null;
  }
}

/**
 * 返回前端页面（MVP 内嵌 HTML）
 *
 * 后续重构时此处改为代理到 web/ 目录或返回 SPA 入口。
 * MVP 阶段嵌入一个最小可用页面，避免额外的前端构建步骤。
 */
function serveIndex(): Response {
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>My Agent</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: system-ui, sans-serif; background: #1a1a2e; color: #e0e0e0; display: flex; justify-content: center; padding: 20px; }
  #app { width: 100%; max-width: 700px; display: flex; flex-direction: column; height: calc(100vh - 40px); }
  #messages { flex: 1; overflow-y: auto; padding: 10px; }
  .msg { margin: 8px 0; padding: 10px 14px; border-radius: 12px; max-width: 80%; }
  .msg.user { background: #16213e; margin-left: auto; }
  .msg.assistant { background: #0f3460; }
  .msg.thinking { background: #333; color: #999; font-style: italic; font-size: 0.9em; }
  .msg.tool { background: #1a3a1a; font-family: monospace; font-size: 0.85em; }
  #input-area { display: flex; gap: 10px; padding: 10px 0; }
  #input { flex: 1; padding: 12px; border-radius: 8px; border: 1px solid #333; background: #16213e; color: #e0e0e0; font-size: 16px; outline: none; }
  #input:focus { border-color: #533483; }
  #send { padding: 12px 20px; border-radius: 8px; border: none; background: #533483; color: white; font-size: 16px; cursor: pointer; }
  #send:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
</head>
<body>
<div id="app">
  <div id="messages"></div>
  <div id="input-area">
    <input id="input" type="text" placeholder="输入消息..." autofocus>
    <button id="send">发送</button>
  </div>
</div>
<script>
  const messages = document.getElementById("messages");
  const input = document.getElementById("input");
  const send = document.getElementById("send");

  function addMsg(role, text, cls) {
    const div = document.createElement("div");
    div.className = "msg " + (cls || role);
    div.textContent = text;
    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
  }

  async function sendMessage() {
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    send.disabled = true;

    addMsg("user", text);

    let currentText = "";
    let textDiv = null;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: text }),
      });

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\\n\\n");
        buffer = parts.pop();

        for (const part of parts) {
          const lines = part.split("\\n");
          const eventLine = lines.find(l => l.startsWith("event:"));
          const dataLine = lines.find(l => l.startsWith("data:"));
          if (!eventLine || !dataLine) continue;

          const eventType = eventLine.slice(7).trim();
          let data;
          try { data = JSON.parse(dataLine.slice(6)); } catch(e) { continue; }

          if (eventType === "text_delta") {
            if (!textDiv) {
              textDiv = document.createElement("div");
              textDiv.className = "msg assistant";
              messages.appendChild(textDiv);
            }
            currentText += data.content;
            textDiv.textContent = currentText;
            messages.scrollTop = messages.scrollHeight;
          } else if (eventType === "thinking") {
            addMsg("assistant", data.content, "thinking");
          } else if (eventType === "tool_start") {
            addMsg("assistant", "🔧 " + data.name, "tool");
          } else if (eventType === "done") {
            console.log("完成:", data.stopReason);
          }
        }
      }
    } catch (err) {
      addMsg("assistant", "错误: " + err.message, "error");
    } finally {
      send.disabled = false;
      input.focus();
    }
  }

  send.addEventListener("click", sendMessage);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") sendMessage(); });
</script>
</body>
</html>`;

  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
