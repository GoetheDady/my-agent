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

export type ChannelStatus = "enabled" | "not_configured" | "reserved";

export interface ChannelSummary {
  id: "web" | "feishu" | "wechat" | string;
  name: string;
  status: ChannelStatus;
  bindingCount: number;
  enabledCount: number;
  runningCount: number;
  transport?: string;
}

export interface FeishuBindingSummary {
  appId: string;
  agentId: string;
  domain: "feishu" | "lark";
  enabled: boolean;
  openId?: string;
  botName?: string;
  botOpenId?: string;
  createdAt: number;
  updatedAt: number;
  hasAppSecret: boolean;
  hasVerificationToken: boolean;
  hasEncryptKey: boolean;
  websocketStatus: "running" | "stopped";
}

export type FeishuOnboardingStatus = "pending" | "succeeded" | "failed" | "expired" | "canceled";

export interface FeishuOnboardingState {
  onboardingId: string;
  agentId: string;
  domain: "feishu" | "lark";
  status: FeishuOnboardingStatus;
  qrUrl: string;
  userCode: string;
  expiresAt: number;
  createdAt: number;
  updatedAt: number;
  error?: string;
  binding?: FeishuBindingSummary;
}

export type ToolRiskLevel = "low" | "medium" | "high";
export type ToolApprovalStatus = "pending" | "approved" | "denied" | "expired";

export interface ToolApprovalSummary {
  id: string;
  agentId: string;
  sessionId: string | null;
  taskId: string | null;
  channel: string | null;
  conversationId: string | null;
  externalConversationId: string | null;
  externalUserId: string | null;
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  riskLevel: ToolRiskLevel;
  reason: string;
  status: ToolApprovalStatus;
  rememberChoice: boolean;
  createdAt: number;
  resolvedAt: number | null;
}

export interface ToolPolicySummary {
  enabledToolsets: string[];
  requiresApproval: string[];
  allowedPaths: string[];
}

export interface RegisteredToolSummary {
  name: string;
  toolset: string;
  category: "read" | "write" | "memory_read" | "memory_write";
  defaultEnabled?: boolean;
  requiresApproval: boolean;
}

export interface ToolsetSummary {
  name: string;
  description: string;
  tools: string[];
  registeredTools: RegisteredToolSummary[];
}

export type DelegationStatus = "queued" | "completed" | "failed" | "canceled";

export interface DelegationSummary {
  id: string;
  parentSessionId: string | null;
  parentAgentId: string;
  parentTaskId: string;
  parentConversationId: string | null;
  callbackTaskId: string | null;
  childAgentId: string;
  childTaskId: string;
  sourceChannel: string;
  sourceUserId: string;
  sourceMetadata: Record<string, unknown>;
  instruction: string;
  status: DelegationStatus;
  result: string | null;
  error: string | null;
  createdAt: number;
  completedAt: number | null;
}
