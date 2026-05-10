import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useNavigate, useParams } from "react-router";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithApprovalResponses } from "ai";
import ChatInput from "../features/chat/ChatInput";
import MessageList from "../features/chat/MessageList";
import SessionSidebar from "../features/sessions/SessionSidebar";
import { createSessionResolver } from "../lib/sessionResolver";
import { getSessionPath } from "../lib/sessionRoute";
import { parseDbContent, useChatStore } from "../store/chatStore";
import { useSessionStore } from "../store/sessionStore";

export default function ChatPage() {
  const [sessionSidebarOpen, setSessionSidebarOpen] = useState(true);
  const navigate = useNavigate();
  const { sessionId: routeSessionId } = useParams<{ sessionId?: string }>();
  const { thinkingEnabled, setSessionId } = useChatStore();
  const fetchSessions = useSessionStore((s) => s.fetchSessions);
  const setActiveSessionId = useSessionStore((s) => s.setActiveSessionId);
  const workerPollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLoadingRef = useRef(false);

  const chatTransport = useMemo(() => new DefaultChatTransport({
    api: "/api/chat",
  }), []);

  const navigateToSession = useCallback((id: string, replace = false) => {
    navigate(getSessionPath(id), { replace });
  }, [navigate]);

  const navigateToNewSession = useCallback(() => {
    navigate("/");
  }, [navigate]);

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
  }), [fetchSessions, navigateToSession, setActiveSessionId, setSessionId]);

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
  }, [setActiveSessionId, setMessages, setSessionId]);

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

    async function syncFromRoute() {
      const id = routeSessionId ?? null;
      if (!id) {
        setMessages([]);
        useChatStore.getState().clearSession();
        setActiveSessionId(null);
        return;
      }

      const loaded = await loadSession(id);
      if (!loaded && !cancelled) {
        setMessages([]);
        useChatStore.getState().clearSession();
        setActiveSessionId(null);
        navigate("/", { replace: true });
      }
    }

    syncFromRoute();

    return () => {
      cancelled = true;
      stopWorkerMessagePolling();
    };
  }, [loadSession, navigate, routeSessionId, setActiveSessionId, setMessages, stopWorkerMessagePolling]);

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
  }, [sendMessage, sessionResolver, stopWorkerMessagePolling, thinkingEnabled]);

  const handleLoadSession = useCallback(async (id: string) => {
    const loaded = await loadSession(id);
    if (loaded) navigateToSession(id);
  }, [loadSession, navigateToSession]);

  const handleNewSession = useCallback(() => {
    stopWorkerMessagePolling();
    setMessages([]);
    useChatStore.getState().clearSession();
    navigateToNewSession();
  }, [navigateToNewSession, setMessages, stopWorkerMessagePolling]);

  const handleApprove = useCallback(async (toolCallId: string, rememberChoice: boolean) => {
    addToolApprovalResponse({
      id: toolCallId,
      approved: true,
    });

    if (rememberChoice && useChatStore.getState().sessionId) {
      try {
        await fetch("/api/tools/whitelist", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            toolCallId,
            sessionId: useChatStore.getState().sessionId,
          }),
        });
      } catch (error) {
        console.error("Failed to update whitelist:", error);
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
    <main className="flex min-h-0 flex-1 bg-[var(--color-bg)]">
      {sessionSidebarOpen && (
        <SessionSidebar onLoadSession={handleLoadSession} onNewSession={handleNewSession} />
      )}
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-3 border-b border-[var(--color-border-soft)] bg-white px-4 py-2">
          <button
            onClick={() => setSessionSidebarOpen(!sessionSidebarOpen)}
            className="flex h-9 w-9 items-center justify-center rounded-md text-[var(--color-text-muted)] hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text)]"
            title={sessionSidebarOpen ? "收起会话栏" : "展开会话栏"}
          >
            {sessionSidebarOpen ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
          </button>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-[var(--color-text)]">Control Chat</div>
            <div className="text-xs text-[var(--color-text-soft)]">
              长期记忆通过工具查询；后台 hook 会在助手消息保存后提取记忆。
            </div>
          </div>
        </div>
        <MessageList messages={messages} handleApprove={handleApprove} handleDeny={handleDeny} />
        <ChatInput
          isLoading={isLoading}
          onSend={handleSend}
          onStop={stop}
          thinkingEnabled={thinkingEnabled}
          onToggleThinking={() => useChatStore.getState().setThinkingEnabled(!thinkingEnabled)}
        />
      </section>
    </main>
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
