export interface DisplayBlock {
  type: "text" | "thinking" | "tool_use";
  content: string;
  toolName?: string;
  toolUseId?: string;
  toolInput?: Record<string, unknown>;
  collapsed?: boolean;
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  blocks: DisplayBlock[];
}

export interface Session {
  id: string;
  agent_id: string;
  title: string;
  created_at: number;
  updated_at: number;
}

export type AgentStatus = "idle" | "running" | "paused" | "error";

export interface AgentConfigSummary {
  name: string;
  description: string;
  model: { provider: string; model: string };
  tools: { enabledToolsets: string[]; requiresApproval: string[]; allowedPaths: string[] };
  memory: { enabled: boolean; autoExtract: boolean; dreamEnabled: boolean };
  skills: {
    enabled: boolean;
    indexEnabled: boolean;
    enabledCount: number;
    disabledCount: number;
  };
}

export interface AgentSummary {
  id: string;
  name: string;
  status: AgentStatus;
  current_task_id: string | null;
  workspace_path: string;
  created_at: number;
  updated_at: number;
  config: AgentConfigSummary;
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
