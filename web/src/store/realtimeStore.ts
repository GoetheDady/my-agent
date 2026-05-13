import { create } from "zustand";
import { useAgentStore } from "./agentStore";
import { useChatStore } from "./chatStore";
import { useRuntimeStore } from "./runtimeStore";
import { useSessionStore } from "./sessionStore";

export type RealtimeStatus = "disconnected" | "connecting" | "connected";

export interface RealtimeEvent {
  type: string;
  agentId?: string;
  sessionId?: string;
  taskId?: string;
  eventId?: string;
  delegationId?: string;
  payload?: unknown;
  createdAt: number;
}

interface RealtimeState {
  status: RealtimeStatus;
  error: string | null;
  lastEvent: RealtimeEvent | null;
  connect: () => void;
  disconnect: () => void;
  subscribe: (input?: { agentIds?: string[]; sessionIds?: string[] }) => void;
}

let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;
let subscription = { agentIds: [] as string[], sessionIds: [] as string[] };
let runtimeRefreshTimer: ReturnType<typeof setTimeout> | null = null;
let sessionRefreshTimer: ReturnType<typeof setTimeout> | null = null;

function buildWsUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/api/ws`;
}

function sendSubscribe(): void {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify({ type: "subscribe", ...subscription }));
}

function scheduleReconnect(connect: () => void): void {
  if (reconnectTimer) return;
  const delay = Math.min(1000 * 2 ** reconnectAttempts, 10_000);
  reconnectAttempts += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
}

function scheduleRuntimeRefresh(agentId?: string): void {
  if (runtimeRefreshTimer) return;
  runtimeRefreshTimer = setTimeout(() => {
    runtimeRefreshTimer = null;
    const selectedAgentId = agentId ?? useAgentStore.getState().selectedAgentId;
    void useRuntimeStore.getState().fetchRuntimeSnapshot(selectedAgentId);
  }, 120);
}

function scheduleSessionRefresh(): void {
  if (sessionRefreshTimer) return;
  sessionRefreshTimer = setTimeout(() => {
    sessionRefreshTimer = null;
    void useSessionStore.getState().fetchSessions();
  }, 120);
}

function handleRealtimeEvent(event: RealtimeEvent): void {
  if (event.type === "runtime.task.updated" || event.type === "runtime.event.created") {
    scheduleRuntimeRefresh(event.agentId);
  }
  if (event.type === "message.created" || event.type === "message.updated" || event.type === "session.updated") {
    scheduleSessionRefresh();
  }
  if (event.type === "realtime.connected" || event.type === "realtime.subscribed") {
    const agentId = useAgentStore.getState().selectedAgentId;
    void useRuntimeStore.getState().fetchRuntimeSnapshot(agentId);
    void useSessionStore.getState().fetchSessions();
  }
  if (event.type === "agent.updated" || event.type === "delegation.updated") {
    void useAgentStore.getState().fetchAgents();
    scheduleRuntimeRefresh(event.agentId);
  }
  if (event.type === "tool.approval.updated" || event.type === "channel.updated" || event.type === "memory.updated" || event.type === "skill.updated") {
    scheduleRuntimeRefresh(event.agentId);
  }
}

export const useRealtimeStore = create<RealtimeState>((set, get) => ({
  status: "disconnected",
  error: null,
  lastEvent: null,

  connect: () => {
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
    set({ status: "connecting", error: null });
    socket = new WebSocket(buildWsUrl());

    socket.onopen = () => {
      reconnectAttempts = 0;
      set({ status: "connected", error: null });
      sendSubscribe();
    };

    socket.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data) as RealtimeEvent;
        set({ lastEvent: event });
        handleRealtimeEvent(event);
      } catch {
        set({ error: "实时消息解析失败" });
      }
    };

    socket.onerror = () => {
      set({ error: "实时连接异常" });
    };

    socket.onclose = () => {
      socket = null;
      set({ status: "disconnected" });
      scheduleReconnect(get().connect);
    };
  },

  disconnect: () => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    socket?.close();
    socket = null;
    set({ status: "disconnected" });
  },

  subscribe: (input) => {
    subscription = {
      agentIds: input?.agentIds ?? [],
      sessionIds: input?.sessionIds ?? [],
    };
    sendSubscribe();
  },
}));

export function buildCurrentRealtimeSubscription(): { agentIds: string[]; sessionIds: string[] } {
  const selectedAgentId = useAgentStore.getState().selectedAgentId;
  const sessionId = useChatStore.getState().sessionId;
  return {
    agentIds: selectedAgentId ? [selectedAgentId] : [],
    sessionIds: sessionId ? [sessionId] : [],
  };
}
