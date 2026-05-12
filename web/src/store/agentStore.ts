import { create } from "zustand";
import type { AgentSummary, CreateAgentInput } from "../types";

interface AgentState {
  agents: AgentSummary[];
  selectedAgentId: string;
  loading: boolean;
  error: string | null;

  fetchAgents: () => Promise<void>;
  createAgent: (input: CreateAgentInput) => Promise<AgentSummary>;
  setSelectedAgentId: (agentId: string) => void;
}

function normalizeAgentId(agentId: string): string {
  return agentId.trim() || "default";
}

export const useAgentStore = create<AgentState>((set, get) => ({
  agents: [],
  selectedAgentId: "default",
  loading: false,
  error: null,

  fetchAgents: async () => {
    set({ loading: true, error: null });
    try {
      const res = await fetch("/api/agents");
      if (!res.ok) throw new Error("获取 Agent 列表失败");
      const data = await res.json() as { agents: AgentSummary[] };
      const agents = data.agents ?? [];
      const selectedAgentId = agents.some((agent) => agent.id === get().selectedAgentId)
        ? get().selectedAgentId
        : agents[0]?.id ?? "default";
      set({ agents, selectedAgentId, loading: false, error: null });
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : "获取 Agent 列表失败",
      });
    }
  },

  createAgent: async (input) => {
    const res = await fetch("/api/agents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({})) as { error?: string };
      throw new Error(data.error ?? "创建 Agent 失败");
    }
    const created = await res.json() as { agent: Omit<AgentSummary, "config">; config: AgentSummary["config"] };
    const agent = { ...created.agent, config: created.config };
    await get().fetchAgents();
    set({ selectedAgentId: agent.id, error: null });
    return agent;
  },

  setSelectedAgentId: (agentId) => {
    set({ selectedAgentId: normalizeAgentId(agentId) });
  },
}));
