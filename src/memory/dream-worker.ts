import type { Database } from "bun:sqlite";
import { getDb } from "../core/database";
import {
  syncProfileFromMemories,
  type ProfileSyncPort,
} from "../agents/profile-sync";
import { appendEvent } from "../events/event-log";
import { dedupeActiveMemories, type MemoryDedupeGroup, type MemoryDedupeStore } from "./dedupe";
import {
  captureMemorySnapshots,
  createMemoryDecision,
  listMemoryDecisions,
  type MemoryDecisionMemoryStore,
  type MemoryDecisionRecord,
} from "./decision-store";
import {
  completeDreamRun,
  createDreamRun,
  failDreamRun,
  listDreamRuns,
  type DreamRunRecord,
  type DreamRunTrigger,
} from "./dream-run-store";
import { findDuplicateMemoryContent } from "./duplicate";
import { searchEpisodes } from "./episode-store";
import { listReviewItems } from "./review-store";
import {
  addMemory,
  getMemory,
  listMemories,
  restoreMemorySnapshot,
  setMemoryStatus,
  updateMemory,
  type Memory,
} from "./store";

const DEFAULT_TIMEZONE = "Asia/Shanghai";

export { listDreamRuns };

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
  dreamRun: DreamRunRecord;
  summary: DailySummaryRecord;
  dedupe: Awaited<ReturnType<typeof dedupeActiveMemories>>;
  decisions: MemoryDecisionRecord[];
  decisionCount: number;
  pendingReviewCount: number;
}

export interface DreamMemoryStore extends MemoryDedupeStore, MemoryDecisionMemoryStore {
  listMemories: typeof listMemories;
  addMemory: typeof addMemory;
  updateMemory: typeof updateMemory;
}

const defaultMemoryStore: DreamMemoryStore = {
  listMemories,
  getMemory,
  addMemory,
  updateMemory,
  setMemoryStatus,
  restoreMemorySnapshot,
};

let running = false;

/**
 * Dream Worker：后台“睡眠整理”流程。
 *
 * 与每轮对话后的 MemoryExtractionWorker 不同，Dream Worker 面向一整天/一批 episodes：
 * - dry-run：只预览 summary、去重和决策，不修改 active memory。
 * - real-run：自动执行高置信、可审计、可撤销的整理决策。
 *
 * 安全原则：
 * - 不硬删除记忆，只把旧记忆改成 inactive/superseded。
 * - 每次应用都写 memory_decisions，保存 before/after 快照。
 * - profile_sync 失败不回滚 dream decisions，只记录事件。
 *
 * @param options Dream Worker 运行配置，包括日期、是否 dry-run、数据库和可注入存储端口。
 * @returns 本次整理的 summary、去重预览、决策列表和运行记录。
 * @throws 当已有 Dream Worker 正在运行时抛出错误，保证整理串行执行。
 */
