import type { Database } from "bun:sqlite";
import { getDb } from "../core/database";
import { appendEvent } from "../events/event-log";
import {
  getMemory,
  restoreMemorySnapshot,
  setMemoryStatus,
  type Memory,
  type MemorySnapshotRestore,
} from "./store";

export type MemoryDecisionType =
  | "exact_dedupe"
  | "semantic_merge"
  | "conflict_update"
  | "procedural_extract"
  | "reflective_extract";

export type MemoryDecisionStatus = "applied" | "skipped" | "failed" | "undone";

export interface MemoryDecisionSnapshot extends MemorySnapshotRestore {
  updated_at: number;
}

export interface MemoryDecisionRecord {
  id: string;
  agent_id: string;
  dream_run_id: string | null;
  type: MemoryDecisionType;
  status: MemoryDecisionStatus;
  title: string;
  reason: string;
  confidence: number;
  target_memory_ids: string[];
  created_memory_ids: string[];
  source_event_ids: string[];
  before_snapshot: MemoryDecisionSnapshot[];
  after_snapshot: MemoryDecisionSnapshot[];
  created_at: number;
  applied_at: number | null;
  undone_at: number | null;
  error: string | null;
}

interface MemoryDecisionRow {
  id: string;
  agent_id: string;
  dream_run_id: string | null;
  type: MemoryDecisionType;
  status: MemoryDecisionStatus;
  title: string;
  reason: string;
  confidence: number;
  target_memory_ids: string;
  created_memory_ids: string;
  source_event_ids: string;
  before_snapshot: string;
  after_snapshot: string;
  created_at: number;
  applied_at: number | null;
  undone_at: number | null;
  error: string | null;
}

export interface MemoryDecisionMemoryStore {
  getMemory(id: string): Promise<Memory | null>;
  setMemoryStatus(id: string, status: string): Promise<Memory | null>;
  restoreMemorySnapshot(snapshot: MemorySnapshotRestore): Promise<Memory | null>;
}

const defaultMemoryStore: MemoryDecisionMemoryStore = {
  getMemory,
  setMemoryStatus,
  restoreMemorySnapshot,
};

// Memory Decision 是 Dream Worker 自主整理记忆后留下的审计记录。
// snapshot（快照）保存改动前后的最小必要字段，用来支持“可撤销”而不是硬删除。
/**
 * 捕获一组记忆的最小恢复快照。
 *
 * @param ids 需要捕获的记忆 id 列表。
 * @param store 可选记忆存储端口，测试中可注入 mock。
 * @returns 可用于撤销的记忆快照列表。
 */
export async function captureMemorySnapshots(
  ids: string[],
  store: MemoryDecisionMemoryStore = defaultMemoryStore,
): Promise<MemoryDecisionSnapshot[]> {
  const snapshots: MemoryDecisionSnapshot[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const memory = await store.getMemory(id);
    if (!memory) continue;
    snapshots.push(toSnapshot(memory));
  }
  return snapshots;
}

/**
 * 创建一条 Memory Decision 审计记录。
 *
 * Memory Decision 记录 Dream Worker 自动做出的整理动作、原因、置信度和改动快照。
 *
 * @param input 决策类型、状态、目标记忆、创建记忆、证据和快照。
 * @param database 可选数据库连接。
 * @returns 已写入的 Memory Decision 记录。
 */
