export type AgentStatus = "idle" | "running" | "paused" | "error";

export interface AgentRecord {
  id: string;
  name: string;
  status: AgentStatus;
  current_task_id: string | null;
  workspace_path: string;
  created_at: number;
  updated_at: number;
}

export interface CreateAgentInput {
  agentId: string;
  name: string;
  description?: string;
  workspacePath?: string;
  model?: {
    provider?: string;
    model?: string;
  };
}

export interface UpdateAgentInput {
  name?: string;
  description?: string;
  workspacePath?: string;
}
