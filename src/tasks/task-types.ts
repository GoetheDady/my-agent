export type TaskStatus = "queued" | "running" | "completed" | "failed" | "canceled";

export interface TaskRecord {
  id: string;
  agent_id: string;
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
}
