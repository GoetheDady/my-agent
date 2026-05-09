import type { Database } from "bun:sqlite";
import { getDb } from "../core/database";
import { appendEvent, listTaskEvents } from "../events/event-log";
import type { RuntimeEvent } from "../events/event-types";
import { getTask } from "../tasks/task-store";
import type { TaskRecord } from "../tasks/task-types";

export interface EpisodeRecord {
  id: string;
  agent_id: string;
  conversation_id: string | null;
  task_id: string;
  title: string;
  summary: string;
  outcome: string;
  time_range_start: number;
  time_range_end: number;
  people: string[];
  tools_used: string[];
  files_touched: string[];
  decisions: string[];
  problems: string[];
  source_event_ids: string[];
  importance: number;
  created_at: number;
  updated_at: number;
}

interface EpisodeRow {
  id: string;
  agent_id: string;
  conversation_id: string | null;
  task_id: string;
  title: string;
  summary: string;
  outcome: string;
  time_range_start: number;
  time_range_end: number;
  people: string;
  tools_used: string;
  files_touched: string;
  decisions: string;
  problems: string;
  source_event_ids: string;
  importance: number;
  created_at: number;
  updated_at: number;
}

export interface EpisodeSearchParams {
  agentId?: string;
  query?: string;
  from?: number;
  to?: number;
  limit?: number;
}

