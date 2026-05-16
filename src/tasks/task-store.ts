import type { Database } from "bun:sqlite";
import { getAgent, updateAgentStatus } from "../agents/agent-registry";
import { getDb } from "../core/database";
import { appendEvent } from "../events/event-log";
import { defaultRealtimeService } from "../realtime/service";
import type {
  TaskFailureClassification,
  TaskFailureStage,
  TaskFailureType,
  TaskProgressStatus,
  TaskRecord,
  TaskStatus,
} from "./task-types";

export const DEFAULT_TASK_MAX_ATTEMPTS = 3;
export const TASK_LEASE_MS = 60_000;
export const TASK_LEASE_RENEW_INTERVAL_MS = 20_000;

export const TASK_SELECT_COLUMNS = `
  id, agent_id, conversation_id, source_channel, source_user_id, status,
  priority, input, result, error, created_at, started_at, completed_at,
  attempt_count, max_attempts, lease_expires_at, idempotency_key, canceled_at,
  failure_type, failure_stage, retriable, progress_status, progress_message, last_progress_at
`;

export interface CreateTaskInput {
  id?: string;
  agent_id?: string;
  conversation_id?: string | null;
  source_channel: string;
  source_user_id?: string;
  input: string;
  priority?: number;
  created_at?: number;
  idempotency_key?: string | null;
  max_attempts?: number;
}

export interface RetryTaskOptions {
  force?: boolean;
}

export interface UpdateTaskProgressInput {
  status: TaskProgressStatus;
  message?: string;
  metadata?: Record<string, unknown>;
}

export interface CancelTaskOptions {
  failureType?: Extract<TaskFailureType, "user_canceled" | "system_canceled">;
  stage?: Extract<TaskFailureStage, "cancel">;
  requestedBy?: "runtime_api" | "runtime" | "system";
}

export interface TaskFailureContext {
  stage?: TaskFailureStage;
  isClientAbort?: boolean;
  isTimeout?: boolean;
  isPermissionDenied?: boolean;
  isToolError?: boolean;
}

