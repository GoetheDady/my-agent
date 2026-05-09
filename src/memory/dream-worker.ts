import type { Database } from "bun:sqlite";
import { getDb } from "../core/database";
import { appendEvent } from "../events/event-log";
import { dedupeActiveMemories, type MemoryDedupeStore } from "./dedupe";
import { searchEpisodes } from "./episode-store";
import { listReviewItems } from "./review-store";

const DEFAULT_TIMEZONE = "Asia/Shanghai";

export interface DailySummaryRecord {
  id: string;
  agent_id: string;
  date: string;
  timezone: string;
  summary: string;
  highlights: string[];
  episode_ids: string[];
  memory_change_ids: string[];
  open_questions: string[];
  created_at: number;
  updated_at: number;
}

interface DailySummaryRow {
  id: string;
  agent_id: string;
  date: string;
  timezone: string;
  summary: string;
  highlights: string;
  episode_ids: string;
  memory_change_ids: string;
  open_questions: string;
  created_at: number;
  updated_at: number;
}

export interface DreamRunResult {
  dryRun: boolean;
  date: string;
  summary: DailySummaryRecord;
  dedupe: Awaited<ReturnType<typeof dedupeActiveMemories>>;
  pendingReviewCount: number;
}

let running = false;

export async function runDreamWorker(
  options: {
    agentId?: string;
    date?: string;
    dryRun?: boolean;
    timezone?: string;
    database?: Database;
    dedupeStore?: MemoryDedupeStore;
  } = {},
): Promise<DreamRunResult> {
  if (running) throw new Error("Dream worker is already running");
  running = true;

  const database = options.database ?? getDb();
  const agentId = options.agentId ?? "default";
  const timezone = options.timezone ?? DEFAULT_TIMEZONE;
  const date = options.date ?? dateKey(Date.now(), timezone);
  const dryRun = options.dryRun ?? false;

  appendEvent({
    agent_id: agentId,
    type: "dream.started",
    payload: { date, dryRun, timezone },
  }, database);

  try {
    const summary = upsertDailySummary({ agentId, date, timezone, dryRun }, database);
    const dedupe = await dedupeActiveMemories({ dryRun, store: options.dedupeStore });
    const pendingReviewCount = listReviewItems({ agentId, status: "pending", limit: 1000 }, database).length;
    const result: DreamRunResult = { dryRun, date, summary, dedupe, pendingReviewCount };

    appendEvent({
      agent_id: agentId,
      type: "dream.completed",
      payload: {
        date,
        dryRun,
        episodeCount: summary.episode_ids.length,
        duplicateGroupCount: dedupe.duplicateGroups.length,
        pendingReviewCount,
      },
    }, database);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    appendEvent({
      agent_id: agentId,
      type: "dream.failed",
      payload: { date, dryRun, error: message },
    }, database);
    throw error;
  } finally {
    running = false;
  }
}

export function getDailySummary(
  date: string,
  agentId = "default",
  timezone = DEFAULT_TIMEZONE,
  database: Database = getDb(),
): DailySummaryRecord | null {
  const row = database
    .query<DailySummaryRow, [string, string, string]>(
      `SELECT * FROM daily_summaries
       WHERE agent_id = ? AND date = ? AND timezone = ?
       LIMIT 1`,
    )
    .get(agentId, date, timezone);
  return row ? toDailySummary(row) : null;
}

export function listDailySummaries(
  params: { agentId?: string; limit?: number } = {},
  database: Database = getDb(),
): DailySummaryRecord[] {
  const agentId = params.agentId ?? "default";
  const limit = params.limit ?? 7;
  return database
    .query<DailySummaryRow, [string, number]>(
      `SELECT * FROM daily_summaries
       WHERE agent_id = ?
       ORDER BY date DESC
       LIMIT ?`,
    )
    .all(agentId, limit)
    .map(toDailySummary);
}

function upsertDailySummary(
  input: { agentId: string; date: string; timezone: string; dryRun: boolean },
  database: Database,
): DailySummaryRecord {
  const range = dayRange(input.date, input.timezone);
  const episodes = searchEpisodes({
    agentId: input.agentId,
    from: range.from,
    to: range.to,
    limit: 100,
  }, database);
  const existing = getDailySummary(input.date, input.agentId, input.timezone, database);
  const now = Date.now();
  const summary: DailySummaryRecord = {
    id: existing?.id ?? crypto.randomUUID(),
    agent_id: input.agentId,
    date: input.date,
    timezone: input.timezone,
    summary: episodes.length > 0
      ? `当天完成 ${episodes.length} 个 episode：${episodes.map((episode) => episode.title).slice(0, 5).join("；")}`
      : "当天没有可总结的 episode。",
    highlights: episodes.slice(0, 5).map((episode) => episode.title),
    episode_ids: episodes.map((episode) => episode.id),
    memory_change_ids: [],
    open_questions: [],
    created_at: existing?.created_at ?? now,
    updated_at: now,
  };

  if (input.dryRun) return summary;

  if (existing) {
    database
      .query(
        `UPDATE daily_summaries
         SET summary = ?, highlights = ?, episode_ids = ?, memory_change_ids = ?,
             open_questions = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        summary.summary,
        JSON.stringify(summary.highlights),
        JSON.stringify(summary.episode_ids),
        JSON.stringify(summary.memory_change_ids),
        JSON.stringify(summary.open_questions),
        summary.updated_at,
        summary.id,
      );
    return summary;
  }

  database
    .query(
      `INSERT INTO daily_summaries (
        id, agent_id, date, timezone, summary, highlights, episode_ids,
        memory_change_ids, open_questions, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      summary.id,
      summary.agent_id,
      summary.date,
      summary.timezone,
      summary.summary,
      JSON.stringify(summary.highlights),
      JSON.stringify(summary.episode_ids),
      JSON.stringify(summary.memory_change_ids),
      JSON.stringify(summary.open_questions),
      summary.created_at,
      summary.updated_at,
    );
  return summary;
}

function toDailySummary(row: DailySummaryRow): DailySummaryRecord {
  return {
    ...row,
    highlights: parseStringArray(row.highlights),
    episode_ids: parseStringArray(row.episode_ids),
    memory_change_ids: parseStringArray(row.memory_change_ids),
    open_questions: parseStringArray(row.open_questions),
  };
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function dateKey(timestamp: number, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(timestamp));
}

function dayRange(date: string, timezone: string): { from: number; to: number } {
  const offset = timezone === "Asia/Shanghai" ? "+08:00" : "Z";
  const from = new Date(`${date}T00:00:00.000${offset}`).getTime();
  const to = new Date(`${date}T23:59:59.999${offset}`).getTime();
  return { from, to };
}
