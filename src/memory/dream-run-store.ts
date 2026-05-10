import type { Database } from "bun:sqlite";
import { getDb } from "../core/database";

export type DreamRunTrigger = "scheduled" | "manual";
export type DreamRunStatus = "running" | "completed" | "failed";

export interface DreamRunRecord {
  id: string;
  agent_id: string;
  date: string;
  timezone: string;
  trigger: DreamRunTrigger;
  dry_run: boolean;
  status: DreamRunStatus;
  started_at: number;
  completed_at: number | null;
  error: string | null;
}

interface DreamRunRow {
  id: string;
  agent_id: string;
  date: string;
  timezone: string;
  trigger: DreamRunTrigger;
  dry_run: number;
  status: DreamRunStatus;
  started_at: number;
  completed_at: number | null;
  error: string | null;
}

/**
 * 创建一条 Dream Worker 运行记录。
 *
 * @param input Agent、日期、时区、触发方式、是否 dry-run 和开始时间。
 * @param database 可选数据库连接。
 * @returns 新创建的 dream run 记录。
 */
export function createDreamRun(input: {
  agentId?: string;
  date: string;
  timezone: string;
  trigger?: DreamRunTrigger;
  dryRun?: boolean;
  startedAt?: number;
}, database: Database = getDb()): DreamRunRecord {
  // dream_runs 记录每次 Dream Worker 运行。
  // scheduled real-run 会依赖这张表判断当天是否已经跑过，避免重启后重复整理。
  const run: DreamRunRecord = {
    id: crypto.randomUUID(),
    agent_id: input.agentId ?? "default",
    date: input.date,
    timezone: input.timezone,
    trigger: input.trigger ?? "manual",
    dry_run: input.dryRun ?? false,
    status: "running",
    started_at: input.startedAt ?? Date.now(),
    completed_at: null,
    error: null,
  };

  database
    .query(
      `INSERT INTO dream_runs (
        id, agent_id, date, timezone, trigger, dry_run, status,
        started_at, completed_at, error
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      run.id,
      run.agent_id,
      run.date,
      run.timezone,
      run.trigger,
      run.dry_run ? 1 : 0,
      run.status,
      run.started_at,
      run.completed_at,
      run.error,
    );

  return run;
}

/**
 * 将 Dream Worker 运行记录标记为 completed。
 *
 * @param id dream run id。
 * @param database 可选数据库连接。
 * @param completedAt 完成时间戳，默认当前时间。
 * @returns 更新后的 dream run；不存在时返回 `null`。
 */
export function completeDreamRun(
  id: string,
  database: Database = getDb(),
  completedAt = Date.now(),
): DreamRunRecord | null {
  database
    .query(
      `UPDATE dream_runs
       SET status = 'completed', completed_at = ?, error = NULL
       WHERE id = ?`,
    )
    .run(completedAt, id);
  return getDreamRun(id, database);
}

/**
 * 将 Dream Worker 运行记录标记为 failed。
 *
 * @param id dream run id。
 * @param error 失败原因。
 * @param database 可选数据库连接。
 * @param completedAt 完成时间戳，默认当前时间。
 * @returns 更新后的 dream run；不存在时返回 `null`。
 */
export function failDreamRun(
  id: string,
  error: string,
  database: Database = getDb(),
  completedAt = Date.now(),
): DreamRunRecord | null {
  database
    .query(
      `UPDATE dream_runs
       SET status = 'failed', completed_at = ?, error = ?
       WHERE id = ?`,
    )
    .run(completedAt, error, id);
  return getDreamRun(id, database);
}

/**
 * 获取单条 Dream Worker 运行记录。
 *
 * @param id dream run id。
 * @param database 可选数据库连接。
 * @returns 找到时返回记录，否则返回 `null`。
 */
export function getDreamRun(id: string, database: Database = getDb()): DreamRunRecord | null {
  const row = database
    .query<DreamRunRow, [string]>(
      `SELECT * FROM dream_runs WHERE id = ? LIMIT 1`,
    )
    .get(id);
  return row ? toDreamRun(row) : null;
}

/**
 * 列出 Dream Worker 运行历史。
 *
 * @param params Agent 和数量限制。
 * @param database 可选数据库连接。
 * @returns 按开始时间倒序排列的 dream run 列表。
 */
export function listDreamRuns(
  params: { agentId?: string; limit?: number } = {},
  database: Database = getDb(),
): DreamRunRecord[] {
  const agentId = params.agentId ?? "default";
  const limit = params.limit ?? 20;
  return database
    .query<DreamRunRow, [string, number]>(
      `SELECT * FROM dream_runs
       WHERE agent_id = ?
       ORDER BY started_at DESC
       LIMIT ?`,
    )
    .all(agentId, limit)
    .map(toDreamRun);
}

/**
 * 判断某天是否已经完成过 scheduled real-run。
 *
 * @param input Agent 和日期。
 * @param database 可选数据库连接。
 * @returns 已完成时返回 `true`。
 */
export function hasCompletedScheduledDreamRun(
  input: { agentId?: string; date: string },
  database: Database = getDb(),
): boolean {
  // 只检查 scheduled + real-run + completed。
  // dry-run 是调试用，不应该阻止夜间自动整理。
  const agentId = input.agentId ?? "default";
  const row = database
    .query<{ id: string }, [string, string]>(
      `SELECT id FROM dream_runs
       WHERE agent_id = ?
         AND date = ?
         AND trigger = 'scheduled'
         AND dry_run = 0
         AND status = 'completed'
       LIMIT 1`,
    )
    .get(agentId, input.date);
  return Boolean(row);
}

/**
 * 判断是否存在未超时的 scheduled running 记录。
 *
 * @param input Agent、日期和 staleBefore 阈值。
 * @param database 可选数据库连接。
 * @returns 存在未超时运行记录时返回 `true`。
 */
export function hasFreshRunningScheduledDreamRun(
  input: { agentId?: string; date: string; staleBefore: number },
  database: Database = getDb(),
): boolean {
  // fresh running 表示最近启动且未超时的运行中任务。
  // 调度器看到它会跳过本次 tick，防止并发跑两个整理任务。
  const agentId = input.agentId ?? "default";
  const row = database
    .query<{ id: string }, [string, string, number]>(
      `SELECT id FROM dream_runs
       WHERE agent_id = ?
         AND date = ?
         AND trigger = 'scheduled'
         AND dry_run = 0
         AND status = 'running'
         AND started_at >= ?
       LIMIT 1`,
    )
    .get(agentId, input.date, input.staleBefore);
  return Boolean(row);
}

/**
 * 将超时残留的 scheduled running 记录标记为 failed。
 *
 * @param input Agent、超时阈值和可选错误信息。
 * @param database 可选数据库连接。
 * @returns 被标记失败的记录数量。
 */
export function markStaleScheduledDreamRunsFailed(
  input: { agentId?: string; staleBefore: number; error?: string },
  database: Database = getDb(),
): number {
  // stale running 通常来自进程被杀或崩溃，没有机会写 completed/failed。
  // 先标记为 failed，再由调度器决定是否补跑。
  const agentId = input.agentId ?? "default";
  const result = database
    .query(
      `UPDATE dream_runs
       SET status = 'failed', completed_at = ?, error = ?
       WHERE agent_id = ?
         AND trigger = 'scheduled'
         AND dry_run = 0
         AND status = 'running'
         AND started_at < ?`,
    )
    .run(Date.now(), input.error ?? "stale scheduled dream run", agentId, input.staleBefore);
  return result.changes;
}

function toDreamRun(row: DreamRunRow): DreamRunRecord {
  return {
    ...row,
    dry_run: row.dry_run === 1,
  };
}