export async function runDreamWorker(
  options: {
    agentId?: string;
    date?: string;
    dryRun?: boolean;
    timezone?: string;
    trigger?: DreamRunTrigger;
    database?: Database;
    dedupeStore?: MemoryDedupeStore;
    memoryStore?: DreamMemoryStore;
    profileSync?: ProfileSyncPort;
  } = {},
): Promise<DreamRunResult> {
  if (running) throw new Error("Dream worker is already running");
  running = true;

  const database = options.database ?? getDb();
  const agentId = options.agentId ?? "default";
  const timezone = options.timezone ?? DEFAULT_TIMEZONE;
  const date = options.date ?? dateKey(Date.now(), timezone);
  const dryRun = options.dryRun ?? false;
  const trigger = options.trigger ?? "manual";
  const memoryStore = options.memoryStore ?? defaultMemoryStore;
  const profileSync = options.profileSync ?? syncProfileFromMemories;
  const dreamRun = createDreamRun({ agentId, date, timezone, trigger, dryRun }, database);

  appendEvent({
    agent_id: agentId,
    type: "dream.started",
    payload: { date, dryRun, timezone, trigger, dreamRunId: dreamRun.id },
  }, database);

  try {
    // 每次 dream 都先产生日总结；dry-run 返回临时 summary，real-run 才写入 daily_summaries。
    const summary = upsertDailySummary({ agentId, date, timezone, dryRun }, database);
    // 先用 dry-run 去重获得候选组，real-run 再把候选组转成可审计 decision。
    const dedupePreview = await dedupeActiveMemories({
      dryRun: true,
      store: options.dedupeStore ?? memoryStore,
    });
    const decisions = dryRun
      ? []
      : [
        ...await applyExactDedupeDecisions({
          agentId,
          dreamRunId: dreamRun.id,
          groups: dedupePreview.duplicateGroups,
          database,
          store: memoryStore,
        }),
        ...await applyConflictUpdateDecisions({
          agentId,
          dreamRunId: dreamRun.id,
          database,
          store: memoryStore,
        }),
        ...await applyEpisodeDerivedMemoryDecisions({
          agentId,
          dreamRunId: dreamRun.id,
          date,
          timezone,
          database,
          store: memoryStore,
        }),
      ];
    // dedupe 输出要体现 real-run 已经实际停用/替代了哪些记忆，供前端展示。
    const inactiveMemoryIds = decisions
      .filter((decision) => decision.status === "applied")
      .flatMap((decision) =>
        decision.after_snapshot
          .filter((snapshot) => snapshot.status === "inactive" || snapshot.status === "superseded")
          .map((snapshot) => snapshot.id),
      );
    const dedupe = {
      ...dedupePreview,
      dryRun,
      inactiveMemoryIds,
    };
    if (!dryRun && decisions.length > 0) {
      summary.memory_change_ids = decisions.map((decision) => decision.id);
      updateDailySummaryMemoryChanges(summary.id, summary.memory_change_ids, database);
      // Dream Worker 沉淀出的 active memory 也要同步到 user.md / soul.md 稳定认知层。
      await syncProfilesForDreamDecisions({
        agentId,
        database,
        profileSync,
        decisions,
        store: memoryStore,
      });
    }
    const pendingReviewCount = listReviewItems({ agentId, status: "pending", limit: 1000 }, database).length;
    const completedRun = completeDreamRun(dreamRun.id, database) ?? dreamRun;
    const persistedDecisions = dryRun
      ? []
      : listMemoryDecisions({ agentId, limit: Math.max(decisions.length, 1) }, database)
        .filter((decision) => decision.dream_run_id === dreamRun.id);
    const result: DreamRunResult = {
      dryRun,
      date,
      dreamRun: completedRun,
      summary,
      dedupe,
      decisions: persistedDecisions,
      decisionCount: persistedDecisions.length,
      pendingReviewCount,
    };

    appendEvent({
      agent_id: agentId,
      type: "dream.completed",
      payload: {
        date,
        dryRun,
        trigger,
        dreamRunId: dreamRun.id,
        episodeCount: summary.episode_ids.length,
        duplicateGroupCount: dedupe.duplicateGroups.length,
        decisionCount: persistedDecisions.length,
        appliedDecisionCount: persistedDecisions.filter((decision) => decision.status === "applied").length,
        skippedDecisionCount: persistedDecisions.filter((decision) => decision.status === "skipped").length,
      },
    }, database);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failDreamRun(dreamRun.id, message, database);
    appendEvent({
      agent_id: agentId,
      type: "dream.failed",
      payload: { date, dryRun, trigger, dreamRunId: dreamRun.id, error: message },
    }, database);
    throw error;
  } finally {
    running = false;
  }
}

async function applyExactDedupeDecisions(input: {
  agentId: string;
  dreamRunId: string;
  groups: MemoryDedupeGroup[];
  database: Database;
  store: DreamMemoryStore;
}): Promise<MemoryDecisionRecord[]> {
  const decisions: MemoryDecisionRecord[] = [];

  for (const group of input.groups) {
    const targetMemoryIds = [group.keptMemoryId, ...group.duplicateMemoryIds];
    const beforeSnapshot = await captureMemorySnapshots(targetMemoryIds, input.store);
    if (beforeSnapshot.length !== targetMemoryIds.length) {
      // 目标记忆缺失时跳过，避免一半应用一半失败造成不可解释状态。
      decisions.push(createMemoryDecision({
        agentId: input.agentId,
        dreamRunId: input.dreamRunId,
        type: "exact_dedupe",
        status: "skipped",
        title: "跳过重复记忆整理",
        reason: "部分目标记忆不存在，无法安全应用去重。",
        confidence: 0.6,
        targetMemoryIds,
        beforeSnapshot,
      }, input.database));
      continue;
    }

    // 确定重复：保留质量最高/置信更高的一条，其余只标 inactive，不删除。
    for (const duplicateId of group.duplicateMemoryIds) {
      await input.store.setMemoryStatus(duplicateId, "inactive");
    }
    const afterSnapshot = await captureMemorySnapshots(targetMemoryIds, input.store);
    decisions.push(createMemoryDecision({
      agentId: input.agentId,
      dreamRunId: input.dreamRunId,
      type: "exact_dedupe",
      status: "applied",
      title: "停用重复记忆",
      reason: `确定为重复记忆，保留 ${group.keptMemoryId}，停用 ${group.duplicateMemoryIds.join("、")}。`,
      confidence: 0.95,
      targetMemoryIds,
      beforeSnapshot,
      afterSnapshot,
    }, input.database));
  }

  return decisions;
}

