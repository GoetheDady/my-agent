export type RuntimeEventType =
  | "task.created"
  | "task.started"
  | "task.completed"
  | "task.failed"
  | "user.message"
  | "assistant.delta"
  | "assistant.message"
  | "tool.call"
  | "tool.result"
  | "memory.search"
  | "memory.propose"
  | "memory.update";

export interface RuntimeEvent {
  id: string;
  agent_id: string;
  task_id: string | null;
  conversation_id: string | null;
  type: RuntimeEventType;
  payload: string;
  created_at: number;
}
