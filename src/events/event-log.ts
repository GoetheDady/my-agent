import type { Database } from "bun:sqlite";
import { getDb } from "../core/database";
import type { RuntimeEvent, RuntimeEventType } from "./event-types";

export interface AppendEventInput {
  id?: string;
  agent_id?: string;
  task_id?: string | null;
  conversation_id?: string | null;
  type: RuntimeEventType;
  payload?: unknown;
  created_at?: number;
}

export function appendEvent(input: AppendEventInput, database: Database = getDb()): RuntimeEvent {
  const event: RuntimeEvent = {
    id: input.id ?? crypto.randomUUID(),
    agent_id: input.agent_id ?? "default",
    task_id: input.task_id ?? null,
    conversation_id: input.conversation_id ?? null,
    type: input.type,
    payload: JSON.stringify(input.payload ?? {}),
    created_at: input.created_at ?? Date.now(),
  };

  database
    .query(
      `INSERT INTO events (id, agent_id, task_id, conversation_id, type, payload, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      event.id,
      event.agent_id,
      event.task_id,
      event.conversation_id,
      event.type,
      event.payload,
      event.created_at,
    );

  return event;
}

export function listTaskEvents(taskId: string, database: Database = getDb()): RuntimeEvent[] {
  return database
    .query<RuntimeEvent, [string]>(
      `SELECT id, agent_id, task_id, conversation_id, type, payload, created_at
       FROM events
       WHERE task_id = ?
       ORDER BY created_at ASC, id ASC`,
    )
    .all(taskId);
}

export function listConversationEvents(
  conversationId: string,
  database: Database = getDb(),
): RuntimeEvent[] {
  return database
    .query<RuntimeEvent, [string]>(
      `SELECT id, agent_id, task_id, conversation_id, type, payload, created_at
       FROM events
       WHERE conversation_id = ?
       ORDER BY created_at ASC, id ASC`,
    )
    .all(conversationId);
}

export function listAgentEvents(
  agentId: string,
  limit = 50,
  database: Database = getDb(),
): RuntimeEvent[] {
  return database
    .query<RuntimeEvent, [string, number]>(
      `SELECT id, agent_id, task_id, conversation_id, type, payload, created_at
       FROM events
       WHERE agent_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
    )
    .all(agentId, limit);
}

export function listAgentEventsInRange(
  agentId: string,
  from: number,
  to: number,
  database: Database = getDb(),
): RuntimeEvent[] {
  return database
    .query<RuntimeEvent, [string, number, number]>(
      `SELECT id, agent_id, task_id, conversation_id, type, payload, created_at
       FROM events
       WHERE agent_id = ? AND created_at >= ? AND created_at <= ?
       ORDER BY created_at ASC, id ASC`,
    )
    .all(agentId, from, to);
}