async function applyConflictUpdateDecisions(input: {
  agentId: string;
  dreamRunId: string;
  database: Database;
  store: DreamMemoryStore;
}): Promise<MemoryDecisionRecord[]> {
  const { memories } = await input.store.listMemories({ status: "active", pageSize: 1000 });
  const byObject = new Map<string, { memory: Memory; polarity: "positive" | "negative"; object: string }[]>();
  // v1 使用确定性规则识别“喜欢/不喜欢 X”这类偏好冲突，不依赖模型自由判断。
  for (const memory of memories) {
    const fact = extractPreferenceFact(memory.content);
    if (!fact) continue;
    const group = byObject.get(fact.object) ?? [];
    group.push({ memory, ...fact });
    byObject.set(fact.object, group);
  }

  const decisions: MemoryDecisionRecord[] = [];
  const usedMemoryIds = new Set<string>();
  for (const facts of byObject.values()) {
    const positives = facts.filter((fact) => fact.polarity === "positive");
    const negatives = facts.filter((fact) => fact.polarity === "negative");
    if (positives.length === 0 || negatives.length === 0) continue;

    const sorted = [...facts].sort((a, b) =>
      b.memory.updated_at - a.memory.updated_at
      || b.memory.created_at - a.memory.created_at
      || a.memory.id.localeCompare(b.memory.id),
    );
    const newest = sorted[0];
    const previous = sorted.find((fact) => fact.polarity !== newest?.polarity);
    if (!newest || !previous) continue;
    if (usedMemoryIds.has(newest.memory.id) || usedMemoryIds.has(previous.memory.id)) continue;
    usedMemoryIds.add(newest.memory.id);
    usedMemoryIds.add(previous.memory.id);

    const targetMemoryIds = [newest.memory.id, previous.memory.id];
    const beforeSnapshot = await captureMemorySnapshots(targetMemoryIds, input.store);
    // 冲突处理保留变化轨迹，而不是只留下最新偏好；这能回答“以前有没有改过主意”。
    const nextContent = hasChangeTrace(newest.memory.content)
      ? newest.memory.content
      : `用户曾经${formatPreferenceFact(previous)}；现在明确表示${formatPreferenceFact(newest)}。`;
    await input.store.updateMemory(newest.memory.id, nextContent);
    await input.store.setMemoryStatus(previous.memory.id, "superseded");
    const afterSnapshot = await captureMemorySnapshots(targetMemoryIds, input.store);

    decisions.push(createMemoryDecision({
      agentId: input.agentId,
      dreamRunId: input.dreamRunId,
      type: "conflict_update",
      status: "applied",
      title: "合并偏好变化轨迹",
      reason: "检测到同一对象的正反偏好冲突，自动保留变化轨迹并停用被覆盖的旧记忆。",
      confidence: 0.85,
      targetMemoryIds,
      beforeSnapshot,
      afterSnapshot,
    }, input.database));
  }

  return decisions;
}

async function applyEpisodeDerivedMemoryDecisions(input: {
  agentId: string;
  dreamRunId: string;
  date: string;
  timezone: string;
  database: Database;
  store: DreamMemoryStore;
}): Promise<MemoryDecisionRecord[]> {
  const range = dayRange(input.date, input.timezone);
  const episodes = searchEpisodes({
    agentId: input.agentId,
    from: range.from,
    to: range.to,
    limit: 100,
  }, input.database);
  const joined = episodes.map((episode) => `${episode.title}\n${episode.summary}\n${episode.outcome}`).join("\n");
  if (episodes.length < 2 || joined.length === 0) return [];

  // v1 先做少量确定性候选：多次 episode 反复出现的流程/风险才自动沉淀。
  // 后续如果接入模型提炼，也必须保留 confidence 阈值和 decision 快照。
  const active = await input.store.listMemories({ status: "active", pageSize: 1000 });
  const candidates = [
    {
      type: "procedural_extract" as const,
      memoryType: "procedural",
      content: "修改记忆系统时，应同步更新计划文档，并运行 bun test、bun run typecheck、bun run lint 做验证。",
      matches: [/记忆系统/, /计划文档|文档/, /bun test|typecheck|lint|验证/],
      title: "沉淀记忆系统修改流程",
      reason: "多个 episode 反复出现记忆系统修改、计划文档同步和验证命令。",
    },
    {
      type: "reflective_extract" as const,
      memoryType: "reflective",
      content: "记忆系统出现重复记忆时，不能只做整条文本去重；还要处理事实里包含偏好的拆分重复。",
      matches: [/重复记忆|去重/, /偏好/, /事实/],
      title: "沉淀重复记忆风险",
      reason: "多个 episode 提到重复记忆、事实和偏好拆分问题。",
    },
  ];

  const decisions: MemoryDecisionRecord[] = [];
  for (const candidate of candidates) {
    if (!candidate.matches.every((pattern) => pattern.test(joined))) continue;
    if (findDuplicateMemoryContent(candidate.content, active.memories)) continue;

    const saved = await input.store.addMemory({
      content: candidate.content,
      memory_type: candidate.memoryType,
      status: "active",
      confidence: 0.78,
      source_text: JSON.stringify({
        source: "dream_worker",
        episodeIds: episodes.map((episode) => episode.id),
      }),
    });
    if (!saved) continue;
    active.memories.push(saved);
    const afterSnapshot = await captureMemorySnapshots([saved.id], input.store);
    decisions.push(createMemoryDecision({
      agentId: input.agentId,
      dreamRunId: input.dreamRunId,
      type: candidate.type,
      status: "applied",
      title: candidate.title,
      reason: candidate.reason,
      confidence: 0.78,
      createdMemoryIds: [saved.id],
      sourceEventIds: episodes.flatMap((episode) => episode.source_event_ids),
      afterSnapshot,
    }, input.database));
  }

  return decisions;
}

