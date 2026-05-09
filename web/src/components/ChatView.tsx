import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { Brain, PanelLeftClose, PanelLeftOpen, Settings } from "lucide-react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithApprovalResponses } from "ai";
import MessageList from "./MessageList";
import ChatInput from "./ChatInput";
import SessionSidebar from "./SessionSidebar";
import MemoryPanel from "./MemoryPanel";
import { useChatStore, parseDbContent } from "../store/chatStore";
import { useSessionStore } from "../store/sessionStore";
import { createSessionResolver } from "../lib/sessionResolver";
import { getSessionIdFromPath, getSessionPath } from "../lib/sessionRoute";

export default function ChatView() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const { thinkingEnabled, setSessionId } = useChatStore();
  const fetchSessions = useSessionStore((s) => s.fetchSessions);
  const setActiveSessionId = useSessionStore((s) => s.setActiveSessionId);
  const workerPollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLoadingRef = useRef(false);

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
    onFinish: () => {
      const currentSessionId = useChatStore.getState().sessionId;
      if (currentSessionId) {
        startWorkerMessagePolling(currentSessionId);
      }

      setTimeout(() => fetchSessions(), 2000);
    },
    onError: (error) => {
      console.error("Chat error:", error);
    },
  });

  const isLoading = status === "submitted" || status === "streaming";

  useEffect(() => {
    isLoadingRef.current = isLoading;
  }, [isLoading]);

  const stopWorkerMessagePolling = useCallback(() => {
    if (workerPollTimerRef.current) {
      clearTimeout(workerPollTimerRef.current);
      workerPollTimerRef.current = null;
    }
  }, []);

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

  const fetchSessionUiMessages = useCallback(async (id: string) => {
    const res = await fetch("/api/sessions/" + id + "/messages");
    if (!res.ok) return null;
    const rawMessages = await res.json() as Array<{ id: string; role: "user" | "assistant"; content: string }>;
    return rawMessages.map((m) => ({
      id: m.id,
      role: m.role,
      parts: parseDbContent(m.content, m.role),
    }));
  }, []);

  const startWorkerMessagePolling = useCallback((sessionId: string) => {
    stopWorkerMessagePolling();
    let attempts = 0;
    const maxAttempts = 75;

    const poll = async () => {
      attempts += 1;
      const activeSessionId = useChatStore.getState().sessionId;
      if (activeSessionId !== sessionId || isLoadingRef.current) {
        stopWorkerMessagePolling();
        return;
      }

      const uiMessages = await fetchSessionUiMessages(sessionId);
      if (uiMessages) {
        setMessages(uiMessages as Parameters<typeof setMessages>[0]);
        if (hasCompletedMemoryWorkerPart(uiMessages) || attempts >= maxAttempts) {
          stopWorkerMessagePolling();
          return;
        }
      }

      if (attempts >= maxAttempts) {
        stopWorkerMessagePolling();
        return;
      }
      workerPollTimerRef.current = setTimeout(poll, 1000);
    };

    workerPollTimerRef.current = setTimeout(poll, 700);
  }, [fetchSessionUiMessages, setMessages, stopWorkerMessagePolling]);

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
      stopWorkerMessagePolling();
      window.removeEventListener("popstate", syncFromLocation);
    };
  }, [loadSession, setMessages, stopWorkerMessagePolling]);

  const handleSend = useCallback(async (text: string) => {
    stopWorkerMessagePolling();
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
  }, [sendMessage, thinkingEnabled, sessionResolver, stopWorkerMessagePolling]);

  const handleLoadSession = useCallback(async (id: string) => {
    const loaded = await loadSession(id);
    if (loaded) navigateToSession(id);
  }, [loadSession, navigateToSession]);

  const handleNewSession = useCallback(() => {
    stopWorkerMessagePolling();
    setMessages([]);
    useChatStore.getState().clearSession();
    navigateToNewSession();
  }, [setMessages, navigateToNewSession, stopWorkerMessagePolling]);

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
        <MessageList messages={messages} handleApprove={handleApprove} handleDeny={handleDeny} />
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

function hasCompletedMemoryWorkerPart(messages: Array<{ role: string; parts: Array<{ type: string; state?: string }> }>): boolean {
  const latestAssistant = [...messages].reverse().find((message) => message.role === "assistant");
  if (!latestAssistant) return false;

  const workerParts = latestAssistant.parts.filter((part) =>
    part.type === "tool-memory_extract" || part.type === "tool-memory_reconsolidate"
  );
  if (workerParts.length === 0) return false;

  return workerParts.every((part) => part.state === "output-available" || part.state === "output-error");
}
