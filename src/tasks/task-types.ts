export type TaskStatus = "queued" | "running" | "completed" | "failed" | "canceled";

export type TaskStepStatus = "pending" | "running" | "completed" | "failed" | "canceled" | "skipped";

export type TaskFailureType =
  | "model_error"
  | "tool_error"
  | "permission_denied"
  | "timeout"
  | "lease_expired"
  | "user_canceled"
  | "system_canceled"
  | "context_missing"
  | "unknown";

export type TaskFailureStage =
  | "claim"
  | "prompt_build"
  | "model_call"
  | "tool_call"
  | "persist_result"
  | "cancel"
  | "recovery"
  | "delivery"
  | "unknown";

export type TaskProgressStatus =
  | "waiting"
  | "blocked"
  | "claimed"
  | "preparing"
  | "building_prompt"
  | "calling_model"
  | "using_tool"
  | "persisting_result"
  | "completed"
  | "failed"
  | "canceled";

export interface TaskFailureClassification {
  failure_type: TaskFailureType;
  failure_stage: TaskFailureStage;
  retriable: boolean;
}

export interface TaskRecord {
  id: string;
  agent_id: string;
  parent_task_id: string | null;
  plan_step_id: string | null;
  conversation_id: string | null;
  source_channel: string;
  source_user_id: string;
  status: TaskStatus;
  priority: number;
  input: string;
  result: string | null;
  error: string | null;
  created_at: number;
  started_at: number | null;
  completed_at: number | null;
  attempt_count: number;
  max_attempts: number;
  lease_expires_at: number | null;
  idempotency_key: string | null;
  canceled_at: number | null;
  failure_type: TaskFailureType | null;
  failure_stage: TaskFailureStage | null;
  retriable: boolean | null;
  progress_status: TaskProgressStatus;
  progress_message: string;
  last_progress_at: number | null;
}

export interface TaskStepRecord {
  id: string;
  task_id: string;
  step_index: number;
  title: string;
  detail: string;
  status: TaskStepStatus;
  child_task_id: string | null;
  created_at: number;
  updated_at: number;
}

export interface TaskDependencyRecord {
  task_id: string;
  depends_on_task_id: string;
  reason: string;
  created_at: number;
  depends_on_status: TaskStatus;
  depends_on_input: string;
}