async function syncProfilesForDreamDecisions(input: {
  agentId: string;
  database: Database;
  profileSync: ProfileSyncPort;
  decisions: MemoryDecisionRecord[];
  store: DreamMemoryStore;
}): Promise<void> {
  // 只同步仍处于 active 的记忆；inactive/superseded 是历史证据，不应进入当前画像文件。
  const memoryIds = uniqueStrings(input.decisions
    .filter((decision) => decision.status === "applied")
    .flatMap((decision) => [
      ...decision.created_memory_ids,
      ...decision.target_memory_ids,
    ]));
  if (memoryIds.length === 0) return;

  const memories: Memory[] = [];
  for (const id of memoryIds) {
    const memory = await input.store.getMemory(id);
    if (memory?.status === "active") memories.push(memory);
  }
  if (memories.length === 0) return;

  try {
    await input.profileSync({
      agentId: input.agentId,
      userId: "default",
      database: input.database,
      source: "dream_worker",
      memories,
      reason: "dream worker memory decisions",
      sourceEventIds: uniqueStrings(input.decisions.flatMap((decision) => decision.source_event_ids)),
    });
  } catch (error) {
    appendEvent({
      agent_id: input.agentId,
      type: "profile.sync.failed",
      payload: {
        source: "dream_worker",
        memoryIds: memories.map((memory) => memory.id),
        error: error instanceof Error ? error.message : String(error),
      },
    }, input.database);
  }
}

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

function updateDailySummaryMemoryChanges(
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

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
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

function extractPreferenceFact(content: string): { polarity: "positive" | "negative"; object: string } | null {
  // 用简单中文偏好句式抽取冲突对象，例如“喜欢西红柿”和“不喜欢西红柿”。
  // 这是保守规则：识别不了就不自动合并，避免误改复杂偏好。
  const normalized = content
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[，。,.；;：:"“”'‘’、！!？?（）()【】[\]《》<>]/g, "");
  const negativeMarkers = ["不喜欢", "不偏好", "不需要", "不想要", "讨厌"];
  for (const marker of negativeMarkers) {
    const index = normalized.lastIndexOf(marker);
    if (index < 0) continue;
    const object = cleanupPreferenceObject(normalized.slice(index + marker.length));
    return object.length >= 2 ? { polarity: "negative", object } : null;
  }

  const positiveMarkers = ["喜欢", "偏好", "需要", "想要", "希望", "倾向"];
  for (const marker of positiveMarkers) {
    const index = normalized.lastIndexOf(marker);
    if (index < 0) continue;
    const previous = normalized[index - 1];
    if (previous === "不" || previous === "没" || previous === "无" || previous === "無") continue;
    const object = cleanupPreferenceObject(normalized.slice(index + marker.length));
    return object.length >= 2 ? { polarity: "positive", object } : null;
  }

  return null;
}

function cleanupPreferenceObject(object: string): string {
  return object
    .replace(/^(用户|本人|我|现在|已经|明确表示|改为|变成|了)+/g, "")
    .replace(/(了|。|\.|；|;)+$/g, "")
    .slice(0, 40);
}

function hasChangeTrace(content: string): boolean {
  return /(曾经|曾表示|以前).*(现在|改为|不再|不喜欢|变化)/.test(content);
}

function formatPreferenceFact(fact: { polarity: "positive" | "negative"; object: string }): string {
  return `${fact.polarity === "positive" ? "喜欢" : "不喜欢"}${fact.object}`;
}
