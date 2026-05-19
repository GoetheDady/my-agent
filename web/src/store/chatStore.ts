import { create } from "zustand";

export interface ChatMessagePart {
  type: string;
  text?: string;
  reasoning?: string;
  toolName?: string;
  toolCallId?: string;
  state?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
  approval?: { id?: string };
  toolInvocation?: { toolName: string; args: Record<string, unknown>; state?: string; toolCallId?: string };
}

export interface ChatMessage {
  id: string;
  role: string;
  parts: ChatMessagePart[];
}

interface ChatState {
  sessionId: string | null;
  thinkingEnabled: boolean;
  messages: ChatMessage[];

  setSessionId: (id: string | null) => void;
  setThinkingEnabled: (enabled: boolean) => void;
  setMessages: (messages: ChatMessage[] | ((messages: ChatMessage[]) => ChatMessage[])) => void;
  addMessage: (msg: ChatMessage) => void;
  updateMessage: (id: string, updater: (msg: ChatMessage) => ChatMessage) => void;
  appendToLastMessage: (text: string) => void;
  clearSession: () => void;
}

export const useChatStore = create<ChatState>((set) => ({
  sessionId: null,
  thinkingEnabled: false,
  messages: [],

  setSessionId: (id) => set({ sessionId: id }),
  setThinkingEnabled: (enabled) => set({ thinkingEnabled: enabled }),
  setMessages: (messages) => set((state) => ({
    messages: typeof messages === "function" ? messages(state.messages) : messages,
  })),
  addMessage: (msg) => set((state) => ({ messages: [...state.messages, msg] })),
  updateMessage: (id, updater) => set((state) => ({
    messages: state.messages.map((msg) => msg.id === id ? updater(msg) : msg),
  })),
  appendToLastMessage: (text) => set((state) => {
    const lastMessage = state.messages.at(-1);
    if (!lastMessage) return { messages: state.messages };
    const nextParts = lastMessage.parts.length > 0
      ? lastMessage.parts.map((part, index) => (
        index === lastMessage.parts.length - 1 && part.type === "text"
          ? { ...part, text: (part.text ?? "") + text }
          : part
      ))
      : [{ type: "text", text }];
    return {
      messages: [
        ...state.messages.slice(0, -1),
        { ...lastMessage, parts: nextParts },
      ],
    };
  }),
  clearSession: () => {
    set({ sessionId: null, messages: [] });
  },
}));

export function parseDbContent(contentStr: string, role: "user" | "assistant"): ChatMessagePart[] {
  if (role === "user") {
    try {
      const parsed = JSON.parse(contentStr);
      return [{ type: "text", text: typeof parsed === "string" ? parsed : contentStr }];
    } catch {
      return [{ type: "text", text: contentStr }];
    }
  }
  try {
    const blocks = JSON.parse(contentStr) as Array<{
      type: string;
      text?: string;
      thinking?: string;
      name?: string;
      id?: string;
      input?: Record<string, unknown>;
      output?: unknown;
      state?: string;
      toolCallId?: string;
      toolName?: string;
      errorText?: string;
      approval?: { id?: string };
      toolInvocation?: { toolName: string; args: Record<string, unknown>; state?: string; toolCallId?: string };
    }>;
    return blocks.map((b) => {
      if (b.type === "text") return { type: "text", text: b.text ?? "" };
      if (b.type === "thinking" || b.type === "reasoning") return { type: "reasoning", text: b.thinking ?? b.text ?? "", reasoning: b.thinking ?? b.text ?? "" };
      if (b.type.startsWith("tool-") || b.type === "dynamic-tool") {
        return {
          type: b.type,
          toolName: b.toolName,
          toolCallId: b.toolCallId,
          state: b.state,
          input: b.input,
          output: b.output,
          errorText: b.errorText,
          approval: b.approval,
        };
      }
      if (b.type === "tool-invocation" || b.type === "tool_use") {
        const invocation = b.toolInvocation ?? { toolName: b.name ?? "", args: b.input ?? {}, state: b.state, toolCallId: b.toolCallId ?? b.id };
        return { type: "tool-invocation", toolInvocation: invocation };
      }
      return { type: "text", text: "" };
    }).filter((b) => !(b.type === "text" && b.text === ""));
  } catch {
    return [{ type: "text", text: contentStr }];
  }
}
