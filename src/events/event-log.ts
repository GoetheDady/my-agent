import type { Database } from "bun:sqlite";
import { getDb } from "../core/database";
import { defaultRealtimeService } from "../realtime/service";
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

/**
 * Runtime Event 是系统的统一审计日志。
 *
 * 它不是聊天消息，也不是长期记忆；它记录 task、tool、memory、dream、profile 等内部动作。
 * 前端 Runtime 面板直接轮询 events，后台 worker 也用 events 做证据链。
 */
/**
 * 写入一条 Runtime Event。
 *
 * Runtime Event 是系统统一审计日志，用来记录 task、tool、memory、dream 等运行过程。
 *
 * @param input 事件类型、关联 Agent/task/conversation 和 payload。
 * @param database 可选数据库连接。
 * @returns 已写入数据库的事件记录。
 */
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

  defaultRealtimeService.broadcast({
    type: "runtime.event.created",
    agentId: event.agent_id,
    taskId: event.task_id ?? undefined,
    eventId: event.id,
    payload: {
      event: {
        ...event,
        payloadJson: input.payload ?? {},
      },
    },
    createdAt: event.created_at,
  });
  broadcastDomainNotification(event, input.payload ?? {});

  return event;
}

function broadcastDomainNotification(event: RuntimeEvent, payload: unknown): void {
  if (event.type.startsWith("tool.approval.")) {
    defaultRealtimeService.broadcast({
      type: "tool.approval.updated",
      agentId: event.agent_id,
      taskId: event.task_id ?? undefined,
      eventId: event.id,
      payload,
      createdAt: event.created_at,
    });
    return;
  }

  if (event.type.startsWith("channel.")) {
    defaultRealtimeService.broadcast({
      type: "channel.updated",
      agentId: event.agent_id,
      taskId: event.task_id ?? undefined,
      eventId: event.id,
      payload,
      createdAt: event.created_at,
    });
    return;
  }

  if (event.type.startsWith("memory.")) {
    defaultRealtimeService.broadcast({
      type: "memory.updated",
      agentId: event.agent_id,
      taskId: event.task_id ?? undefined,
      eventId: event.id,
      payload,
      createdAt: event.created_at,
    });
    return;
  }

  if (event.type.startsWith("skill.")) {
    defaultRealtimeService.broadcast({
      type: "skill.updated",
      agentId: event.agent_id,
      eventId: event.id,
      payload,
      createdAt: event.created_at,
    });
    return;
  }

  if (event.type.startsWith("agent.delegation.")) {
    const record = payload && typeof payload === "object" && !Array.isArray(payload)
      ? payload as Record<string, unknown>
      : {};
    defaultRealtimeService.broadcast({
      type: "delegation.updated",
      agentId: event.agent_id,
      taskId: event.task_id ?? undefined,
      eventId: event.id,
      delegationId: typeof record.delegationId === "string" ? record.delegationId : undefined,
      payload,
      createdAt: event.created_at,
    });
  }
}

/**
 * 获取某个 task 的事件流。
 *
 * @param taskId 任务 id。
 * @param database 可选数据库连接。
 * @returns 按创建时间正序排列的事件列表，适合构造证据链。
 */
export function listTaskEvents(taskId: string, database: Database = getDb()): RuntimeEvent[] {
  // task 维度按正序返回，方便 worker 按时间构造证据链。
  return database
    .query<RuntimeEvent, [string]>(
      `SELECT id, agent_id, task_id, conversation_id, type, payload, created_at
       FROM events
       WHERE task_id = ?
       ORDER BY created_at ASC, id ASC`,
    )
    .all(taskId);
}

/**
 * 获取某个 conversation 的事件流。
 *
 * @param conversationId 内部会话 id。
 * @param database 可选数据库连接。
 * @returns 按创建时间正序排列的会话事件列表。
 */
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

/**
 * 获取某个 Agent 最近的事件。
 *
 * @param agentId Agent 标识。
 * @param limit 最大返回条数。
 * @param database 可选数据库连接。
 * @returns 按创建时间倒序排列的事件列表，适合 Runtime 面板展示。
 */
export function listAgentEvents(
  agentId: string,
  limit = 50,
  database: Database = getDb(),
): RuntimeEvent[] {
  // 面板展示通常关心最近事件，所以按倒序取 limit。
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

/**
 * 获取某个 Agent 在时间范围内的事件。
 *
 * @param agentId Agent 标识。
 * @param from 起始时间戳，毫秒。
 * @param to 结束时间戳，毫秒。
 * @param database 可选数据库连接。
 * @returns 按创建时间正序排列的事件列表，适合 Dream Worker 做每日汇总。
 */
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
