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

/**
 * 创建一条 queued 状态的任务。
 *
 * 所有渠道输入都会先转换为 task，再交给任务队列调度。
 *
 * @param input 任务来源、输入文本、目标 Agent、优先级等信息。
 * @param database 可选数据库连接。
 * @returns 已写入数据库的任务记录。
 */
export function createTask(input: CreateTaskInput, database: Database = getDb()): TaskRecord {
  // Task 是 Agent 的最小执行单元。不同渠道（Web、未来微信/飞书）都会先落成 task，
  // 再由队列按 agent_id 串行派发，避免一个 Agent 同时干多件事。
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

/**
 * 根据 id 获取任务。
 *
 * @param taskId 任务 id。
 * @param database 可选数据库连接。
 * @returns 找到时返回任务记录，否则返回 `null`。
 */
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

/**
 * 列出某个 Agent 的任务。
 *
 * @param agentId Agent 标识。
 * @param statuses 可选状态过滤；不传时返回该 Agent 全部任务。
 * @param database 可选数据库连接。
 * @returns 按优先级和创建时间排序的任务列表。
 */
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

/**
 * 将任务标记为 running，并同步占用对应 Agent。
 *
 * @param taskId 任务 id。
 * @param database 可选数据库连接。
 */
export function markTaskRunning(taskId: string, database: Database = getDb()): void {
  // 任务进入 running 时同步更新 Agent 状态，Runtime 面板才能显示“当前正在执行哪个任务”。
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

/**
 * 将任务标记为 completed，并释放对应 Agent。
 *
 * @param taskId 任务 id。
 * @param result 任务最终结果文本。
 * @param database 可选数据库连接。
 */
export function markTaskCompleted(
  taskId: string,
  result: string,
  database: Database = getDb(),
): void {
  completeTask(taskId, "completed", result, null, database);
}

/**
 * 将任务标记为 failed，并释放对应 Agent。
 *
 * @param taskId 任务 id。
 * @param error 失败原因。
 * @param database 可选数据库连接。
 */
export function markTaskFailed(taskId: string, error: string, database: Database = getDb()): void {
  completeTask(taskId, "failed", null, error, database);
}

/**
 * 将任务标记为 canceled。
 *
 * 如果该任务正占用 Agent，会在同一事务里释放 Agent。
 *
 * @param taskId 任务 id。
 * @param database 可选数据库连接。
 */
export function markTaskCanceled(taskId: string, database: Database = getDb()): void {
  // 取消任务和释放 Agent 状态必须在同一个事务里完成。
  // 事务表示一组数据库操作要么全部成功，要么全部失败，避免出现任务取消但 Agent 仍占用的状态。
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
  // completed/failed 都会释放 current_task_id。
  // 这里用事务保证任务状态和 Agent 状态不会被并发读取到半更新结果。
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
