import { create } from "zustand";
import type { Session } from "../types";

interface SessionState {
  sessions: Session[];
  activeSessionId: string | null;
  loading: boolean;

  fetchSessions: () => Promise<void>;
  createSession: (agentId?: string) => Promise<Session>;
  switchSession: (id: string) => void;
  deleteSession: (id: string) => Promise<void>;
  setActiveSessionId: (id: string | null) => void;
}

export const useSessionStore = create<SessionState>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  loading: false,

  fetchSessions: async () => {
    set({ loading: true });
    try {
      const res = await fetch("/api/sessions");
      if (!res.ok) throw new Error("获取会话列表失败");
      const sessions = (await res.json()) as Session[];
      set({ sessions, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  createSession: async (agentId = "default") => {
    const res = await fetch("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentId }),
    });
    if (!res.ok) throw new Error("创建会话失败");
    const session = (await res.json()) as Session;
    set((s) => ({
      sessions: [session, ...s.sessions],
      activeSessionId: session.id,
    }));
    return session;
  },

  switchSession: (id: string) => {
    set({ activeSessionId: id });
  },

  deleteSession: async (id: string) => {
    await fetch(`/api/sessions/${id}`, { method: "DELETE" });
    const s = get();
    const sessions = s.sessions.filter((ss) => ss.id !== id);
    const activeSessionId =
      s.activeSessionId === id ? null : s.activeSessionId;
    set({ sessions, activeSessionId });
  },

  setActiveSessionId: (id: string | null) => {
    set({ activeSessionId: id });
  },
}));
