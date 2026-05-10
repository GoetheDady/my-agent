import type { Database } from "bun:sqlite";
import { getDb } from "../core/database";
import { appendEvent } from "../events/event-log";

export type MemoryReviewStatus = "pending" | "accepted" | "rejected";
export type MemoryReviewType = "merge" | "semantic_update" | "procedural_memory" | "conflict" | "reflective_memory";

export interface MemoryReviewItem {
  id: string;
  agent_id: string;
  type: MemoryReviewType;
  status: MemoryReviewStatus;
  title: string;
  proposed_content: string;
  target_memory_ids: string[];
  source_event_ids: string[];
  confidence: number;
  reason: string;
  created_at: number;
  reviewed_at: number | null;
}

interface MemoryReviewRow {
  id: string;
  agent_id: string;
  type: MemoryReviewType;
  status: MemoryReviewStatus;
  title: string;
  proposed_content: string;
  target_memory_ids: string;
  source_event_ids: string;
  confidence: number;
  reason: string;
  created_at: number;
  reviewed_at: number | null;
}

/**
 * 创建一条记忆审查建议。
 *
 * Review item 是早期人工审查流程的兼容层，新自动整理主流程使用 Memory Decision。
 *
 * @param input 建议类型、标题、建议内容、目标记忆、证据和置信度。
 * @param database 可选数据库连接。
 * @returns 新创建的 review item。
 */
export function createReviewItem(input: {
  agentId?: string;
  type: MemoryReviewType;
  title: string;
  proposedContent: string;
  targetMemoryIds?: string[];
  sourceEventIds?: string[];
  confidence?: number;
  reason?: string;
}, database: Database = getDb()): MemoryReviewItem {
  // review item 是早期“人工审批”模型的兼容层。
  // 新的 Dream Worker 主流程使用 memory_decisions 自主应用，但反思工具仍可生成待审查建议。
  const now = Date.now();
  const item: MemoryReviewItem = {
    id: crypto.randomUUID(),
    agent_id: input.agentId ?? "default",
    type: input.type,
    status: "pending",
    title: input.title,
    proposed_content: input.proposedContent,
    target_memory_ids: input.targetMemoryIds ?? [],
    source_event_ids: input.sourceEventIds ?? [],
    confidence: input.confidence ?? 0.5,
    reason: input.reason ?? "",
    created_at: now,
    reviewed_at: null,
  };

  database
    .query(
      `INSERT INTO memory_review_items (
        id, agent_id, type, status, title, proposed_content, target_memory_ids,
        source_event_ids, confidence, reason, created_at, reviewed_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      item.id,
      item.agent_id,
      item.type,
      item.status,
      item.title,
      item.proposed_content,
      JSON.stringify(item.target_memory_ids),
      JSON.stringify(item.source_event_ids),
      item.confidence,
      item.reason,
      item.created_at,
      item.reviewed_at,
    );

  appendEvent({
    agent_id: item.agent_id,
    type: "memory.review.created",
    payload: { reviewItemId: item.id, type: item.type, title: item.title },
  }, database);

  return item;
}

/**
 * 列出记忆审查建议。
 *
 * @param params Agent、状态和数量限制。
 * @param database 可选数据库连接。
 * @returns 按创建时间倒序排列的 review item 列表。
 */
export function listReviewItems(
  params: { agentId?: string; status?: MemoryReviewStatus; limit?: number } = {},
  database: Database = getDb(),
): MemoryReviewItem[] {
  const agentId = params.agentId ?? "default";
  const limit = params.limit ?? 20;
  if (params.status) {
    return database
      .query<MemoryReviewRow, [string, MemoryReviewStatus, number]>(
        `SELECT * FROM memory_review_items
         WHERE agent_id = ? AND status = ?
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(agentId, params.status, limit)
      .map(toReviewItem);
  }

  return database
    .query<MemoryReviewRow, [string, number]>(
      `SELECT * FROM memory_review_items
       WHERE agent_id = ?
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(agentId, limit)
    .map(toReviewItem);
}

/**
 * 更新记忆审查建议状态。
 *
 * @param id review item id。
 * @param status 新状态，只能是 accepted 或 rejected。
 * @param database 可选数据库连接。
 * @returns 更新后的 review item；不存在时返回 `null`。
 */
export function updateReviewStatus(
  id: string,
  status: Exclude<MemoryReviewStatus, "pending">,
  database: Database = getDb(),
): MemoryReviewItem | null {
  // 保留接受/拒绝事件，方便旧 UI 或测试继续观察 review item 生命周期。
  const now = Date.now();
  database
    .query(
      `UPDATE memory_review_items SET status = ?, reviewed_at = ? WHERE id = ?`,
    )
    .run(status, now, id);

  const item = getReviewItem(id, database);
  if (item) {
    appendEvent({
      agent_id: item.agent_id,
      type: status === "accepted" ? "memory.review.accepted" : "memory.review.rejected",
      payload: { reviewItemId: item.id, type: item.type, title: item.title },
    }, database);
  }
  return item;
}

/**
 * 获取单条记忆审查建议。
 *
 * @param id review item id。
 * @param database 可选数据库连接。
 * @returns 找到时返回 review item，否则返回 `null`。
 */
export function getReviewItem(id: string, database: Database = getDb()): MemoryReviewItem | null {
  const row = database
    .query<MemoryReviewRow, [string]>(
      `SELECT * FROM memory_review_items WHERE id = ? LIMIT 1`,
    )
    .get(id);
  return row ? toReviewItem(row) : null;
}

function toReviewItem(row: MemoryReviewRow): MemoryReviewItem {
  return {
    ...row,
    target_memory_ids: parseStringArray(row.target_memory_ids),
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
