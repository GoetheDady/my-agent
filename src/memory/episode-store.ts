import type { Database } from "bun:sqlite";
import { getDb } from "../core/database";
import { appendEvent, listTaskEvents } from "../events/event-log";
import type { RuntimeEvent } from "../events/event-types";
import type {
  TaskFailureStage,
  TaskFailureType,
  TaskRecord,
  TaskStatus,
} from "../tasks/task-types";

export interface EpisodeRecord {
  id: string;
  agent_id: string;
  conversation_id: string | null;
  task_id: string;
  title: string;
  summary: string;
  outcome: string;
  task_status: TaskStatus;
  attempt_count: number;
  failure_type: TaskFailureType | null;
  failure_stage: TaskFailureStage | null;
  retriable: boolean | null;
  time_range_start: number;
  time_range_end: number;
  people: string[];
  tools_used: string[];
  files_touched: string[];
  key_steps: string[];
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
  task_status: TaskStatus;
  attempt_count: number;
  failure_type: TaskFailureType | null;
  failure_stage: TaskFailureStage | null;
  retriable: number | null;
  time_range_start: number;
  time_range_end: number;
  people: string;
  tools_used: string;
  files_touched: string;
  key_steps: string;
  decisions: string;
  problems: string;
  source_event_ids: string;
  importance: number;
  created_at: number;
  updated_at: number;
}

type EpisodeTaskRow = Omit<TaskRecord, "retriable"> & {
  retriable: number | null;
};

export interface EpisodeSearchParams {
  agentId?: string;
  query?: string;
  from?: number;
  to?: number;
  limit?: number;
  taskId?: string;
  taskStatus?: TaskStatus | TaskStatus[];
  failureType?: TaskFailureType;
}

/**
 * 为终态任务创建或更新 episode。
 *
 * Episode 是一次经历摘要，用于跨会话回答“刚才/昨天做了什么”。
 *
 * @param taskId 已完成、失败或取消的任务 id。
 * @param database 可选数据库连接。
 * @returns 创建或更新后的 episode；任务不存在或未进入终态时返回 `null`。
 */
