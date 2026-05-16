import type { Database } from "bun:sqlite";
import { updateAgentStatus } from "../agents/agent-registry";
import { getDb } from "../core/database";
import { appendEvent } from "../events/event-log";
import { finalizeEpisodeForTask } from "../memory/episode-store";
import { drainExternalChannelQueue } from "../channels/external-runner";
import {
  getTask,
  markTaskCanceled,
  recoverRunningTasks,
  TASK_SELECT_COLUMNS,
  taskRowToRecord,
  type TaskRow,
} from "./task-store";
import type { TaskRecord } from "./task-types";

export const DEFAULT_TASK_WATCHDOG_INTERVAL_MS = 60_000;
export const DEFAULT_WEB_QUEUED_TIMEOUT_MS = 60_000;
export const DEFAULT_EXTERNAL_QUEUED_TIMEOUT_MS = 60_000;
export const DEFAULT_APPROVAL_TIMEOUT_MS = 30 * 60_000;

const EXTERNAL_QUEUE_CHANNELS = new Set(["feishu", "delegation", "delegation_callback"]);

export interface TaskWatchdogResult {
  scanned: number;
  canceled: number;
  recovered: number;
  alerted: number;
  repaired: number;
}

export interface TaskWatchdogOptions {
  now?: number;
  webQueuedTimeoutMs?: number;
  externalQueuedTimeoutMs?: number;
  approvalTimeoutMs?: number;
  drainExternalQueue?: (agentId: string) => void | Promise<void>;
}

export interface TaskWatchdogSchedulerOptions extends TaskWatchdogOptions {
  intervalMs?: number;
  database?: Database;
}

interface PendingApprovalRow {
  id: string;
  agent_id: string;
  session_id: string | null;
  task_id: string | null;
  channel: string | null;
  conversation_id: string | null;
  tool_call_id: string;
  tool_name: string;
  created_at: number;
}

interface StuckAgentRow {
  id: string;
  current_task_id: string | null;
}

let schedulerStop: (() => void) | null = null;

