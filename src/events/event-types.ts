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
  | "memory.remember"
  | "memory.update"
  | "memory.extract.started"
  | "memory.extract.completed"
  | "memory.extract.failed"
  | "memory.reconsolidate.started"
  | "memory.reconsolidate.completed"
  | "memory.reconsolidate.failed"
  | "memory.dedupe.started"
  | "memory.dedupe.completed"
  | "memory.dedupe.failed"
  | "episode.created"
  | "episode.updated"
  | "episode.failed"
  | "dream.started"
  | "dream.completed"
  | "dream.failed"
  | "memory.decision.created"
  | "memory.decision.applied"
  | "memory.decision.skipped"
  | "memory.decision.failed"
  | "memory.decision.undone"
  | "profile.sync.started"
  | "profile.sync.completed"
  | "profile.sync.skipped"
  | "profile.sync.failed"
  | "memory.review.created"
  | "memory.review.accepted"
  | "memory.review.rejected";

export interface RuntimeEvent {
  id: string;
  agent_id: string;
  task_id: string | null;
  conversation_id: string | null;
  type: RuntimeEventType;
  payload: string;
  created_at: number;
}
