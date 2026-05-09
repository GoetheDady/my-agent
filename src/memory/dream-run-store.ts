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

export function createDreamRun(input: {
  agentId?: string;
  date: string;
  timezone: string;
  trigger?: DreamRunTrigger;
  dryRun?: boolean;
  startedAt?: number;
}, database: Database = getDb()): DreamRunRecord {
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

export function getDreamRun(id: string, database: Database = getDb()): DreamRunRecord | null {
  const row = database
    .query<DreamRunRow, [string]>(
      `SELECT * FROM dream_runs WHERE id = ? LIMIT 1`,
    )
    .get(id);
  return row ? toDreamRun(row) : null;
}

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

export function hasCompletedScheduledDreamRun(
  input: { agentId?: string; date: string },
  database: Database = getDb(),
): boolean {
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

export function hasFreshRunningScheduledDreamRun(
  input: { agentId?: string; date: string; staleBefore: number },
  database: Database = getDb(),
): boolean {
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

export function markStaleScheduledDreamRunsFailed(
  input: { agentId?: string; staleBefore: number; error?: string },
  database: Database = getDb(),
): number {
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