export function runTaskWatchdogOnce(
  databaseOrOptions: Database | TaskWatchdogOptions = getDb(),
  maybeOptions: TaskWatchdogOptions = {},
): TaskWatchdogResult {
  const database = isDatabase(databaseOrOptions) ? databaseOrOptions : getDb();
  const options = isDatabase(databaseOrOptions) ? maybeOptions : databaseOrOptions;
  const now = options.now ?? Date.now();
  const result: TaskWatchdogResult = {
    scanned: 0,
    canceled: 0,
    recovered: 0,
    alerted: 0,
    repaired: 0,
  };

  result.repaired += repairStuckAgents(database, now);

  const expiredRunningTasks = listExpiredRunningTasks(database, now);
  const recoveredTaskIds = new Set(expiredRunningTasks.map((task) => task.id));
  result.scanned += expiredRunningTasks.length;
  for (const task of expiredRunningTasks) {
    appendWatchdogEvent(task, "task.watchdog.detected", {
      reason: "running_lease_expired",
      leaseExpiresAt: task.lease_expires_at,
      notificationLevel: "P2",
    }, database, now);
  }
  if (expiredRunningTasks.length > 0) {
    const recoveredCount = recoverRunningTasks(database);
    result.recovered += recoveredCount;
    for (const task of expiredRunningTasks) {
      const updated = getTask(task.id, database);
      appendWatchdogEvent(updated ?? task, "task.watchdog.recovered", {
        reason: "running_lease_expired",
        previousStatus: "running",
        nextStatus: updated?.status ?? "missing",
        notificationLevel: updated?.status === "failed" ? "P1" : "P2",
      }, database, now);
    }
  }

  const queuedTasks = listQueuedTasks(database);
  const staleExternalAgents = new Set<string>();
  const staleWebCanceledByAgent = new Map<string, number>();
  for (const task of queuedTasks) {
    if (recoveredTaskIds.has(task.id)) continue;
    result.scanned += 1;
    const ageMs = now - task.created_at;
    if (task.source_channel === "web" && ageMs >= (options.webQueuedTimeoutMs ?? DEFAULT_WEB_QUEUED_TIMEOUT_MS)) {
      cancelStaleWebTask(task, database, now);
      result.canceled += 1;
      staleWebCanceledByAgent.set(task.agent_id, (staleWebCanceledByAgent.get(task.agent_id) ?? 0) + 1);
      continue;
    }

    if (
      EXTERNAL_QUEUE_CHANNELS.has(task.source_channel) &&
      ageMs >= (options.externalQueuedTimeoutMs ?? DEFAULT_EXTERNAL_QUEUED_TIMEOUT_MS)
    ) {
      appendWatchdogEvent(task, "task.watchdog.detected", {
        reason: "external_queued_stale",
        ageMs,
        notificationLevel: "P2",
      }, database, now);
      appendWatchdogEvent(task, "task.watchdog.alerted", {
        reason: "external_queued_stale",
        action: "drain_requested",
        ageMs,
        notificationLevel: "P1",
      }, database, now);
      result.alerted += 1;
      staleExternalAgents.add(task.agent_id);
    }
  }

  for (const [agentId, count] of staleWebCanceledByAgent) {
    if (count <= 3) continue;
    appendEvent({
      agent_id: agentId,
      type: "task.watchdog.alerted",
      payload: {
        reason: "web_queued_stale_batch",
        count,
        notificationLevel: "P1",
      },
      created_at: now,
    }, database);
    result.alerted += 1;
  }

  for (const agentId of staleExternalAgents) {
    void Promise.resolve((options.drainExternalQueue ?? drainExternalChannelQueue)(agentId))
      .catch((error) => {
        appendEvent({
          agent_id: agentId,
          type: "task.watchdog.alerted",
          payload: {
            reason: "external_queue_drain_failed",
            error: error instanceof Error ? error.message : String(error),
            notificationLevel: "P1",
          },
          created_at: now,
        }, database);
      });
  }

  const staleApprovals = listStalePendingApprovals(
    database,
    now - (options.approvalTimeoutMs ?? DEFAULT_APPROVAL_TIMEOUT_MS),
  );
  result.scanned += staleApprovals.length;
  for (const approval of staleApprovals) {
    appendEvent({
      agent_id: approval.agent_id,
      task_id: approval.task_id,
      conversation_id: approval.conversation_id ?? approval.session_id,
      type: "task.watchdog.alerted",
      payload: {
        reason: "approval_pending_timeout",
        approvalId: approval.id,
        toolCallId: approval.tool_call_id,
        toolName: approval.tool_name,
        channel: approval.channel,
        sessionId: approval.session_id,
        notificationLevel: "P0",
      },
      created_at: now,
    }, database);
    result.alerted += 1;
  }

  for (const task of listRetriableFailedTasksWithoutAlert(database)) {
    result.scanned += 1;
    appendWatchdogEvent(task, "task.watchdog.alerted", {
      reason: "failed_retriable",
      failureType: task.failure_type,
      failureStage: task.failure_stage,
      notificationLevel: "P1",
    }, database, now);
    result.alerted += 1;
  }

  return result;
}

export function startTaskWatchdogScheduler(options: TaskWatchdogSchedulerOptions = {}): () => void {
  schedulerStop?.();
  const intervalMs = options.intervalMs ?? DEFAULT_TASK_WATCHDOG_INTERVAL_MS;
  const database = options.database ?? getDb();
  const timer = setInterval(() => {
    try {
      runTaskWatchdogOnce(database, options);
    } catch (error) {
      console.warn("[watchdog] task watchdog failed:", error);
    }
  }, intervalMs);
  (timer as { unref?: () => void }).unref?.();
  schedulerStop = () => {
    clearInterval(timer);
    if (schedulerStop) schedulerStop = null;
  };
  return schedulerStop;
}

