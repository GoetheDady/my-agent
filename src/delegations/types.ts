export type DelegationStatus = "queued" | "completed" | "failed" | "canceled";

export interface DelegationRecord {
  id: string;
  parent_session_id: string | null;
  parent_agent_id: string;
  parent_task_id: string;
  parent_conversation_id: string | null;
  callback_task_id: string | null;
  child_agent_id: string;
  child_task_id: string;
  source_channel: string;
  source_user_id: string;
  source_metadata: string;
  instruction: string;
  status: DelegationStatus;
  result: string | null;
  error: string | null;
  created_at: number;
  completed_at: number | null;
}

export interface PublicDelegation {
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

export interface DelegateTaskInput {
  parentAgentId: string;
  parentTaskId: string;
  parentSessionId?: string | null;
  parentConversationId?: string | null;
  sourceChannel: string;
  sourceUserId: string;
  sourceMetadata?: Record<string, unknown>;
  targetAgentId: string;
  instruction: string;
  reason?: string;
}
