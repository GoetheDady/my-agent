import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bot, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useNavigate, useParams } from "react-router";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithApprovalResponses } from "ai";
import ChatInput from "../features/chat/ChatInput";
import MessageList from "../features/chat/MessageList";
import SessionSidebar from "../features/sessions/SessionSidebar";
import { createSessionResolver } from "../lib/sessionResolver";
import { getSessionPath } from "../lib/sessionRoute";
import { useAgentStore } from "../store/agentStore";
import { parseDbContent, useChatStore } from "../store/chatStore";
import { useRuntimeStore } from "../store/runtimeStore";
import { useSessionStore } from "../store/sessionStore";
import type { Session } from "../types";

type RawSessionMessage = { id: string; role: "user" | "assistant"; content: string };
type SessionMessagesResponse =
  | RawSessionMessage[]
  | { session: Session; messages: RawSessionMessage[] };

export default function ChatPage() {
  const [sessionSidebarOpen, setSessionSidebarOpen] = useState(true);
  const navigate = useNavigate();
  const { sessionId: routeSessionId } = useParams<{ sessionId?: string }>();
  const { thinkingEnabled, setSessionId } = useChatStore();
  const agents = useAgentStore((s) => s.agents);
  const selectedAgentId = useAgentStore((s) => s.selectedAgentId);
  const fetchAgents = useAgentStore((s) => s.fetchAgents);
  const setSelectedAgentId = useAgentStore((s) => s.setSelectedAgentId);
  const agentLoading = useAgentStore((s) => s.loading);
  const agentError = useAgentStore((s) => s.error);
  const sessions = useSessionStore((s) => s.sessions);
  const fetchSessions = useSessionStore((s) => s.fetchSessions);
  const setActiveSessionId = useSessionStore((s) => s.setActiveSessionId);
  const fetchRuntimeSnapshot = useRuntimeStore((s) => s.fetchRuntimeSnapshot);
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
      return await useSessionStore.getState().createSession(useAgentStore.getState().selectedAgentId);
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

  useEffect(() => {
    void fetchAgents();
  }, [fetchAgents]);

  useEffect(() => {
    void fetchRuntimeSnapshot(selectedAgentId);
  }, [fetchRuntimeSnapshot, selectedAgentId]);

  const stopWorkerMessagePolling = useCallback(() => {
    if (workerPollTimerRef.current) {
      clearTimeout(workerPollTimerRef.current);
      workerPollTimerRef.current = null;
    }
  }, []);

  const loadSession = useCallback(async (id: string) => {
    const res = await fetch("/api/sessions/" + id + "/messages");
    if (!res.ok) return false;
    const data = await res.json() as SessionMessagesResponse;
    const { session, messages: rawMessages } = normalizeSessionMessages(data, id, sessions);
    const uiMessages = rawMessages.map((m) => ({
      id: m.id,
      role: m.role,
      parts: parseDbContent(m.content, m.role),
    }));
    setMessages(uiMessages as Parameters<typeof setMessages>[0]);
    setSessionId(id);
    setActiveSessionId(id);
    setSelectedAgentId(session.agent_id);
    void fetchRuntimeSnapshot(session.agent_id);
    return true;
  }, [fetchRuntimeSnapshot, sessions, setActiveSessionId, setMessages, setSelectedAgentId, setSessionId]);

  const fetchSessionUiMessages = useCallback(async (id: string) => {
    const res = await fetch("/api/sessions/" + id + "/messages");
    if (!res.ok) return null;
    const data = await res.json() as SessionMessagesResponse;
    const { messages: rawMessages } = normalizeSessionMessages(data, id, useSessionStore.getState().sessions);
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
    const boundSession = useSessionStore.getState().sessions.find((session) => session.id === currentSessionId);
    const boundAgentId = boundSession?.agent_id ?? useAgentStore.getState().selectedAgentId;
    sendMessage(
      { text },
      {
        body: {
          sessionId: currentSessionId,
          agentId: boundAgentId,
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

  const handleAgentChange = useCallback((agentId: string) => {
    setSelectedAgentId(agentId);
    void fetchRuntimeSnapshot(agentId);
    if (useChatStore.getState().sessionId) {
      stopWorkerMessagePolling();
      setMessages([]);
      useChatStore.getState().clearSession();
      setActiveSessionId(null);
      navigateToNewSession();
    }
  }, [
    fetchRuntimeSnapshot,
    navigateToNewSession,
    setActiveSessionId,
    setMessages,
    setSelectedAgentId,
    stopWorkerMessagePolling,
  ]);

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
        <SessionSidebar
          selectedAgentId={selectedAgentId}
          onLoadSession={handleLoadSession}
          onNewSession={handleNewSession}
        />
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
              当前 Agent：{selectedAgentId}；新会话会绑定到选中的 Agent。
            </div>
          </div>
          <label className="flex items-center gap-2 rounded-lg border border-[var(--color-border-soft)] bg-[var(--color-surface-subtle)] px-3 py-2">
            <Bot size={16} className="text-[var(--color-accent)]" />
            <span className="text-xs font-semibold text-[var(--color-text-muted)]">Agent</span>
            <select
              value={selectedAgentId}
              onChange={(event) => handleAgentChange(event.target.value)}
              disabled={agentLoading || agents.length === 0}
              className="max-w-[220px] bg-transparent text-sm font-semibold text-[var(--color-text)] outline-none disabled:text-[var(--color-text-soft)]"
              title="选择对话 Agent"
            >
              {agents.length === 0 ? (
                <option value={selectedAgentId}>{agentLoading ? "加载中" : selectedAgentId}</option>
              ) : agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.config.name || agent.name} ({agent.id})
                </option>
              ))}
            </select>
          </label>
          {agentError && (
            <div className="max-w-[240px] truncate rounded-lg bg-[var(--color-danger-soft)] px-3 py-2 text-xs text-[var(--color-danger)]">
              {agentError}
            </div>
          )}
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

function normalizeSessionMessages(
  data: SessionMessagesResponse,
  sessionId: string,
  sessions: Session[],
): { session: Session; messages: RawSessionMessage[] } {
  if (Array.isArray(data)) {
    return {
      session: sessions.find((session) => session.id === sessionId) ?? {
        id: sessionId,
        agent_id: "default",
        title: "新对话",
        created_at: 0,
        updated_at: 0,
      },
      messages: data,
    };
  }
  return data;
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