function cancelStaleWebTask(task: TaskRecord, database: Database, now: number): void {
  const ageMs = now - task.created_at;
  appendWatchdogEvent(task, "task.watchdog.detected", {
    reason: "web_queued_stale",
    ageMs,
    notificationLevel: "P2",
  }, database, now);
  markTaskCanceled(task.id, { failureType: "system_canceled", requestedBy: "system" }, database);
  finalizeEpisodeForTask(task.id, database);
  appendWatchdogEvent(task, "task.watchdog.canceled", {
    reason: "web_queued_stale",
    ageMs,
    notificationLevel: "P2",
  }, database, now);
}

function repairStuckAgents(database: Database, now: number): number {
  const rows = database
    .query<StuckAgentRow, []>(
      `SELECT id, current_task_id
       FROM agents
       WHERE status = 'running'
         AND (
           current_task_id IS NULL OR
           current_task_id NOT IN (SELECT id FROM tasks WHERE status = 'running')
         )`,
    )
    .all();

  for (const agent of rows) {
    updateAgentStatus(agent.id, "idle", null, database);
    appendEvent({
      agent_id: agent.id,
      type: "agent.watchdog.repaired",
      payload: {
        reason: "agent_running_without_running_task",
        previousCurrentTaskId: agent.current_task_id,
        notificationLevel: "P1",
      },
      created_at: now,
    }, database);
  }
  return rows.length;
}

function listExpiredRunningTasks(database: Database, now: number): TaskRecord[] {
  return database
    .query<TaskRow, [number]>(
      `SELECT ${TASK_SELECT_COLUMNS}
       FROM tasks
       WHERE status = 'running'
         AND (lease_expires_at IS NULL OR lease_expires_at <= ?)`,
    )
    .all(now)
    .map(taskRowToRecord);
}

function listQueuedTasks(database: Database): TaskRecord[] {
  return database
    .query<TaskRow, []>(
      `SELECT ${TASK_SELECT_COLUMNS}
       FROM tasks
       WHERE status = 'queued'
       ORDER BY priority DESC, created_at ASC`,
    )
    .all()
    .map(taskRowToRecord);
}

function listStalePendingApprovals(database: Database, createdBefore: number): PendingApprovalRow[] {
  return database
    .query<PendingApprovalRow, [number]>(
      `SELECT id, agent_id, session_id, task_id, channel, conversation_id, tool_call_id, tool_name, created_at
       FROM tool_approvals
       WHERE status = 'pending'
         AND created_at <= ?
         AND id NOT IN (
           SELECT json_extract(payload, '$.approvalId')
           FROM events
           WHERE type = 'task.watchdog.alerted'
             AND json_extract(payload, '$.reason') = 'approval_pending_timeout'
         )`,
    )
    .all(createdBefore);
}

function listRetriableFailedTasksWithoutAlert(database: Database): TaskRecord[] {
  return database
    .query<TaskRow, []>(
      `SELECT ${TASK_SELECT_COLUMNS}
       FROM tasks
       WHERE status = 'failed'
         AND retriable = 1
         AND id NOT IN (
           SELECT task_id
           FROM events
           WHERE type = 'task.watchdog.alerted'
             AND json_extract(payload, '$.reason') = 'failed_retriable'
         )`,
    )
    .all()
    .map(taskRowToRecord);
}

function appendWatchdogEvent(
  task: TaskRecord,
  type: "task.watchdog.detected" | "task.watchdog.canceled" | "task.watchdog.recovered" | "task.watchdog.alerted",
  payload: Record<string, unknown>,
  database: Database,
  createdAt = Date.now(),
): void {
  appendEvent({
    agent_id: task.agent_id,
    task_id: task.id,
    conversation_id: task.conversation_id,
    type,
    payload,
    created_at: createdAt,
  }, database);
}

function isDatabase(value: unknown): value is Database {
  return Boolean(value && typeof value === "object" && "query" in value && "run" in value);
}