export function upsertEpisodeForTask(taskId: string, database: Database = getDb()): EpisodeRecord | null {
  const task = getTask(taskId, database);
  if (!task || task.status !== "completed") return null;

  const events = listTaskEvents(taskId, database);
  const existing = getEpisodeByTaskId(taskId, database);
  const now = Date.now();
  const episodeEventCreatedAt = Math.max(now, ...events.map((event) => event.created_at)) + 1;
  const episode: EpisodeRecord = {
    id: existing?.id ?? crypto.randomUUID(),
    agent_id: task.agent_id,
    conversation_id: task.conversation_id,
    task_id: task.id,
    title: buildEpisodeTitle(task),
    summary: buildEpisodeSummary(task, events),
    outcome: task.result ?? "",
    time_range_start: task.started_at ?? task.created_at,
    time_range_end: task.completed_at ?? now,
    people: [task.source_user_id].filter(Boolean),
    tools_used: extractTools(events),
    files_touched: extractFiles(events),
    decisions: [],
    problems: task.error ? [task.error] : [],
    source_event_ids: events.map((event) => event.id),
    importance: estimateImportance(task, events),
    created_at: existing?.created_at ?? now,
    updated_at: now,
  };

  if (existing) {
    database
      .query(
        `UPDATE episodes
         SET title = ?, summary = ?, outcome = ?, time_range_start = ?, time_range_end = ?,
             people = ?, tools_used = ?, files_touched = ?, decisions = ?, problems = ?,
             source_event_ids = ?, importance = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        episode.title,
        episode.summary,
        episode.outcome,
        episode.time_range_start,
        episode.time_range_end,
        JSON.stringify(episode.people),
        JSON.stringify(episode.tools_used),
        JSON.stringify(episode.files_touched),
        JSON.stringify(episode.decisions),
        JSON.stringify(episode.problems),
        JSON.stringify(episode.source_event_ids),
        episode.importance,
        episode.updated_at,
        episode.id,
      );
    appendEvent({
      agent_id: task.agent_id,
      task_id: task.id,
      conversation_id: task.conversation_id,
      type: "episode.updated",
      payload: { episodeId: episode.id, title: episode.title },
      created_at: episodeEventCreatedAt,
    }, database);
  } else {
    database
      .query(
        `INSERT INTO episodes (
          id, agent_id, conversation_id, task_id, title, summary, outcome,
          time_range_start, time_range_end, people, tools_used, files_touched,
          decisions, problems, source_event_ids, importance, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        episode.id,
        episode.agent_id,
        episode.conversation_id,
        episode.task_id,
        episode.title,
        episode.summary,
        episode.outcome,
        episode.time_range_start,
        episode.time_range_end,
        JSON.stringify(episode.people),
        JSON.stringify(episode.tools_used),
        JSON.stringify(episode.files_touched),
        JSON.stringify(episode.decisions),
        JSON.stringify(episode.problems),
        JSON.stringify(episode.source_event_ids),
        episode.importance,
        episode.created_at,
        episode.updated_at,
      );
    appendEvent({
      agent_id: task.agent_id,
      task_id: task.id,
      conversation_id: task.conversation_id,
      type: "episode.created",
      payload: { episodeId: episode.id, title: episode.title },
      created_at: episodeEventCreatedAt,
    }, database);
  }

  return episode;
}

export function getEpisodeByTaskId(taskId: string, database: Database = getDb()): EpisodeRecord | null {
  const row = database
    .query<EpisodeRow, [string]>(
      `SELECT * FROM episodes WHERE task_id = ? LIMIT 1`,
    )
    .get(taskId);
  return row ? toEpisode(row) : null;
}

export function getEpisode(id: string, database: Database = getDb()): EpisodeRecord | null {
  const row = database
    .query<EpisodeRow, [string]>(
      `SELECT * FROM episodes WHERE id = ? LIMIT 1`,
    )
    .get(id);
  return row ? toEpisode(row) : null;
}

export function searchEpisodes(
  params: EpisodeSearchParams = {},
  database: Database = getDb(),
): EpisodeRecord[] {
  const agentId = params.agentId ?? "default";
  const limit = params.limit ?? 10;
  const from = params.from ?? 0;
  const to = params.to ?? Number.MAX_SAFE_INTEGER;
  const query = params.query?.trim().toLowerCase();
  const rows = database
    .query<EpisodeRow, [string, number, number, number]>(
      `SELECT * FROM episodes
       WHERE agent_id = ? AND time_range_end >= ? AND time_range_start <= ?
       ORDER BY time_range_end DESC
       LIMIT ?`,
    )
    .all(agentId, from, to, Math.max(limit * 4, limit));

  let episodes = rows.map(toEpisode);
  if (query) {
    episodes = episodes.filter((episode) => {
      const haystack = [
        episode.title,
        episode.summary,
        episode.outcome,
        ...episode.tools_used,
        ...episode.files_touched,
        ...episode.problems,
      ].join(" ").toLowerCase();
      return haystack.includes(query);
    });
  }

  return episodes.slice(0, limit);
}

function toEpisode(row: EpisodeRow): EpisodeRecord {
  return {
    ...row,
    people: parseStringArray(row.people),
    tools_used: parseStringArray(row.tools_used),
    files_touched: parseStringArray(row.files_touched),
    decisions: parseStringArray(row.decisions),
    problems: parseStringArray(row.problems),
    source_event_ids: parseStringArray(row.source_event_ids),
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

function buildEpisodeTitle(task: TaskRecord): string {
  const compact = task.input.replace(/\s+/g, " ").trim();
  return compact.length > 40 ? `${compact.slice(0, 40)}...` : compact || "未命名任务";
}

function buildEpisodeSummary(task: TaskRecord, events: RuntimeEvent[]): string {
  const toolNames = extractTools(events);
  const parts = [`用户任务：${task.input}`];
  if (task.result) parts.push(`结果：${task.result.slice(0, 240)}`);
  if (toolNames.length > 0) parts.push(`使用工具：${toolNames.join("、")}`);
  return parts.join("\n");
}

function estimateImportance(task: TaskRecord, events: RuntimeEvent[]): number {
  const toolCount = extractTools(events).length;
  const memoryEvents = events.filter((event) => event.type.startsWith("memory.")).length;
  const lengthScore = Math.min(task.input.length / 200, 0.2);
  return Math.min(1, 0.45 + toolCount * 0.05 + memoryEvents * 0.05 + lengthScore);
}

function extractTools(events: RuntimeEvent[]): string[] {
  const tools = new Set<string>();
  for (const event of events) {
    if (!event.type.startsWith("tool.")) continue;
    const payload = parsePayload(event.payload);
    const toolName = stringValue(payload.toolName) ?? stringValue(payload.name);
    if (toolName) tools.add(toolName);
  }
  return Array.from(tools);
}

function extractFiles(events: RuntimeEvent[]): string[] {
  const files = new Set<string>();
  for (const event of events) {
    const payload = parsePayload(event.payload);
    const args = payload.args;
    if (args && typeof args === "object" && !Array.isArray(args)) {
      const path = stringValue((args as Record<string, unknown>).path);
      if (path) files.add(path);
    }
  }
  return Array.from(files);
}

function parsePayload(payload: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(payload) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
