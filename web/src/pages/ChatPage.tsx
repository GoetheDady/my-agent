import { useCallback, useEffect, useMemo, useRef, useState } from "react";
// No lucide-react imports needed anymore
import { useNavigate, useParams } from "react-router";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithApprovalResponses } from "ai";
import ChatInput from "../features/chat/ChatInput";
import MessageList from "../features/chat/MessageList";
import { createSessionResolver } from "../lib/sessionResolver";
import { getSessionPath } from "../lib/sessionRoute";
import { useAgentStore } from "../store/agentStore";
import { parseDbContent, useChatStore } from "../store/chatStore";
import { useRealtimeStore } from "../store/realtimeStore";
import { useRuntimeStore } from "../store/runtimeStore";
import { useSessionStore } from "../store/sessionStore";
import type { Session, ToolApprovalSummary } from "../types";

type RawSessionMessage = { id: string; role: "user" | "assistant"; content: string };
type SessionMessagesResponse =
  | RawSessionMessage[]
  | { session: Session; messages: RawSessionMessage[] };

export default function ChatPage() {
  const [approvals, setApprovals] = useState<Record<string, ToolApprovalSummary>>({});
  const [approvalLoading, setApprovalLoading] = useState<Record<string, boolean>>({});
  const [approvalErrors, setApprovalErrors] = useState<Record<string, string | null>>({});
  const navigate = useNavigate();
  const { sessionId: routeSessionId } = useParams<{ sessionId?: string }>();
  const { thinkingEnabled, setSessionId } = useChatStore();
  const selectedAgentId = useAgentStore((s) => s.selectedAgentId);
  const fetchAgents = useAgentStore((s) => s.fetchAgents);
  const setSelectedAgentId = useAgentStore((s) => s.setSelectedAgentId);
  const sessions = useSessionStore((s) => s.sessions);
  const fetchSessions = useSessionStore((s) => s.fetchSessions);
  const setActiveSessionId = useSessionStore((s) => s.setActiveSessionId);
  const fetchRuntimeSnapshot = useRuntimeStore((s) => s.fetchRuntimeSnapshot);
  const lastRealtimeEvent = useRealtimeStore((s) => s.lastEvent);
  const isLoadingRef = useRef(false);

  const chatTransport = useMemo(() => new DefaultChatTransport({
    api: "/api/chat",
  }), []);

  const navigateToSession = useCallback((id: string, replace = false) => {
    navigate(getSessionPath(id), { replace });
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
      void fetchSessions();
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
    };
  }, [loadSession, navigate, routeSessionId, setActiveSessionId, setMessages]);

  useEffect(() => {
    if (!lastRealtimeEvent) return;
    const currentSessionId = useChatStore.getState().sessionId;
    if (!currentSessionId) return;
    if (
      (lastRealtimeEvent.type === "message.created" || lastRealtimeEvent.type === "message.updated") &&
      lastRealtimeEvent.sessionId === currentSessionId &&
      !isLoadingRef.current
    ) {
      void fetchSessionUiMessages(currentSessionId).then((uiMessages) => {
        if (!uiMessages) return;
        if (useChatStore.getState().sessionId !== currentSessionId) return;
        setMessages(uiMessages as Parameters<typeof setMessages>[0]);
      });
    }
  }, [fetchSessionUiMessages, lastRealtimeEvent, setMessages]);

  const handleSend = useCallback(async (text: string) => {
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
  }, [sendMessage, sessionResolver, thinkingEnabled]);

  const registerApproval = useCallback(async (input: {
    toolCallId: string;
    toolName: string;
    args: Record<string, unknown>;
  }) => {
    if (!input.toolCallId || approvals[input.toolCallId] || approvalLoading[input.toolCallId]) return;
    const sessionId = useChatStore.getState().sessionId;
    const boundSession = useSessionStore.getState().sessions.find((session) => session.id === sessionId);
    const agentId = boundSession?.agent_id ?? useAgentStore.getState().selectedAgentId;
    setApprovalLoading((current) => ({ ...current, [input.toolCallId]: true }));
    setApprovalErrors((current) => ({ ...current, [input.toolCallId]: null }));
    try {
      const res = await fetch("/api/tools/approvals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agentId,
          sessionId,
          toolCallId: input.toolCallId,
          toolName: input.toolName,
          args: input.args,
        }),
      });
      const data = await res.json() as { approval?: ToolApprovalSummary; error?: string };
      if (!res.ok || !data.approval) {
        throw new Error(data.error ?? "创建工具审批失败");
      }
      const approval = data.approval;
      setApprovals((current) => ({ ...current, [input.toolCallId]: approval }));
    } catch (error) {
      setApprovalErrors((current) => ({
        ...current,
        [input.toolCallId]: error instanceof Error ? error.message : "创建工具审批失败",
      }));
    } finally {
      setApprovalLoading((current) => ({ ...current, [input.toolCallId]: false }));
    }
  }, [approvalLoading, approvals]);

  const handleApprove = useCallback(async (toolCallId: string, rememberChoice: boolean) => {
    const approval = approvals[toolCallId];
    if (approval) {
      try {
        const res = await fetch(`/api/tools/approvals/${encodeURIComponent(approval.id)}/approve`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ rememberChoice }),
        });
        const data = await res.json() as { approval?: ToolApprovalSummary; error?: string };
        if (!res.ok || !data.approval) throw new Error(data.error ?? "批准工具审批失败");
        const updatedApproval = data.approval;
        setApprovals((current) => ({ ...current, [toolCallId]: updatedApproval }));
      } catch (error) {
        setApprovalErrors((current) => ({
          ...current,
          [toolCallId]: error instanceof Error ? error.message : "批准工具审批失败",
        }));
        return;
      }
    }
    addToolApprovalResponse({
      id: toolCallId,
      approved: true,
    });
  }, [addToolApprovalResponse, approvals]);

  const handleDeny = useCallback(async (toolCallId: string) => {
    const approval = approvals[toolCallId];
    if (approval) {
      try {
        const res = await fetch(`/api/tools/approvals/${encodeURIComponent(approval.id)}/deny`, {
          method: "POST",
        });
        const data = await res.json() as { approval?: ToolApprovalSummary; error?: string };
        if (!res.ok || !data.approval) throw new Error(data.error ?? "拒绝工具审批失败");
        const updatedApproval = data.approval;
        setApprovals((current) => ({ ...current, [toolCallId]: updatedApproval }));
      } catch (error) {
        setApprovalErrors((current) => ({
          ...current,
          [toolCallId]: error instanceof Error ? error.message : "拒绝工具审批失败",
        }));
        return;
      }
    }
    addToolApprovalResponse({
      id: toolCallId,
      approved: false,
    });
  }, [addToolApprovalResponse, approvals]);

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--color-bg)]">
      <MessageList
        messages={messages}
        handleApprove={handleApprove}
        handleDeny={handleDeny}
        approvals={approvals}
        approvalLoading={approvalLoading}
        approvalErrors={approvalErrors}
        registerApproval={registerApproval}
      />
      <ChatInput
        isLoading={isLoading}
        onSend={handleSend}
        onStop={stop}
        thinkingEnabled={thinkingEnabled}
        onToggleThinking={() => useChatStore.getState().setThinkingEnabled(!thinkingEnabled)}
      />
    </section>
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
