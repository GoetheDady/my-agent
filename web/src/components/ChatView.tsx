import { useState, useCallback, useEffect, useMemo } from "react";
import { Brain, PanelLeftClose, PanelLeftOpen, Settings } from "lucide-react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithApprovalResponses } from "ai";
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
    addToolApprovalResponse,
  } = useChat({
    transport: chatTransport,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
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

  const handleApprove = useCallback(async (toolCallId: string, rememberChoice: boolean) => {
    addToolApprovalResponse({
      id: toolCallId,
      approved: true,
    });

    if (rememberChoice && useChatStore.getState().sessionId) {
      try {
        await fetch('/api/tools/whitelist', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            toolCallId,
            sessionId: useChatStore.getState().sessionId,
          }),
        });
      } catch (error) {
        console.error('Failed to update whitelist:', error);
      }
    }
  }, [addToolApprovalResponse]);

  const handleDeny = useCallback((toolCallId: string) => {
    addToolApprovalResponse({
      id: toolCallId,
      approved: false,
    });
  }, [addToolApprovalResponse]);

  return (
    <div className="flex h-screen bg-[var(--color-bg)] text-[var(--color-text)]">
      {sidebarOpen && <SessionSidebar onLoadSession={handleLoadSession} onNewSession={handleNewSession} />}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex min-h-[56px] items-center gap-3 border-b border-[var(--color-border-soft)] bg-white/90 px-5 py-2.5 backdrop-blur">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="flex h-9 w-9 items-center justify-center rounded-md text-[var(--color-text-muted)] hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text)]"
            title={sidebarOpen ? "收起侧栏" : "展开侧栏"}
          >
            {sidebarOpen ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-[15px] font-semibold text-[var(--color-text)]">My Agent</h1>
              <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface-subtle)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-text-muted)]">
                Control Chat
              </span>
            </div>
            <p className="mt-0.5 text-xs text-[var(--color-text-soft)]">
              Chat first, configuration-ready agent workspace
            </p>
          </div>
          <button
            onClick={() => setMemoryOpen(true)}
            className="hidden items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text)] sm:flex"
            title="记忆管理"
          >
            <Brain size={18} />
            记忆
          </button>
          <button
            className="flex h-9 w-9 items-center justify-center rounded-md bg-[var(--color-accent)] text-white shadow-sm transition-colors hover:bg-[var(--color-accent-strong)]"
            title="配置"
          >
            <Settings size={17} />
          </button>
        </header>
        <MessageList messages={messages} memoryStatusMap={memoryStatusMap} handleApprove={handleApprove} handleDeny={handleDeny} />
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