export function upsertEpisodeForTask(taskId: string, database: Database = getDb()): EpisodeRecord | null {
  // Episode 是“这次经历”的摘要，不是长期事实。
  // task 进入终态后生成/更新 episode，让跨会话可以回答“刚才/昨天做了什么，以及结果如何”。
  const task = getEpisodeTask(taskId, database);
  if (!task || !isTerminalTaskStatus(task.status)) return null;

  const events = listTaskEvents(taskId, database);
  const sourceEvents = events.filter((event) => !event.type.startsWith("episode."));
  const existing = getEpisodeByTaskId(taskId, database);
  const now = Date.now();
  // episode 事件时间戳放在本 task 事件之后，保证事件流按顺序看时：
  // 先看到工具/回复，再看到“经历摘要已生成”。
  const episodeEventCreatedAt = Math.max(now, ...events.map((event) => event.created_at)) + 1;
  const episode: EpisodeRecord = {
    id: existing?.id ?? crypto.randomUUID(),
    agent_id: task.agent_id,
    conversation_id: task.conversation_id,
    task_id: task.id,
    title: buildEpisodeTitle(task),
    summary: buildEpisodeSummary(task, sourceEvents),
    outcome: buildEpisodeOutcome(task),
    task_status: task.status,
    attempt_count: task.attempt_count,
    failure_type: task.failure_type,
    failure_stage: task.failure_stage,
    retriable: task.retriable,
    time_range_start: task.started_at ?? task.created_at,
    time_range_end: task.completed_at ?? now,
    people: [task.source_user_id].filter(Boolean),
    tools_used: extractTools(sourceEvents),
    files_touched: extractFiles(sourceEvents),
    key_steps: extractKeySteps(task, sourceEvents),
    decisions: [],
    problems: extractProblems(task, sourceEvents),
    source_event_ids: sourceEvents.map((event) => event.id),
    importance: estimateImportance(task, sourceEvents),
    created_at: existing?.created_at ?? now,
    updated_at: now,
  };

  if (existing) {
    database
      .query(
        `UPDATE episodes
         SET title = ?, summary = ?, outcome = ?, task_status = ?, attempt_count = ?,
             failure_type = ?, failure_stage = ?, retriable = ?,
             time_range_start = ?, time_range_end = ?,
             people = ?, tools_used = ?, files_touched = ?, key_steps = ?, decisions = ?, problems = ?,
             source_event_ids = ?, importance = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        episode.title,
        episode.summary,
        episode.outcome,
        episode.task_status,
        episode.attempt_count,
        episode.failure_type,
        episode.failure_stage,
        episode.retriable === null ? null : (episode.retriable ? 1 : 0),
        episode.time_range_start,
        episode.time_range_end,
        JSON.stringify(episode.people),
        JSON.stringify(episode.tools_used),
        JSON.stringify(episode.files_touched),
        JSON.stringify(episode.key_steps),
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
          task_status, attempt_count, failure_type, failure_stage, retriable,
          time_range_start, time_range_end, people, tools_used, files_touched,
          key_steps, decisions, problems, source_event_ids, importance, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        episode.id,
        episode.agent_id,
        episode.conversation_id,
        episode.task_id,
        episode.title,
        episode.summary,
        episode.outcome,
        episode.task_status,
        episode.attempt_count,
        episode.failure_type,
        episode.failure_stage,
        episode.retriable === null ? null : (episode.retriable ? 1 : 0),
        episode.time_range_start,
        episode.time_range_end,
        JSON.stringify(episode.people),
        JSON.stringify(episode.tools_used),
        JSON.stringify(episode.files_touched),
        JSON.stringify(episode.key_steps),
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

/**
 * 尝试为终态 task 生成 episode，失败时只写审计事件，不回滚 task 终态。
 *
 * @param taskId 任务 id。
 * @param database 可选数据库连接。
 * @returns 成功时返回 episode；任务未终态或生成失败时返回 `null`。
 */
export function finalizeEpisodeForTask(taskId: string, database: Database = getDb()): EpisodeRecord | null {
  try {
    return upsertEpisodeForTask(taskId, database);
  } catch (error) {
    const task = getEpisodeTask(taskId, database);
    appendEvent({
      agent_id: task?.agent_id ?? "default",
      task_id: taskId,
      conversation_id: task?.conversation_id ?? null,
      type: "episode.failed",
      payload: { error: error instanceof Error ? error.message : String(error) },
    }, database);
    return null;
  }
}

/**
 * 根据 taskId 获取 episode。
 *
 * @param taskId 任务 id。
 * @param database 可选数据库连接。
 * @returns 找到时返回 episode，否则返回 `null`。
 */
export function getEpisodeByTaskId(taskId: string, database: Database = getDb()): EpisodeRecord | null {
  const row = database
    .query<EpisodeRow, [string]>(
      `SELECT * FROM episodes WHERE task_id = ? LIMIT 1`,
    )
    .get(taskId);
  return row ? toEpisode(row) : null;
}

/**
 * 根据 episode id 获取经历摘要。
 *
 * @param id episode id。
 * @param database 可选数据库连接。
 * @returns 找到时返回 episode，否则返回 `null`。
 */
export function getEpisode(id: string, database: Database = getDb()): EpisodeRecord | null {
  const row = database
    .query<EpisodeRow, [string]>(
      `SELECT * FROM episodes WHERE id = ? LIMIT 1`,
    )
    .get(id);
  return row ? toEpisode(row) : null;
}

/**
 * 搜索 episode。
 *
 * @param params Agent、关键词、时间范围和数量限制。
 * @param database 可选数据库连接。
 * @returns 匹配的 episode 列表。
 */
export function searchEpisodes(
  params: EpisodeSearchParams = {},
  database: Database = getDb(),
): EpisodeRecord[] {
  // 先按时间范围粗筛，再按关键词过滤。
  // 这里不用向量检索，是因为 episode 通常数量较小，且时间范围对“上午/昨天”问题更重要。
  const agentId = params.agentId ?? "default";
  const limit = params.limit ?? 10;
  const from = params.from ?? 0;
  const to = params.to ?? Number.MAX_SAFE_INTEGER;
  const query = params.query?.trim().toLowerCase();
  const taskStatuses = normalizeTaskStatusFilter(params.taskStatus);
  const conditions = ["agent_id = ?", "time_range_end >= ?", "time_range_start <= ?"];
  const args: Array<string | number> = [agentId, from, to];
  if (params.taskId) {
    conditions.push("task_id = ?");
    args.push(params.taskId);
  }
  if (taskStatuses.length > 0) {
    conditions.push(`task_status IN (${taskStatuses.map(() => "?").join(", ")})`);
    args.push(...taskStatuses);
  }
  if (params.failureType) {
    conditions.push("failure_type = ?");
    args.push(params.failureType);
  }
  args.push(Math.max(limit * 4, limit));

  const rows = database
    .query<EpisodeRow, Array<string | number>>(
      `SELECT * FROM episodes
       WHERE ${conditions.join(" AND ")}
       ORDER BY time_range_end DESC
       LIMIT ?`,
    )
    .all(...args);

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
        ...episode.key_steps,
        episode.task_status,
        episode.failure_type ?? "",
        episode.failure_stage ?? "",
      ].join(" ").toLowerCase();
      return haystack.includes(query);
    });
  }

  return episodes.slice(0, limit);
}

function toEpisode(row: EpisodeRow): EpisodeRecord {
  return {
    ...row,
    retriable: row.retriable === null ? null : row.retriable === 1,
    people: parseStringArray(row.people),
    tools_used: parseStringArray(row.tools_used),
    files_touched: parseStringArray(row.files_touched),
    key_steps: parseStringArray(row.key_steps),
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
  const parts = [
    `用户任务：${task.input}`,
    `终态：${taskStatusLabel(task.status)}；执行次数：${task.attempt_count}`,
  ];
  if (task.result) parts.push(`结果：${task.result.slice(0, 240)}`);
  if (task.error) parts.push(`问题：${task.error.slice(0, 240)}`);
  if (task.failure_type || task.failure_stage) {
    parts.push(
      `失败分类：${task.failure_type ?? "unknown"} / ${task.failure_stage ?? "unknown"}；可重试：${retriableLabel(task.retriable)}`,
    );
  }
  if (toolNames.length > 0) parts.push(`使用工具：${toolNames.join("、")}`);
  const retryCount = events.filter((event) => event.type === "task.retry_scheduled").length;
  if (retryCount > 0) parts.push(`重试记录：${retryCount} 次重新排队`);
  return parts.join("\n");
}

function buildEpisodeOutcome(task: TaskRecord): string {
  if (task.status === "completed") {
    return task.result?.trim() ? `完成：${task.result}` : "完成：任务已完成，但没有保存可用结果文本。";
  }
  if (task.status === "failed") {
    const classification = task.failure_type || task.failure_stage
      ? `（${task.failure_type ?? "unknown"} / ${task.failure_stage ?? "unknown"}，可重试：${retriableLabel(task.retriable)}）`
      : "";
    return `失败：${task.error ?? "未知错误"}${classification}`;
  }
  if (task.status === "canceled") {
    const who = task.failure_type === "system_canceled" ? "系统取消" : "用户取消";
    return `${who}：任务已取消。`;
  }
  return `未终态：${task.status}`;
}

function estimateImportance(task: TaskRecord, events: RuntimeEvent[]): number {
  // importance 是粗略重要性：工具越多、记忆事件越多、失败/重试越多，说明这次经历更可能值得回忆。
  const toolCount = extractTools(events).length;
  const memoryEvents = events.filter((event) => event.type.startsWith("memory.")).length;
  const retryEvents = events.filter((event) => event.type === "task.retry_scheduled").length;
  const lengthScore = Math.min(task.input.length / 200, 0.2);
  const statusScore = task.status === "failed" ? 0.15 : task.status === "canceled" ? 0.03 : 0.08;
  return Math.min(1, 0.4 + statusScore + toolCount * 0.05 + memoryEvents * 0.05 + retryEvents * 0.05 + lengthScore);
}

function extractKeySteps(task: TaskRecord, events: RuntimeEvent[]): string[] {
  const steps: string[] = [];
  for (const event of events) {
    const payload = parsePayload(event.payload);
    if (event.type === "task.started") steps.push("任务开始执行");
    if (event.type === "task.progress.updated") {
      const message = stringValue(payload.progressMessage) ?? stringValue(payload.progressStatus);
      if (message) steps.push(`进度：${message}`);
    }
    if (event.type === "tool.call") {
      const toolName = stringValue(payload.toolName) ?? stringValue(payload.name);
      if (toolName) steps.push(`调用工具：${toolName}`);
    }
    if (event.type === "tool.result") {
      const toolName = stringValue(payload.toolName) ?? stringValue(payload.name);
      steps.push(toolName ? `工具返回：${toolName}` : "工具返回结果");
    }
    if (event.type === "assistant.message") steps.push("生成助手回复");
    if (event.type === "task.retry_scheduled") steps.push("任务重新排队等待重试");
    if (event.type === "task.recovered") steps.push("任务因租约过期恢复到队列");
    if (event.type === "task.failed.classified") {
      steps.push(`失败分类：${stringValue(payload.failureType) ?? "unknown"} / ${stringValue(payload.failureStage) ?? "unknown"}`);
    }
    if (event.type === "channel.delivery.failed") steps.push("外部渠道投递失败");
    if (event.type === "task.completed") steps.push("任务完成");
    if (event.type === "task.failed" || event.type === "task.failed_permanently") steps.push("任务失败");
    if (event.type === "task.canceled") steps.push("任务取消");
  }
  if (steps.length === 0) steps.push(`任务进入终态：${taskStatusLabel(task.status)}`);
  return uniqueStrings(steps).slice(0, 12);
}

function extractProblems(task: TaskRecord, events: RuntimeEvent[]): string[] {
  const problems: string[] = [];
  if (task.error) problems.push(task.error);
  for (const event of events) {
    if (
      event.type !== "task.failed" &&
      event.type !== "task.failed_permanently" &&
      event.type !== "channel.delivery.failed" &&
      event.type !== "episode.failed"
    ) {
      continue;
    }
    const payload = parsePayload(event.payload);
    const message = stringValue(payload.error) ?? stringValue(payload.reason);
    if (message) problems.push(message);
  }
  return uniqueStrings(problems);
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

function getEpisodeTask(taskId: string, database: Database): TaskRecord | null {
  const row = database
    .query<EpisodeTaskRow, [string]>(
      `SELECT *
       FROM tasks
       WHERE id = ?
       LIMIT 1`,
    )
    .get(taskId);
  return row ? {
    ...row,
    retriable: row.retriable === null ? null : row.retriable === 1,
  } : null;
}

function isTerminalTaskStatus(status: TaskStatus): boolean {
  return status === "completed" || status === "failed" || status === "canceled";
}

function normalizeTaskStatusFilter(value: TaskStatus | TaskStatus[] | undefined): TaskStatus[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function taskStatusLabel(status: TaskStatus): string {
  if (status === "completed") return "已完成";
  if (status === "failed") return "已失败";
  if (status === "canceled") return "已取消";
  if (status === "running") return "运行中";
  return "等待中";
}

function retriableLabel(retriable: boolean | null): string {
  if (retriable === true) return "是";
  if (retriable === false) return "否";
  return "未知";
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}
