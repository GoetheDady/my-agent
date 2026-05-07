import { useState, useCallback, useMemo } from "react";
import { PanelLeft, PanelRight, Brain } from "lucide-react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import MessageList from "./MessageList";
import ChatInput from "./ChatInput";
import SessionSidebar from "./SessionSidebar";
import MemoryPanel from "./MemoryPanel";
import { useChatStore, triggerMemoryExtract, parseDbContent } from "../store/chatStore";
import { useSessionStore } from "../store/sessionStore";

export default function ChatView() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const { sessionId, thinkingEnabled, setSessionId, memoryStatusMap } = useChatStore();
  const fetchSessions = useSessionStore((s) => s.fetchSessions);
  const setActiveSessionId = useSessionStore((s) => s.setActiveSessionId);

  const chatTransport = useMemo(() => new DefaultChatTransport({
    api: "/api/chat",
  }), []);

  const {
    messages,
    sendMessage,
    status,
    stop,
    setMessages,
  } = useChat({
    transport: chatTransport,
    onFinish: ({ message }) => {
      const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
      const userText = lastUserMsg?.parts
        ?.filter((p: { type: string; text?: string }) => p.type === "text" && typeof p.text === "string")
        .map((p: { type: string; text?: string }) => p.text ?? "")
        .join("\n") || "";
      const assistantText = message.parts
        ?.filter((p: { type: string; text?: string }) => p.type === "text" && typeof p.text === "string")
        .map((p: { type: string; text?: string }) => p.text ?? "")
        .join("\n") || "";

      if (userText && sessionId) {
        triggerMemoryExtract(message.id, userText, assistantText, sessionId, useChatStore.setState, useChatStore.getState);
      }

      setTimeout(() => fetchSessions(), 2000);
    },
    onError: (error) => {
      console.error("Chat error:", error);
    },
  });

  const isLoading = status === "submitted" || status === "streaming";

  const handleSend = useCallback((text: string) => {
    sendMessage(
      { text },
      {
        body: {
          sessionId,
          thinkingEnabled,
        },
      },
    );
  }, [sendMessage, sessionId, thinkingEnabled]);

  const handleLoadSession = useCallback(async (id: string) => {
    const res = await fetch("/api/sessions/" + id + "/messages");
    if (!res.ok) return;
    const rawMessages = await res.json() as Array<{ id: string; role: "user" | "assistant"; content: string }>;
    const uiMessages = rawMessages.map((m) => ({
      id: m.id,
      role: m.role,
      parts: parseDbContent(m.content, m.role),
    }));
    setMessages(uiMessages as Parameters<typeof setMessages>[0]);
    setSessionId(id);
    setActiveSessionId(id);
  }, [setMessages, setSessionId, setActiveSessionId]);

  return (
    <div className="flex h-screen bg-[var(--color-bg)]">
      {sidebarOpen && <SessionSidebar onLoadSession={handleLoadSession} />}

      <div className="flex flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-white/10 bg-[var(--color-surface)] px-6 py-3">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="text-white/60 hover:text-white"
            title={sidebarOpen ? "收起侧栏" : "展开侧栏"}
          >
            {sidebarOpen ? <PanelLeft size={18} /> : <PanelRight size={18} />}
          </button>
          <h1 className="text-lg font-semibold text-[var(--color-text)]">
            My Agent
          </h1>
          <button
            onClick={() => setMemoryOpen(true)}
            className="text-white/60 hover:text-white transition-colors"
            title="记忆管理"
          >
            <Brain size={18} />
          </button>
        </header>
        <MessageList messages={messages} memoryStatusMap={memoryStatusMap} />
        <ChatInput
          isLoading={isLoading}
          onSend={handleSend}
          onStop={stop}
          thinkingEnabled={thinkingEnabled}
          onToggleThinking={() => useChatStore.getState().setThinkingEnabled(!thinkingEnabled)}
        />
      </div>
      {memoryOpen && <MemoryPanel onClose={() => setMemoryOpen(false)} />}
    </div>
  );
}