export function createMemoryDecision(input: {
  agentId?: string;
  dreamRunId?: string | null;
  type: MemoryDecisionType;
  status: MemoryDecisionStatus;
  title: string;
  reason?: string;
  confidence?: number;
  targetMemoryIds?: string[];
  createdMemoryIds?: string[];
  sourceEventIds?: string[];
  beforeSnapshot?: MemoryDecisionSnapshot[];
  afterSnapshot?: MemoryDecisionSnapshot[];
  error?: string | null;
  createdAt?: number;
}, database: Database = getDb()): MemoryDecisionRecord {
  // 创建 decision 时同时写 runtime event。
  // 这样前端事件流能看到“做了什么决定”，memory_decisions 表能看到“为什么和怎么撤销”。
  const now = input.createdAt ?? Date.now();
  const decision: MemoryDecisionRecord = {
    id: crypto.randomUUID(),
    agent_id: input.agentId ?? "default",
    dream_run_id: input.dreamRunId ?? null,
    type: input.type,
    status: input.status,
    title: input.title,
    reason: input.reason ?? "",
    confidence: input.confidence ?? 0.5,
    target_memory_ids: input.targetMemoryIds ?? [],
    created_memory_ids: input.createdMemoryIds ?? [],
    source_event_ids: input.sourceEventIds ?? [],
    before_snapshot: input.beforeSnapshot ?? [],
    after_snapshot: input.afterSnapshot ?? [],
    created_at: now,
    applied_at: input.status === "applied" ? now : null,
    undone_at: null,
    error: input.error ?? null,
  };

  database
    .query(
      `INSERT INTO memory_decisions (
        id, agent_id, dream_run_id, type, status, title, reason, confidence,
        target_memory_ids, created_memory_ids, source_event_ids,
        before_snapshot, after_snapshot, created_at, applied_at, undone_at, error
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      decision.id,
      decision.agent_id,
      decision.dream_run_id,
      decision.type,
      decision.status,
      decision.title,
      decision.reason,
      decision.confidence,
      JSON.stringify(decision.target_memory_ids),
      JSON.stringify(decision.created_memory_ids),
      JSON.stringify(decision.source_event_ids),
      JSON.stringify(decision.before_snapshot),
      JSON.stringify(decision.after_snapshot),
      decision.created_at,
      decision.applied_at,
      decision.undone_at,
      decision.error,
    );

  appendEvent({
    agent_id: decision.agent_id,
    type: "memory.decision.created",
    payload: {
      decisionId: decision.id,
      type: decision.type,
      status: decision.status,
      title: decision.title,
      confidence: decision.confidence,
      dreamRunId: decision.dream_run_id,
    },
  }, database);
  appendDecisionStatusEvent(decision, database);

  return decision;
}

/**
 * 列出 Memory Decision。
 *
 * @param params Agent、状态和数量限制。
 * @param database 可选数据库连接。
 * @returns 按创建时间倒序排列的决策记录。
 */
export function listMemoryDecisions(
  params: { agentId?: string; status?: MemoryDecisionStatus; limit?: number } = {},
  database: Database = getDb(),
): MemoryDecisionRecord[] {
  const agentId = params.agentId ?? "default";
  const limit = params.limit ?? 30;
  if (params.status) {
    return database
      .query<MemoryDecisionRow, [string, MemoryDecisionStatus, number]>(
        `SELECT * FROM memory_decisions
         WHERE agent_id = ? AND status = ?
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(agentId, params.status, limit)
      .map(toDecision);
  }

  return database
    .query<MemoryDecisionRow, [string, number]>(
      `SELECT * FROM memory_decisions
       WHERE agent_id = ?
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(agentId, limit)
    .map(toDecision);
}

/**
 * 获取单条 Memory Decision。
 *
 * @param id 决策 id。
 * @param database 可选数据库连接。
 * @returns 找到时返回决策记录，否则返回 `null`。
 */
export function getMemoryDecision(id: string, database: Database = getDb()): MemoryDecisionRecord | null {
  const row = database
    .query<MemoryDecisionRow, [string]>(
      `SELECT * FROM memory_decisions WHERE id = ? LIMIT 1`,
    )
    .get(id);
  return row ? toDecision(row) : null;
}

/**
 * 撤销一条已应用的 Memory Decision。
 *
 * 撤销会恢复 before snapshot，并把本次整理新建的记忆标记为 inactive。
 *
 * @param id 决策 id。
 * @param options 可选数据库连接和记忆存储端口。
 * @returns 撤销后的决策记录，以及本次是否真正产生变更。
 * @throws 当决策不是 applied 状态时抛出错误。
 */
export async function undoMemoryDecision(
  id: string,
  options: {
    database?: Database;
    store?: MemoryDecisionMemoryStore;
  } = {},
): Promise<{ decision: MemoryDecisionRecord | null; changed: boolean }> {
  const database = options.database ?? getDb();
  const store = options.store ?? defaultMemoryStore;
  const decision = getMemoryDecision(id, database);
  if (!decision) return { decision: null, changed: false };
  if (decision.status === "undone") return { decision, changed: false };
  if (decision.status !== "applied") {
    throw new Error("只有已应用的记忆整理决策可以撤销");
  }

  // 撤销分两步：
  // 1. 把被改写的旧记忆恢复到 before_snapshot。
  // 2. 把本次整理新建的记忆设为 inactive，避免继续参与回忆。
  // 这符合“不硬删除长期记忆”的安全边界。
  const beforeIds = new Set(decision.before_snapshot.map((snapshot) => snapshot.id));
  for (const snapshot of decision.before_snapshot) {
    await store.restoreMemorySnapshot(snapshot);
  }
  for (const idToDeactivate of decision.created_memory_ids) {
    if (beforeIds.has(idToDeactivate)) continue;
    await store.setMemoryStatus(idToDeactivate, "inactive");
  }

  const now = Date.now();
  database
    .query(
      `UPDATE memory_decisions
       SET status = 'undone', undone_at = ?
       WHERE id = ?`,
    )
    .run(now, id);

  const updated = getMemoryDecision(id, database);
  if (updated) {
    appendEvent({
      agent_id: updated.agent_id,
      type: "memory.decision.undone",
      payload: {
        decisionId: updated.id,
        type: updated.type,
        title: updated.title,
        targetMemoryIds: updated.target_memory_ids,
        createdMemoryIds: updated.created_memory_ids,
      },
    }, database);
  }

  return { decision: updated, changed: true };
}

function appendDecisionStatusEvent(decision: MemoryDecisionRecord, database: Database): void {
  // 状态事件用于 Runtime 面板的中文展示和后续调试。
  // 真正的可恢复数据仍以 memory_decisions 表里的 snapshot 为准。
  const eventType = {
    applied: "memory.decision.applied",
    skipped: "memory.decision.skipped",
    failed: "memory.decision.failed",
    undone: "memory.decision.undone",
  }[decision.status] as "memory.decision.applied" | "memory.decision.skipped" | "memory.decision.failed" | "memory.decision.undone";

  appendEvent({
    agent_id: decision.agent_id,
    type: eventType,
    payload: {
      decisionId: decision.id,
      type: decision.type,
      title: decision.title,
      reason: decision.reason,
      confidence: decision.confidence,
      targetMemoryIds: decision.target_memory_ids,
      createdMemoryIds: decision.created_memory_ids,
      error: decision.error,
    },
  }, database);
}

function toDecision(row: MemoryDecisionRow): MemoryDecisionRecord {
  return {
    ...row,
    target_memory_ids: parseStringArray(row.target_memory_ids),
    created_memory_ids: parseStringArray(row.created_memory_ids),
    source_event_ids: parseStringArray(row.source_event_ids),
    before_snapshot: parseSnapshotArray(row.before_snapshot),
    after_snapshot: parseSnapshotArray(row.after_snapshot),
  };
}

function toSnapshot(memory: Memory): MemoryDecisionSnapshot {
  return {
    id: memory.id,
    content: memory.content,
    memory_type: memory.memory_type,
    status: memory.status,
    confidence: memory.confidence,
    updated_at: memory.updated_at,
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

function parseSnapshotArray(value: string): MemoryDecisionSnapshot[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter(isSnapshot)
      : [];
  } catch {
    return [];
  }
}

function isSnapshot(value: unknown): value is MemoryDecisionSnapshot {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === "string"
    && typeof record.content === "string"
    && typeof record.memory_type === "string"
    && typeof record.status === "string"
    && typeof record.confidence === "number"
    && typeof record.updated_at === "number";
}
