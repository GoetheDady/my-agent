import { create } from "zustand";
import type { Message, DisplayBlock } from "../types";
import { useSessionStore } from "./sessionStore";

let abortController: AbortController | null = null;

let throttledTextBuffer = "";
let throttleTimer: ReturnType<typeof setTimeout> | null = null;

interface ChatState {
  messages: Message[];
  isLoading: boolean;
  streamingMessageId: string | null;
  streamingBlocks: DisplayBlock[];
  sessionId: string | null;

  sendMessage: (text: string) => void;
  abortRequest: () => void;
  clearMessages: () => void;
  loadSession: (sessionId: string) => Promise<void>;
  setSessionId: (id: string | null) => void;
}

function flushTextBuffer(set: (partial: Partial<ChatState>) => void, get: () => ChatState) {
  if (throttledTextBuffer === "") return;
  if (throttleTimer) {
    clearTimeout(throttleTimer);
    throttleTimer = null;
  }
  const state = get();
  const blocks = [...state.streamingBlocks];
  const last = blocks.at(-1);
  if (last && last.type === "text") {
    blocks[blocks.length - 1] = { ...last, content: last.content + throttledTextBuffer };
  } else {
    blocks.push({ type: "text", content: throttledTextBuffer });
  }
  throttledTextBuffer = "";
  set({ streamingBlocks: blocks });
}

function finalizeStream(
  set: (partial: Partial<ChatState>) => void,
  get: () => ChatState,
  streamingId: string,
  extraBlocks?: DisplayBlock[],
) {
  if (throttleTimer) {
    clearTimeout(throttleTimer);
    throttleTimer = null;
  }
  throttledTextBuffer = "";

  const s = get();
  if (s.streamingMessageId !== streamingId) return;

  const finalBlocks = extraBlocks
    ? [...s.streamingBlocks, ...extraBlocks]
    : s.streamingBlocks;

  if (finalBlocks.length > 0) {
    const assistantMsg: Message = {
      id: streamingId,
      role: "assistant",
      blocks: finalBlocks,
    };
    set({
      messages: [...s.messages, assistantMsg],
      isLoading: false,
      streamingMessageId: null,
      streamingBlocks: [],
    });
  } else {
    set({ isLoading: false, streamingMessageId: null, streamingBlocks: [] });
  }

  if (abortController) {
    abortController = null;
  }
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  isLoading: false,
  streamingMessageId: null,
  streamingBlocks: [],
  sessionId: null,

  sendMessage: (text: string) => {
    const state = get();
    if (state.isLoading) return;

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      blocks: [{ type: "text", content: text }],
    };

    const streamingId = crypto.randomUUID();
    set({
      messages: [...state.messages, userMsg],
      isLoading: true,
      streamingMessageId: streamingId,
      streamingBlocks: [],
    });

    throttledTextBuffer = "";
    if (throttleTimer) {
      clearTimeout(throttleTimer);
      throttleTimer = null;
    }

    const apiMessages = toApiMessages([...state.messages, userMsg]);

    const controller = new AbortController();
    abortController = controller;

    streamChat(
      apiMessages,
      get().sessionId,
      (eventType, data) => {
        switch (eventType) {
          case "text_delta": {
            throttledTextBuffer += data.content;
            if (!throttleTimer) {
              throttleTimer = setTimeout(() => {
                throttleTimer = null;
                flushTextBuffer(set, get);
              }, 50);
            }
            break;
          }
          case "thinking": {
            flushTextBuffer(set, get);
            // flushTextBuffer 内部 set 了新 streamingBlocks，必须重新 get
            const currentBlocks = [...get().streamingBlocks];
            const last = currentBlocks.at(-1);
            if (last && last.type === "thinking") {
              currentBlocks[currentBlocks.length - 1] = { ...last, content: last.content + data.content };
            } else {
              currentBlocks.push({ type: "thinking", content: data.content, collapsed: true });
            }
            set({ streamingBlocks: currentBlocks });
            break;
          }
          case "tool_start": {
            flushTextBuffer(set, get);
            const currentBlocks = [...get().streamingBlocks];
            currentBlocks.push({ type: "tool_use", content: "", toolName: data.name, toolUseId: data.id });
            set({ streamingBlocks: currentBlocks });
            break;
          }
          case "tool_done": {
            flushTextBuffer(set, get);
            const currentBlocks = [...get().streamingBlocks];
            const toolId = data.id;
            const idx = toolId
              ? currentBlocks.findLastIndex((b: DisplayBlock) => b.type === "tool_use" && b.toolUseId === toolId)
              : currentBlocks.findLastIndex((b: DisplayBlock) => b.type === "tool_use" && b.toolName === data.name);
            if (idx !== -1) {
              currentBlocks[idx] = { ...currentBlocks[idx], toolInput: data.input, content: JSON.stringify(data.input, null, 2) };
            }
            set({ streamingBlocks: currentBlocks });
            break;
          }
          case "done": {
            flushTextBuffer(set, get);
            if (data.sessionId) {
              const sid = data.sessionId as string;
              set({ sessionId: sid });
              useSessionStore.getState().fetchSessions();
              useSessionStore.getState().setActiveSessionId(sid);
            }
            break;
          }
          case "title_update": {
            useSessionStore.getState().fetchSessions();
            break;
          }
          case "error": {
            const errBlock: DisplayBlock = { type: "text", content: `错误: ${data.message}` };
            finalizeStream(set, get, streamingId, [errBlock]);
            break;
          }
        }
      },
      controller.signal,
    ).then(() => {
      finalizeStream(set, get, streamingId);
    }).catch(() => {
      // 兜底：未预期的异常，重置状态避免永久卡 isLoading
      const s = get();
      if (s.streamingMessageId === streamingId) {
        finalizeStream(set, get, streamingId);
      }
    });
  },

  abortRequest: () => {
    abortController?.abort();
    abortController = null;
    if (throttleTimer) {
      clearTimeout(throttleTimer);
      throttleTimer = null;
    }
    throttledTextBuffer = "";
    const s = get();
    // 保留已流式显示的内容作为不完整 assistant 消息
    if (s.streamingBlocks.length > 0) {
      const assistantMsg: Message = {
        id: s.streamingMessageId ?? crypto.randomUUID(),
        role: "assistant",
        blocks: [...s.streamingBlocks, { type: "text", content: "（已中断）" }],
      };
      set({
        messages: [...s.messages, assistantMsg],
        isLoading: false,
        streamingMessageId: null,
        streamingBlocks: [],
      });
    } else {
      set({
        isLoading: false,
        streamingMessageId: null,
        streamingBlocks: [],
      });
    }
  },

  clearMessages: () => {
    abortController?.abort();
    abortController = null;
    if (throttleTimer) {
      clearTimeout(throttleTimer);
      throttleTimer = null;
    }
    throttledTextBuffer = "";
    set({ messages: [], isLoading: false, streamingMessageId: null, streamingBlocks: [], sessionId: null });
  },

  loadSession: async (sessionId: string) => {
    const s = get();
    if (s.isLoading) return;
    const res = await fetch(`/api/sessions/${sessionId}/messages`);
    if (!res.ok) throw new Error("加载消息失败");
    const rawMessages = (await res.json()) as Array<{
      id: string;
      role: "user" | "assistant";
      content: string;
    }>;
    const messages: Message[] = rawMessages.map((m) => ({
      id: m.id,
      role: m.role,
      blocks: parseDbContent(m.content, m.role),
    }));
    set({ messages, sessionId, streamingMessageId: null, streamingBlocks: [] });
  },

  setSessionId: (id: string | null) => {
    set({ sessionId: id });
  },
}));