export type TaskRow = Omit<TaskRecord, "retriable"> & {
  retriable: number | null;
};

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
  const idempotencyKey = normalizeIdempotencyKey(input.idempotency_key);
  const maxAttempts = normalizeMaxAttempts(input.max_attempts);
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
    attempt_count: 0,
    max_attempts: maxAttempts,
    lease_expires_at: null,
    idempotency_key: idempotencyKey,
    canceled_at: null,
    failure_type: null,
    failure_stage: null,
    retriable: null,
    progress_status: "waiting",
    progress_message: "",
    last_progress_at: now,
  };

  const create = database.transaction(() => {
    if (idempotencyKey) {
      const existing = getTaskByIdempotencyKey(idempotencyKey, database);
      if (existing) return existing;
    }

    database
      .query(
        `INSERT INTO tasks (
           id, agent_id, conversation_id, source_channel, source_user_id, status,
           priority, input, result, error, created_at, started_at, completed_at,
           attempt_count, max_attempts, lease_expires_at, idempotency_key, canceled_at,
           failure_type, failure_stage, retriable, progress_status, progress_message, last_progress_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        task.attempt_count,
        task.max_attempts,
        task.lease_expires_at,
        task.idempotency_key,
        task.canceled_at,
        task.failure_type,
        task.failure_stage,
        task.retriable === null ? null : (task.retriable ? 1 : 0),
        task.progress_status,
        task.progress_message,
        task.last_progress_at,
      );
    return task;
  });

  const stored = create();
  if (stored.id === task.id) broadcastTaskUpdated(stored);
  return stored;
}

/**
 * 根据 id 获取任务。
 *
 * @param taskId 任务 id。
 * @param database 可选数据库连接。
 * @returns 找到时返回任务记录，否则返回 `null`。
 */
export function getTask(taskId: string, database: Database = getDb()): TaskRecord | null {
  const row = database
    .query<TaskRow, [string]>(
      `SELECT ${TASK_SELECT_COLUMNS}
       FROM tasks
       WHERE id = ?`,
    )
    .get(taskId);
  return row ? taskRowToRecord(row) : null;
}

export function getTaskByIdempotencyKey(
  idempotencyKey: string,
  database: Database = getDb(),
): TaskRecord | null {
  const row = database
    .query<TaskRow, [string]>(
      `SELECT ${TASK_SELECT_COLUMNS}
       FROM tasks
       WHERE idempotency_key = ?`,
    )
    .get(idempotencyKey);
  return row ? taskRowToRecord(row) : null;
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
      .query<TaskRow, [string]>(
        `SELECT ${TASK_SELECT_COLUMNS}
         FROM tasks
         WHERE agent_id = ?
         ORDER BY priority DESC, created_at ASC`,
      )
      .all(agentId)
      .map(taskRowToRecord);
  }

  const placeholders = statuses.map(() => "?").join(", ");
  return database
    .query<TaskRow, [string, ...TaskStatus[]]>(
      `SELECT ${TASK_SELECT_COLUMNS}
       FROM tasks
       WHERE agent_id = ? AND status IN (${placeholders})
       ORDER BY priority DESC, created_at ASC`,
    )
    .all(agentId, ...statuses)
    .map(taskRowToRecord);
}

/**
 * 计算某个 queued task 在同 Agent 队列中的位置。
 *
 * 返回值只计算同一 Agent、同一组渠道、仍处于 queued 的任务；前端或渠道提示
 * 可以用它告诉用户“前面还有几条任务”。返回 0 表示当前任务已是下一条。
 *
 * @param agentId Agent 标识。
 * @param taskId 目标任务 id。
 * @param sourceChannels 可选渠道过滤。
 * @param database 可选数据库连接。
 * @returns 找不到 queued task 时返回 `null`，否则返回前方任务数量。
 */
export function getQueuedTaskPosition(
  agentId: string,
  taskId: string,
  sourceChannels: string[] = [],
  database: Database = getDb(),
): number | null {
  const task = getTask(taskId, database);
  if (!task || task.agent_id !== agentId || task.status !== "queued") {
    return null;
  }

  const channelClause = sourceChannels.length > 0
    ? ` AND source_channel IN (${sourceChannels.map(() => "?").join(", ")})`
    : "";
  const args = sourceChannels.length > 0
    ? [agentId, task.priority, task.priority, task.created_at, ...sourceChannels] as [string, number, number, number, ...string[]]
    : [agentId, task.priority, task.priority, task.created_at] as [string, number, number, number];
  const row = database
    .query<{ count: number }, typeof args>(
      `SELECT COUNT(*) AS count
       FROM tasks
       WHERE agent_id = ?
         AND status = 'queued'
         AND (
           priority > ? OR
           (priority = ? AND created_at < ?)
         )
         ${channelClause}`,
    )
    .get(...args);
  return row?.count ?? 0;
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
  const leaseExpiresAt = now + TASK_LEASE_MS;

  database
    .query(
      `UPDATE tasks
       SET status = 'running',
           started_at = ?,
           error = NULL,
           result = NULL,
           completed_at = NULL,
           canceled_at = NULL,
           failure_type = NULL,
           failure_stage = NULL,
           retriable = NULL,
           progress_status = 'claimed',
           progress_message = '任务已领取',
           last_progress_at = ?,
           lease_expires_at = ?,
           attempt_count = attempt_count + 1
       WHERE id = ?`,
    )
    .run(now, now, leaseExpiresAt, taskId);
  updateAgentStatus(task.agent_id, "running", taskId, database);
  const updated = getTask(taskId, database);
  if (updated) broadcastTaskUpdated(updated);
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
  completeTask(taskId, "completed", result, null, null, database);
}

/**
 * 将任务标记为 failed，并释放对应 Agent。
 *
 * @param taskId 任务 id。
 * @param error 失败原因。
 * @param database 可选数据库连接。
 */
export function markTaskFailed(
  taskId: string,
  error: string,
  classificationOrDatabase: TaskFailureClassification | Database | null = null,
  database?: Database,
): void {
  const classification = isDatabase(classificationOrDatabase) ? null : classificationOrDatabase;
  const targetDatabase = isDatabase(classificationOrDatabase) ? classificationOrDatabase : (database ?? getDb());
  const nextClassification = classification ?? classifyTaskFailure(error);
  completeTask(taskId, "failed", null, error, nextClassification, targetDatabase);
}

/**
 * 将任务标记为 canceled。
 *
 * 如果该任务正占用 Agent，会在同一事务里释放 Agent。
 *
 * @param taskId 任务 id。
 * @param database 可选数据库连接。
 */
export function markTaskCanceled(
  taskId: string,
  optionsOrDatabase: CancelTaskOptions | Database = {},
  database?: Database,
): void {
  const options = isDatabase(optionsOrDatabase) ? {} : optionsOrDatabase;
  const targetDatabase = isDatabase(optionsOrDatabase) ? optionsOrDatabase : (database ?? getDb());
  // 取消任务和释放 Agent 状态必须在同一个事务里完成。
  // 事务表示一组数据库操作要么全部成功，要么全部失败，避免出现任务取消但 Agent 仍占用的状态。
  const existing = requireTask(taskId, targetDatabase);
  const requestedBy = options.requestedBy ?? "runtime";
  const rejectionCreatedAt = Date.now();
  if (existing.status === "completed") {
    appendEvent({
      agent_id: existing.agent_id,
      task_id: existing.id,
      conversation_id: existing.conversation_id,
      type: "task.cancel.rejected",
      payload: { reason: "completed", requestedBy },
      created_at: rejectionCreatedAt,
    }, targetDatabase);
    throw new Error("任务已完成，不能取消。");
  }
  if (existing.status === "failed") {
    appendEvent({
      agent_id: existing.agent_id,
      task_id: existing.id,
      conversation_id: existing.conversation_id,
      type: "task.cancel.rejected",
      payload: { reason: "failed", requestedBy },
      created_at: rejectionCreatedAt,
    }, targetDatabase);
    throw new Error("任务已失败，不能取消。");
  }

  const cancel = targetDatabase.transaction(() => {
    const task = requireTask(taskId, targetDatabase);
    const now = Date.now();
    const failureType = options.failureType ?? "user_canceled";
    if (task.status === "canceled") {
      const agent = getAgent(task.agent_id, targetDatabase);
      if (agent?.current_task_id === taskId) {
        updateAgentStatus(task.agent_id, "idle", null, targetDatabase);
      }
      return;
    }

    appendEvent({
      agent_id: task.agent_id,
      task_id: task.id,
      conversation_id: task.conversation_id,
      type: "task.cancel.requested",
      payload: { requestedBy, failureType },
      created_at: now,
    }, targetDatabase);

    targetDatabase
      .query(
        `UPDATE tasks
         SET status = 'canceled',
             completed_at = ?,
             canceled_at = ?,
             failure_type = ?,
             failure_stage = 'cancel',
             retriable = 0,
             progress_status = 'canceled',
             progress_message = '任务已取消',
             last_progress_at = ?,
             lease_expires_at = NULL
         WHERE id = ?`,
      )
      .run(now, now, failureType, now, taskId);

    const agent = getAgent(task.agent_id, targetDatabase);
    if (agent?.current_task_id === taskId) {
      updateAgentStatus(task.agent_id, "idle", null, targetDatabase);
    }
    const updated = getTask(taskId, targetDatabase);
    if (updated) broadcastTaskUpdated(updated);
    appendEvent({
      agent_id: task.agent_id,
      task_id: task.id,
      conversation_id: task.conversation_id,
      type: "task.canceled",
      payload: { failureType, failureStage: "cancel", retriable: false, requestedBy },
      created_at: now,
    }, targetDatabase);
    scheduleQueueDrain(task);
  });

  cancel();
}

/**
 * 恢复启动前遗留的 running task。
 *
 * running task 只有在租约过期后才会被判定为卡住。未超过最大执行次数时
 * 重新回到 queued；达到最大次数时标记为 failed。
 *
 * @param database 可选数据库连接。
 * @returns 被恢复的任务数量。
 */
export function recoverRunningTasks(database: Database = getDb()): number {
  const recover = database.transaction(() => {
    const now = Date.now();
    const tasks = database
      .query<TaskRow, [number]>(
        `SELECT ${TASK_SELECT_COLUMNS}
         FROM tasks
         WHERE status = 'running'
           AND (lease_expires_at IS NULL OR lease_expires_at <= ?)`,
      )
      .all(now)
      .map(taskRowToRecord);

    for (const task of tasks) {
      if (task.attempt_count < task.max_attempts) {
        database
          .query(
            `UPDATE tasks
            SET status = 'queued',
                result = NULL,
                error = NULL,
                completed_at = NULL,
                canceled_at = NULL,
                failure_type = NULL,
                failure_stage = NULL,
                retriable = NULL,
                progress_status = 'waiting',
                progress_message = '任务已恢复到队列',
                last_progress_at = ?,
                lease_expires_at = NULL
             WHERE id = ?`,
          )
          .run(now, task.id);

        appendEvent({
          agent_id: task.agent_id,
          task_id: task.id,
          conversation_id: task.conversation_id,
          type: "task.recovered",
          payload: {
            reason: "lease_expired",
            attemptCount: task.attempt_count,
            maxAttempts: task.max_attempts,
            leaseExpiresAt: task.lease_expires_at,
          },
          created_at: now,
        }, database);
        appendEvent({
          agent_id: task.agent_id,
          task_id: task.id,
          conversation_id: task.conversation_id,
          type: "task.retry_scheduled",
          payload: {
            reason: "recovered_from_expired_lease",
            attemptCount: task.attempt_count,
            maxAttempts: task.max_attempts,
          },
          created_at: now + 1,
        }, database);
      } else {
        const error = "任务租约已过期，并且已达到最大执行次数。";
        database
          .query(
            `UPDATE tasks
             SET status = 'failed',
                 error = ?,
                 completed_at = ?,
                 failure_type = 'lease_expired',
                 failure_stage = 'recovery',
                 retriable = 0,
                 progress_status = 'failed',
                 progress_message = '任务租约过期且达到最大执行次数',
                 last_progress_at = ?,
                 lease_expires_at = NULL
             WHERE id = ?`,
          )
          .run(error, now, now, task.id);

        appendEvent({
          agent_id: task.agent_id,
          task_id: task.id,
          conversation_id: task.conversation_id,
          type: "task.failed_permanently",
          payload: {
            reason: "lease_expired_max_attempts_reached",
            error,
            attemptCount: task.attempt_count,
            maxAttempts: task.max_attempts,
            leaseExpiresAt: task.lease_expires_at,
          },
          created_at: now,
        }, database);
        appendEvent({
          agent_id: task.agent_id,
          task_id: task.id,
          conversation_id: task.conversation_id,
          type: "task.failed.classified",
          payload: {
            error,
            failureType: "lease_expired",
            failureStage: "recovery",
            retriable: false,
          },
          created_at: now + 1,
        }, database);
      }

      const agent = getAgent(task.agent_id, database);
      if (agent?.current_task_id === task.id) {
        updateAgentStatus(task.agent_id, "idle", null, database);
      }
      const updated = getTask(task.id, database);
      if (updated) broadcastTaskUpdated(updated);
      if (updated?.status === "queued") scheduleQueueDrain(updated);
    }

    const stuckAgents = database
      .query<{ id: string }, []>(
        `SELECT id
         FROM agents
         WHERE status = 'running'
           AND (
             current_task_id IS NULL OR
             current_task_id NOT IN (SELECT id FROM tasks WHERE status = 'running')
           )`,
      )
      .all();
    for (const agent of stuckAgents) {
      updateAgentStatus(agent.id, "idle", null, database);
    }

    return tasks.length;
  });

  return recover();
}

/**
 * 延长 running task 的租约。
 *
 * 租约表示“当前执行进程仍然活着”的时间窗口。执行器定期续约，服务重启后
 * recoverRunningTasks 只会恢复租约过期的 task。
 */
export function renewTaskLease(taskId: string, database: Database = getDb()): TaskRecord | null {
  const now = Date.now();
  const leaseExpiresAt = now + TASK_LEASE_MS;
  const result = database
    .query(
      `UPDATE tasks
       SET lease_expires_at = ?
       WHERE id = ? AND status = 'running'`,
    )
    .run(leaseExpiresAt, taskId);
  if (result.changes === 0) return null;

  const task = getTask(taskId, database);
  if (!task) return null;
  broadcastTaskUpdated(task);
  appendEvent({
    agent_id: task.agent_id,
    task_id: task.id,
    conversation_id: task.conversation_id,
    type: "task.lease.renewed",
    payload: { leaseExpiresAt },
    created_at: now,
  }, database);
  return task;
}

/**
 * 把失败或租约过期的任务重新放回队列。
 *
 * retry 复用原 taskId，保留原始事件链和 conversation 关系；attempt_count
 * 只在下一次真正领取执行时递增。
 */
export function retryTask(
  taskId: string,
  options: RetryTaskOptions = {},
  database: Database = getDb(),
): TaskRecord {
  const retry = database.transaction(() => {
    const task = requireTask(taskId, database);
    const now = Date.now();
    const force = options.force === true;

    if (task.status === "completed") {
      throw new Error("任务已完成，不能重试。");
    }
    if (task.status === "queued") {
      throw new Error("任务仍在队列中，无需重试。");
    }
    if (task.status === "canceled" && !force) {
      throw new Error("任务已取消，默认不能重试；确认需要时请使用 force。");
    }
    if (task.status === "running" && !isTaskLeaseExpired(task, now)) {
      throw new Error("任务仍在运行且租约未过期，不能重试。");
    }
    if (task.attempt_count >= task.max_attempts && !force) {
      throw new Error("任务已达到最大执行次数，不能继续重试。");
    }

    database
      .query(
        `UPDATE tasks
         SET status = 'queued',
             result = NULL,
             error = NULL,
             completed_at = NULL,
             canceled_at = NULL,
             failure_type = NULL,
             failure_stage = NULL,
             retriable = NULL,
             progress_status = 'waiting',
             progress_message = '任务已重新排队',
             last_progress_at = ?,
             lease_expires_at = NULL
         WHERE id = ?`,
      )
      .run(now, task.id);

    const agent = getAgent(task.agent_id, database);
    if (agent?.current_task_id === task.id) {
      updateAgentStatus(task.agent_id, "idle", null, database);
    }

    const updated = requireTask(task.id, database);
    appendEvent({
      agent_id: updated.agent_id,
      task_id: updated.id,
      conversation_id: updated.conversation_id,
      type: "task.retry_scheduled",
      payload: {
        previousStatus: task.status,
        forced: force,
        attemptCount: task.attempt_count,
        maxAttempts: task.max_attempts,
      },
      created_at: now,
    }, database);
    broadcastTaskUpdated(updated);
    scheduleQueueDrain(updated);
    return updated;
  });

  return retry();
}

function completeTask(
  taskId: string,
  status: Extract<TaskStatus, "completed" | "failed">,
  result: string | null,
  error: string | null,
  classification: TaskFailureClassification | null,
  database: Database,
): void {
  // completed/failed 都会释放 current_task_id。
  // 这里用事务保证任务状态和 Agent 状态不会被并发读取到半更新结果。
  const complete = database.transaction(() => {
    const task = requireTask(taskId, database);
    const now = Date.now();
    if (task.status === "canceled") return;

    database
      .query(
        `UPDATE tasks
         SET status = ?,
             result = ?,
             error = ?,
             completed_at = ?,
             failure_type = ?,
             failure_stage = ?,
             retriable = ?,
             progress_status = ?,
             progress_message = ?,
             last_progress_at = ?,
             lease_expires_at = NULL,
             canceled_at = NULL
         WHERE id = ?`,
      )
      .run(
        status,
        result,
        error,
        now,
        classification?.failure_type ?? null,
        classification?.failure_stage ?? null,
        classification ? (classification.retriable ? 1 : 0) : null,
        status === "completed" ? "completed" : "failed",
        status === "completed" ? "任务已完成" : "任务已失败",
        now,
        taskId,
      );

    const agent = getAgent(task.agent_id, database);
    if (agent?.current_task_id === taskId) {
      updateAgentStatus(task.agent_id, "idle", null, database);
    }
    const updated = getTask(taskId, database);
    if (updated) broadcastTaskUpdated(updated);
    if (status === "failed" && classification) {
      appendEvent({
        agent_id: task.agent_id,
        task_id: task.id,
        conversation_id: task.conversation_id,
        type: "task.failed.classified",
        payload: {
          error,
          failureType: classification.failure_type,
          failureStage: classification.failure_stage,
          retriable: classification.retriable,
        },
        created_at: now,
      }, database);
    }
    scheduleQueueDrain(task);
  });

  complete();
}

export function updateTaskProgress(
  taskId: string,
  progress: UpdateTaskProgressInput,
  database: Database = getDb(),
): TaskRecord | null {
  const task = getTask(taskId, database);
  if (!task) return null;

  const now = Date.now();
  database
    .query(
      `UPDATE tasks
       SET progress_status = ?,
           progress_message = ?,
           last_progress_at = ?
       WHERE id = ?`,
    )
    .run(progress.status, progress.message ?? "", now, taskId);

  const updated = getTask(taskId, database);
  if (!updated) return null;
  appendEvent({
    agent_id: updated.agent_id,
    task_id: updated.id,
    conversation_id: updated.conversation_id,
    type: "task.progress.updated",
    payload: {
      progressStatus: updated.progress_status,
      progressMessage: updated.progress_message,
      lastProgressAt: updated.last_progress_at,
      ...(progress.metadata ?? {}),
    },
    created_at: now,
  }, database);
  broadcastTaskUpdated(updated);
  return updated;
}

export function classifyTaskFailure(
  error: string,
  context: TaskFailureContext = {},
): TaskFailureClassification {
  if (context.isClientAbort) {
    return {
      failure_type: "user_canceled",
      failure_stage: "cancel",
      retriable: false,
    };
  }

  if (context.isTimeout || /timed out/i.test(error)) {
    return {
      failure_type: "timeout",
      failure_stage: context.stage ?? "model_call",
      retriable: true,
    };
  }

  if (context.isPermissionDenied || /permission|审批|denied/i.test(error)) {
    return {
      failure_type: "permission_denied",
      failure_stage: context.stage ?? "tool_call",
      retriable: false,
    };
  }

  if (context.isToolError) {
    return {
      failure_type: "tool_error",
      failure_stage: context.stage ?? "tool_call",
      retriable: true,
    };
  }

  if (context.stage === "delivery") {
    return {
      failure_type: "unknown",
      failure_stage: "delivery",
      retriable: false,
    };
  }

  if (context.stage === "prompt_build") {
    return {
      failure_type: "context_missing",
      failure_stage: "prompt_build",
      retriable: false,
    };
  }

  return {
    failure_type: "model_error",
    failure_stage: context.stage ?? "model_call",
    retriable: true,
  };
}

function requireTask(taskId: string, database: Database): TaskRecord {
  const task = getTask(taskId, database);
  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
  }
  return task;
}

export function taskRowToRecord(row: TaskRow): TaskRecord {
  return {
    ...row,
    retriable: row.retriable === null ? null : row.retriable === 1,
  };
}

function normalizeIdempotencyKey(idempotencyKey: string | null | undefined): string | null {
  const normalized = idempotencyKey?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}

function normalizeMaxAttempts(maxAttempts: number | undefined): number {
  if (maxAttempts === undefined || !Number.isFinite(maxAttempts)) {
    return DEFAULT_TASK_MAX_ATTEMPTS;
  }
  return Math.max(1, Math.floor(maxAttempts));
}

function isTaskLeaseExpired(task: TaskRecord, now: number): boolean {
  return task.lease_expires_at === null || task.lease_expires_at <= now;
}

function isDatabase(value: unknown): value is Database {
  return Boolean(value && typeof value === "object" && "query" in value && "run" in value);
}

function broadcastTaskUpdated(task: TaskRecord): void {
  defaultRealtimeService.broadcast({
    type: "runtime.task.updated",
    agentId: task.agent_id,
    taskId: task.id,
    payload: { task },
    createdAt: Date.now(),
  });
}

function scheduleQueueDrain(task: TaskRecord): void {
  if (task.source_channel === "delegation" || task.source_channel === "delegation_callback") {
    void import("../delegations/service")
      .then(({ defaultDelegationService }) => defaultDelegationService.drainAgent(task.agent_id))
      .catch(() => undefined);
    return;
  }

  if (task.source_channel === "feishu") {
    void import("../channels/external-runner")
      .then(({ drainExternalChannelQueue }) => drainExternalChannelQueue(task.agent_id))
      .catch(() => undefined);
  }
}
