import type { Database } from "bun:sqlite";
import { getAgent, updateAgentStatus } from "../agents/agent-registry";
import { getDb } from "../core/database";
import type { TaskRecord, TaskStatus } from "./task-types";

export interface CreateTaskInput {
  id?: string;
  agent_id?: string;
  conversation_id?: string | null;
  source_channel: string;
  source_user_id?: string;
  input: string;
  priority?: number;
  created_at?: number;
}

export function createTask(input: CreateTaskInput, database: Database = getDb()): TaskRecord {
  const now = input.created_at ?? Date.now();
  const task: TaskRecord = {
    id: input.id ?? crypto.randomUUID(),
    agent_id: input.agent_id ?? "default",
    conversation_id: input.conversation_id ?? null,
    source_channel: input.source_channel,
    source_user_id: input.source_user_id ?? "default",
    status: "queued",
    priority: input.priority ?? 0,
    input: input.input,
    result: null,
    error: null,
    created_at: now,
    started_at: null,
    completed_at: null,
  };

  database
    .query(
      `INSERT INTO tasks (
         id, agent_id, conversation_id, source_channel, source_user_id, status,
         priority, input, result, error, created_at, started_at, completed_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      task.id,
      task.agent_id,
      task.conversation_id,
      task.source_channel,
      task.source_user_id,
      task.status,
      task.priority,
      task.input,
      task.result,
      task.error,
      task.created_at,
      task.started_at,
      task.completed_at,
    );

  return task;
}

export function getTask(taskId: string, database: Database = getDb()): TaskRecord | null {
  return database
    .query<TaskRecord, [string]>(
      `SELECT id, agent_id, conversation_id, source_channel, source_user_id, status,
              priority, input, result, error, created_at, started_at, completed_at
       FROM tasks
       WHERE id = ?`,
    )
    .get(taskId) ?? null;
}

export function listTasks(
  agentId: string,
  statuses?: TaskStatus[],
  database: Database = getDb(),
): TaskRecord[] {
  if (!statuses || statuses.length === 0) {
    return database
      .query<TaskRecord, [string]>(
        `SELECT id, agent_id, conversation_id, source_channel, source_user_id, status,
                priority, input, result, error, created_at, started_at, completed_at
         FROM tasks
         WHERE agent_id = ?
         ORDER BY priority DESC, created_at ASC`,
      )
      .all(agentId);
  }

  const placeholders = statuses.map(() => "?").join(", ");
  return database
    .query<TaskRecord, [string, ...TaskStatus[]]>(
      `SELECT id, agent_id, conversation_id, source_channel, source_user_id, status,
              priority, input, result, error, created_at, started_at, completed_at
       FROM tasks
       WHERE agent_id = ? AND status IN (${placeholders})
       ORDER BY priority DESC, created_at ASC`,
    )
    .all(agentId, ...statuses);
}

export function markTaskRunning(taskId: string, database: Database = getDb()): void {
  const task = requireTask(taskId, database);
  const now = Date.now();

  database
    .query(
      `UPDATE tasks
       SET status = 'running', started_at = ?, error = NULL
       WHERE id = ?`,
    )
    .run(now, taskId);
  updateAgentStatus(task.agent_id, "running", taskId, database);
}

export function markTaskCompleted(
  taskId: string,
  result: string,
  database: Database = getDb(),
): void {
  completeTask(taskId, "completed", result, null, database);
}

export function markTaskFailed(taskId: string, error: string, database: Database = getDb()): void {
  completeTask(taskId, "failed", null, error, database);
}

export function markTaskCanceled(taskId: string, database: Database = getDb()): void {
  const cancel = database.transaction(() => {
    const task = requireTask(taskId, database);
    const now = Date.now();

    database
      .query(
        `UPDATE tasks
         SET status = 'canceled', completed_at = ?
         WHERE id = ?`,
      )
      .run(now, taskId);

    const agent = getAgent(task.agent_id, database);
    if (agent?.current_task_id === taskId) {
      updateAgentStatus(task.agent_id, "idle", null, database);
    }
  });

  cancel();
}

function completeTask(
  taskId: string,
  status: Extract<TaskStatus, "completed" | "failed">,
  result: string | null,
  error: string | null,
  database: Database,
): void {
  const complete = database.transaction(() => {
    const task = requireTask(taskId, database);
    const now = Date.now();

    database
      .query(
        `UPDATE tasks
         SET status = ?, result = ?, error = ?, completed_at = ?
         WHERE id = ?`,
      )
      .run(status, result, error, now, taskId);

    const agent = getAgent(task.agent_id, database);
    if (agent?.current_task_id === taskId) {
      updateAgentStatus(task.agent_id, "idle", null, database);
    }
  });

  complete();
}

function requireTask(taskId: string, database: Database): TaskRecord {
  const task = getTask(taskId, database);
  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
  }
  return task;
}