function toApiMessages(messages: Message[]) {
  return messages.map((msg) => {
    if (msg.role === "user") {
      return {
        role: "user" as const,
        content: msg.blocks.filter((b) => b.type === "text").map((b) => b.content).join("\n"),
      };
    }
    const content = msg.blocks
      .filter((b) => b.type !== "thinking")
      .map((b) => {
        if (b.type === "text") return { type: "text" as const, text: b.content };
        if (b.type === "tool_use") return { type: "tool_use" as const, id: b.toolUseId ?? "", name: b.toolName ?? "", input: b.toolInput ?? {} };
        return null;
      })
      .filter((b): b is NonNullable<typeof b> => b !== null);
    // assistant 消息过滤 thinking 后可能为空，Anthropic API 拒绝空 content
    if (content.length === 0) {
      return { role: "assistant" as const, content: [{ type: "text" as const, text: "" }] };
    }
    return { role: "assistant" as const, content };
  });
}

async function streamChat(
  messages: { role: string; content: unknown }[],
  sessionId: string | null,
  onEvent: (type: string, data: any) => void,
  signal: AbortSignal,
) {
  if (signal.aborted) return;

  let res: Response;
  try {
    res = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages, sessionId }),
      signal,
    });
  } catch (err) {
    if (signal.aborted) return;
    onEvent("error", { message: err instanceof Error ? err.message : "网络请求失败" });
    return;
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` })) as { error?: string; message?: string };
    onEvent("error", { message: err.error || err.message || `HTTP ${res.status}` });
    return;
  }

  if (!res.body) {
    onEvent("error", { message: "响应体为空" });
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";

      for (const part of parts) {
        const lines = part.split("\n");
        // SSE 规范："event:" 长度 6，冒号后可能无空格
        const eventType = lines.find((l) => l.startsWith("event:"))?.slice("event:".length).trim();
        const dataLine = lines.find((l) => l.startsWith("data:"));
        if (!eventType || !dataLine) continue;

        let data: Record<string, unknown>;
        try {
          data = JSON.parse(dataLine.slice("data:".length).trimStart());
        } catch {
          continue;
        }
        onEvent(eventType, data);
      }
    }

    // 处理 buffer 中可能残留的最后一个事件（后端漏掉末尾 \n\n 的场景）
    if (buffer.trim()) {
      const lines = buffer.split("\n");
      const eventType = lines.find((l) => l.startsWith("event:"))?.slice("event:".length).trim();
      const dataLine = lines.find((l) => l.startsWith("data:"));
      if (eventType && dataLine) {
        try {
          const data = JSON.parse(dataLine.slice("data:".length).trimStart());
          onEvent(eventType, data);
        } catch { /* 忽略解析失败 */ }
      }
    }
  } catch (err) {
    if (signal.aborted) return;
    onEvent("error", { message: err instanceof Error ? err.message : "连接中断" });
  }
}

function parseDbContent(contentStr: string, role: "user" | "assistant"): DisplayBlock[] {
  if (role === "user") {
    try {
      const parsed = JSON.parse(contentStr);
      return [{ type: "text", content: typeof parsed === "string" ? parsed : contentStr }];
    } catch {
      return [{ type: "text", content: contentStr }];
    }
  }
  try {
    const blocks = JSON.parse(contentStr) as Array<{ type: string; text?: string; name?: string; input?: Record<string, unknown> }>;
    return blocks
      .map((b) => {
        if (b.type === "text") return { type: "text" as const, content: b.text ?? "" };
        if (b.type === "tool_use") return { type: "tool_use" as const, content: JSON.stringify(b.input, null, 2), toolName: b.name, toolInput: b.input };
        return { type: "text" as const, content: "" };
      })
      .filter((b) => b.content !== "");
  } catch {
    return [{ type: "text", content: contentStr }];
  }
}
