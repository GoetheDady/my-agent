import type { Database } from "bun:sqlite";
import { getDb } from "../core/database";
import { defaultRealtimeService } from "../realtime/service";
import type { DelegationRecord, DelegationStatus, PublicDelegation } from "./types";

export interface InsertDelegationInput {
  id?: string;
  parentSessionId?: string | null;
  parentAgentId: string;
  parentTaskId: string;
  parentConversationId?: string | null;
  childAgentId: string;
  childTaskId: string;
  sourceChannel: string;
  sourceUserId?: string;
  sourceMetadata?: Record<string, unknown>;
  instruction: string;
  createdAt?: number;
}

function parseMetadata(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

export function toPublicDelegation(record: DelegationRecord): PublicDelegation {
  return {
    id: record.id,
    parentSessionId: record.parent_session_id,
    parentAgentId: record.parent_agent_id,
    parentTaskId: record.parent_task_id,
    parentConversationId: record.parent_conversation_id,
    callbackTaskId: record.callback_task_id,
    childAgentId: record.child_agent_id,
    childTaskId: record.child_task_id,
    sourceChannel: record.source_channel,
    sourceUserId: record.source_user_id,
    sourceMetadata: parseMetadata(record.source_metadata),
    instruction: record.instruction,
    status: record.status,
    result: record.result,
    error: record.error,
    createdAt: record.created_at,
    completedAt: record.completed_at,
  };
}

export function createDelegation(input: InsertDelegationInput, database: Database = getDb()): DelegationRecord {
  const now = input.createdAt ?? Date.now();
  const record: DelegationRecord = {
    id: input.id ?? crypto.randomUUID(),
    parent_session_id: input.parentSessionId ?? null,
    parent_agent_id: input.parentAgentId,
    parent_task_id: input.parentTaskId,
    parent_conversation_id: input.parentConversationId ?? null,
    callback_task_id: null,
    child_agent_id: input.childAgentId,
    child_task_id: input.childTaskId,
    source_channel: input.sourceChannel,
    source_user_id: input.sourceUserId ?? "default",
    source_metadata: JSON.stringify(input.sourceMetadata ?? {}),
    instruction: input.instruction,
    status: "queued",
    result: null,
    error: null,
    created_at: now,
    completed_at: null,
  };

  database
    .query(
      `INSERT INTO delegations (
         id, parent_session_id, parent_agent_id, parent_task_id, parent_conversation_id,
         callback_task_id, child_agent_id, child_task_id, source_channel, source_user_id,
         source_metadata, instruction, status, result, error, created_at, completed_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      record.id,
      record.parent_session_id,
      record.parent_agent_id,
      record.parent_task_id,
      record.parent_conversation_id,
      record.callback_task_id,
      record.child_agent_id,
      record.child_task_id,
      record.source_channel,
      record.source_user_id,
      record.source_metadata,
      record.instruction,
      record.status,
      record.result,
      record.error,
      record.created_at,
      record.completed_at,
    );

  broadcastDelegation(record);
  return record;
}

export function getDelegation(id: string, database: Database = getDb()): DelegationRecord | null {
  return database
    .query<DelegationRecord, [string]>(
      `SELECT id, parent_session_id, parent_agent_id, parent_task_id, parent_conversation_id,
              callback_task_id, child_agent_id, child_task_id, source_channel, source_user_id,
              source_metadata, instruction, status, result, error, created_at, completed_at
       FROM delegations
       WHERE id = ?`,
    )
    .get(id) ?? null;
}

export function getDelegationByChildTask(childTaskId: string, database: Database = getDb()): DelegationRecord | null {
  return database
    .query<DelegationRecord, [string]>(
      `SELECT id, parent_session_id, parent_agent_id, parent_task_id, parent_conversation_id,
              callback_task_id, child_agent_id, child_task_id, source_channel, source_user_id,
              source_metadata, instruction, status, result, error, created_at, completed_at
       FROM delegations
       WHERE child_task_id = ?`,
    )
    .get(childTaskId) ?? null;
}

export function getDelegationByCallbackTask(callbackTaskId: string, database: Database = getDb()): DelegationRecord | null {
  return database
    .query<DelegationRecord, [string]>(
      `SELECT id, parent_session_id, parent_agent_id, parent_task_id, parent_conversation_id,
              callback_task_id, child_agent_id, child_task_id, source_channel, source_user_id,
              source_metadata, instruction, status, result, error, created_at, completed_at
       FROM delegations
       WHERE callback_task_id = ?`,
    )
    .get(callbackTaskId) ?? null;
}

export function listDelegations(input: {
  agentId?: string;
  sessionId?: string;
  status?: DelegationStatus;
  limit?: number;
} = {}, database: Database = getDb()): DelegationRecord[] {
  const clauses: string[] = [];
  const args: Array<string | number> = [];
  if (input.agentId) {
    clauses.push("(parent_agent_id = ? OR child_agent_id = ?)");
    args.push(input.agentId, input.agentId);
  }
  if (input.sessionId) {
    clauses.push("parent_session_id = ?");
    args.push(input.sessionId);
  }
  if (input.status) {
    clauses.push("status = ?");
    args.push(input.status);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  args.push(input.limit ?? 100);

  return database
    .query<DelegationRecord, typeof args>(
      `SELECT id, parent_session_id, parent_agent_id, parent_task_id, parent_conversation_id,
              callback_task_id, child_agent_id, child_task_id, source_channel, source_user_id,
              source_metadata, instruction, status, result, error, created_at, completed_at
       FROM delegations
       ${where}
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(...args);
}

export function updateDelegation(input: {
  id: string;
  status?: DelegationStatus;
  result?: string | null;
  error?: string | null;
  callbackTaskId?: string | null;
  completedAt?: number | null;
}, database: Database = getDb()): DelegationRecord {
  const existing = getDelegation(input.id, database);
  if (!existing) throw new Error(`Delegation not found: ${input.id}`);
  const next: DelegationRecord = {
    ...existing,
    status: input.status ?? existing.status,
    result: input.result === undefined ? existing.result : input.result,
    error: input.error === undefined ? existing.error : input.error,
    callback_task_id: input.callbackTaskId === undefined ? existing.callback_task_id : input.callbackTaskId,
    completed_at: input.completedAt === undefined ? existing.completed_at : input.completedAt,
  };

  database
    .query(
      `UPDATE delegations
       SET status = ?, result = ?, error = ?, callback_task_id = ?, completed_at = ?
       WHERE id = ?`,
    )
    .run(next.status, next.result, next.error, next.callback_task_id, next.completed_at, next.id);

  broadcastDelegation(next);
  return next;
}

function broadcastDelegation(record: DelegationRecord): void {
  defaultRealtimeService.broadcast({
    type: "delegation.updated",
    agentId: record.parent_agent_id,
    sessionId: record.parent_session_id ?? undefined,
    taskId: record.parent_task_id,
    delegationId: record.id,
    payload: { delegation: toPublicDelegation(record) },
    createdAt: Date.now(),
  });
  if (record.child_agent_id !== record.parent_agent_id) {
    defaultRealtimeService.broadcast({
      type: "delegation.updated",
      agentId: record.child_agent_id,
      taskId: record.child_task_id,
      delegationId: record.id,
      payload: { delegation: toPublicDelegation(record) },
      createdAt: Date.now(),
    });
  }
}
