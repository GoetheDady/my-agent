import type { Database } from "bun:sqlite";
import { getDb } from "../../core/database";
import { searchEpisodes } from "../episode-store";
import { dayRange } from "./time";
import { DEFAULT_TIMEZONE, type DailySummaryRecord, type DailySummaryRow } from "./types";

/**
 * 获取某天的日总结。
 *
 * @param date 日期字符串，格式通常为 `YYYY-MM-DD`。
 * @param agentId Agent 标识，默认 `default`。
 * @param timezone 时区，默认 `Asia/Shanghai`。
 * @param database 可选数据库连接。
 * @returns 找到时返回日总结，否则返回 `null`。
 */
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

/**
 * 列出最近的日总结。
 *
 * @param params Agent 和数量限制。
 * @param database 可选数据库连接。
 * @returns 按日期倒序排列的日总结列表。
 */
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

export function upsertDailySummary(
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
  // 目前 daily summary 是确定性摘要，避免 Dream Worker 在 MVP 阶段引入额外模型调用不稳定性。
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

export function updateDailySummaryMemoryChanges(
  id: string,
  memoryChangeIds: string[],
  database: Database,
): void {
  database
    .query(
      `UPDATE daily_summaries
       SET memory_change_ids = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(JSON.stringify(memoryChangeIds), Date.now(), id);
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
