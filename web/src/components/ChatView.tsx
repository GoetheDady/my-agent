import { useState, useCallback, useEffect, useMemo } from "react";
import { PanelLeft, PanelRight, Brain } from "lucide-react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import MessageList from "./MessageList";
import ChatInput from "./ChatInput";
import SessionSidebar from "./SessionSidebar";
import MemoryPanel from "./MemoryPanel";
import { useChatStore, triggerMemoryExtract, parseDbContent } from "../store/chatStore";
import { useSessionStore } from "../store/sessionStore";
import { createSessionResolver } from "../lib/sessionResolver";
import { getSessionIdFromPath, getSessionPath } from "../lib/sessionRoute";

export default function ChatView() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const { thinkingEnabled, setSessionId, memoryStatusMap } = useChatStore();
  const fetchSessions = useSessionStore((s) => s.fetchSessions);
  const setActiveSessionId = useSessionStore((s) => s.setActiveSessionId);

  const chatTransport = useMemo(() => new DefaultChatTransport({
    api: "/api/chat",
  }), []);

  const navigateToSession = useCallback((id: string, replace = false) => {
    const path = getSessionPath(id);
    if (window.location.pathname === path) return;
    window.history[replace ? "replaceState" : "pushState"](null, "", path);
  }, []);

  const navigateToNewSession = useCallback(() => {
    if (window.location.pathname === "/") return;
    window.history.pushState(null, "", "/");
  }, []);

  const sessionResolver = useMemo(() => createSessionResolver({
    getSessionId: () => useChatStore.getState().sessionId,
    setSessionId,
    setActiveSessionId,
    fetchSessions,
    createSession: async () => {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      if (!res.ok) throw new Error("创建会话失败");
      return await res.json() as { id: string };
    },
    onSessionCreated: (id) => navigateToSession(id, true),
  }), [setSessionId, setActiveSessionId, fetchSessions, navigateToSession]);

  const {
    messages,
    sendMessage,
    status,
    stop,
    setMessages,
  } = useChat({
    transport: chatTransport,
    onFinish: ({ message, messages: finishedMessages }) => {
      const currentSessionId = useChatStore.getState().sessionId;
      const lastUserMsg = [...finishedMessages].reverse().find((m) => m.role === "user");
      const userText = lastUserMsg?.parts
        ?.filter((p: { type: string; text?: string }) => p.type === "text" && typeof p.text === "string")
        .map((p: { type: string; text?: string }) => p.text ?? "")
        .join("\n") || "";
      const assistantText = message.parts
        ?.filter((p: { type: string; text?: string }) => p.type === "text" && typeof p.text === "string")
        .map((p: { type: string; text?: string }) => p.text ?? "")
        .join("\n") || "";

      if (userText && currentSessionId) {
        triggerMemoryExtract(message.id, userText, assistantText, currentSessionId, useChatStore.setState, useChatStore.getState);
      }

      setTimeout(() => fetchSessions(), 2000);
    },
    onError: (error) => {
      console.error("Chat error:", error);
    },
  });

  const isLoading = status === "submitted" || status === "streaming";

  const loadSession = useCallback(async (id: string) => {
    const res = await fetch("/api/sessions/" + id + "/messages");
    if (!res.ok) return false;
    const rawMessages = await res.json() as Array<{ id: string; role: "user" | "assistant"; content: string }>;
    const uiMessages = rawMessages.map((m) => ({
      id: m.id,
      role: m.role,
      parts: parseDbContent(m.content, m.role),
    }));
    setMessages(uiMessages as Parameters<typeof setMessages>[0]);
    setSessionId(id);
    setActiveSessionId(id);
    return true;
  }, [setMessages, setSessionId, setActiveSessionId]);

  useEffect(() => {
    let cancelled = false;

    async function syncFromLocation() {
      const id = getSessionIdFromPath(window.location.pathname);
      if (!id) {
        setMessages([]);
        useChatStore.getState().clearSession();
        return;
      }

      const loaded = await loadSession(id);
      if (!loaded && !cancelled) {
        setMessages([]);
        useChatStore.getState().clearSession();
        window.history.replaceState(null, "", "/");
      }
    }

    syncFromLocation();
    window.addEventListener("popstate", syncFromLocation);

    return () => {
      cancelled = true;
      window.removeEventListener("popstate", syncFromLocation);
    };
  }, [loadSession, setMessages]);

  const handleSend = useCallback(async (text: string) => {
    const currentSessionId = await sessionResolver.ensureSessionId();
    sendMessage(
      { text },
      {
        body: {
          sessionId: currentSessionId,
          thinkingEnabled,
        },
      },
    );
  }, [sendMessage, thinkingEnabled, sessionResolver]);

  const handleLoadSession = useCallback(async (id: string) => {
    const loaded = await loadSession(id);
    if (loaded) navigateToSession(id);
  }, [loadSession, navigateToSession]);

  const handleNewSession = useCallback(() => {
    setMessages([]);
    useChatStore.getState().clearSession();
    navigateToNewSession();
  }, [setMessages, navigateToNewSession]);

  return (
    <div className="flex h-screen bg-[var(--color-bg)]">
      {sidebarOpen && <SessionSidebar onLoadSession={handleLoadSession} onNewSession={handleNewSession} />}

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
