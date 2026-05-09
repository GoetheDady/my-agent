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

export function updateReviewStatus(
  id: string,
  status: Exclude<MemoryReviewStatus, "pending">,
  database: Database = getDb(),
): MemoryReviewItem | null {
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
