import type { Database } from "bun:sqlite";
import { getDb } from "../core/database";
import { defaultRealtimeService } from "../realtime/service";

export interface Session {
  id: string;
  agent_id: string;
  title: string;
  created_at: number;
  updated_at: number;
}

export interface CreateSessionInput {
  title?: string;
  agentId?: string;
}

export interface SessionMessage {
  id: string;
  session_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: number;
}

export interface AssistantToolPartUpdate {
  state?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
}

/**
 * 创建 Web 聊天 session。
 *
 * session 是前端展示层概念，负责保存聊天标题和消息；runtime 执行层使用 conversation/task。
 *
 * @param title 可选会话标题，不传时使用“新对话”。
 * @param database 可选数据库连接。
 * @returns 新创建的 session 记录。
 */
export function createSession(
  input?: string | CreateSessionInput,
  database: Database = getDb(),
): Session {
  const id = crypto.randomUUID();
  const now = Date.now();
  const title = typeof input === "string" ? input : input?.title;
  const agentId = typeof input === "string" ? "default" : input?.agentId?.trim() || "default";
  database.run(
    "INSERT INTO sessions (id, agent_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    [id, agentId, title ?? "新对话", now, now],
  );
  const session = { id, agent_id: agentId, title: title ?? "新对话", created_at: now, updated_at: now };
  defaultRealtimeService.broadcast({
    type: "session.updated",
    agentId,
    sessionId: id,
    payload: { session },
    createdAt: now,
  });
  return session;
}

/**
 * 列出所有 Web 聊天 session。
 *
 * @returns 按更新时间倒序排列的 session 列表。
 */
export function listSessions(database: Database = getDb()): Session[] {
  return database.query("SELECT * FROM sessions ORDER BY updated_at DESC").all() as Session[];
}

/**
 * 根据 id 获取 Web 聊天 session。
 *
 * @param id session id。
 * @param database 可选数据库连接。
 * @returns 找到时返回 session，否则返回 `null`。
 */
export function getSession(id: string, database: Database = getDb()): Session | null {
  return database.query("SELECT * FROM sessions WHERE id = ?").get(id) as Session | null;
}

/**
 * 更新 session 标题并刷新更新时间。
 *
 * @param id session id。
 * @param title 新标题。
 * @param database 可选数据库连接。
 */
export function updateSessionTitle(id: string, title: string, database: Database = getDb()): void {
  const now = Date.now();
  database.run("UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?", [title, now, id]);
  const session = getSession(id, database);
  defaultRealtimeService.broadcast({
    type: "session.updated",
    agentId: session?.agent_id,
    sessionId: id,
    payload: { sessionId: id, title },
    createdAt: now,
  });
}

/**
 * 删除 session 及其关联消息。
 *
 * @param id session id。
 */
export function deleteSession(id: string, database: Database = getDb()): void {
  const session = getSession(id, database);
  database.run("DELETE FROM sessions WHERE id = ?", [id]);
  defaultRealtimeService.broadcast({
    type: "session.updated",
    agentId: session?.agent_id,
    sessionId: id,
    payload: { sessionId: id, deleted: true },
    createdAt: Date.now(),
  });
}

/**
 * 向 session 追加一条用户或助手消息。
 *
 * @param sessionId 目标 session id。
 * @param role 消息角色。
 * @param content 入库内容，通常是 JSON parts 字符串。
 * @param database 可选数据库连接。
 * @returns 新写入的消息记录。
 */
export function appendMessage(
  sessionId: string,
  role: "user" | "assistant",
  content: string,
  database: Database = getDb(),
): SessionMessage {
  const id = crypto.randomUUID();
  const now = Date.now();
  database.run(
    "INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)",
    [id, sessionId, role, content, now],
  );
  database.run("UPDATE sessions SET updated_at = ? WHERE id = ?", [now, sessionId]);
  const message = { id, session_id: sessionId, role, content, created_at: now };
  const session = getSession(sessionId, database);
  defaultRealtimeService.broadcast({
    type: "message.created",
    agentId: session?.agent_id,
    sessionId,
    payload: { message },
    createdAt: now,
  });
  defaultRealtimeService.broadcast({
    type: "session.updated",
    agentId: session?.agent_id,
    sessionId,
    payload: { sessionId },
    createdAt: now,
  });
  return message;
}

/**
 * 原地替换已有 assistant 消息内容。
 *
 * 审批续跑会继续更新上一条 assistant 消息里的工具卡，不能追加一条新 assistant 消息。
 *
 * @param messageId 要替换的 assistant 消息 id。
 * @param content 新的 JSON parts 内容。
 * @param database 可选数据库连接。
 * @returns 更新后的消息；如果目标不存在或不是 assistant，返回 null。
 */
export function replaceAssistantMessageContent(
  messageId: string,
  content: string,
  database: Database = getDb(),
): SessionMessage | null {
  const message = getSessionMessage(messageId, database);
  if (!message || message.role !== "assistant") return null;

  const now = Date.now();
  database.run("UPDATE messages SET content = ? WHERE id = ?", [content, messageId]);
  database.run("UPDATE sessions SET updated_at = ? WHERE id = ?", [now, message.session_id]);
  const nextMessage = { ...message, content };
  const session = getSession(message.session_id, database);
  defaultRealtimeService.broadcast({
    type: "message.updated",
    agentId: session?.agent_id,
    sessionId: message.session_id,
    payload: {
      messageId,
      content,
    },
    createdAt: now,
  });
  defaultRealtimeService.broadcast({
    type: "session.updated",
    agentId: session?.agent_id,
    sessionId: message.session_id,
    payload: { sessionId: message.session_id },
    createdAt: now,
  });
  return nextMessage;
}

/**
 * 获取某个 session 的全部消息。
 *
 * @param sessionId session id。
 * @param database 可选数据库连接。
 * @returns 按创建时间正序排列的消息列表。
 */
export function getSessionMessages(sessionId: string, database: Database = getDb()): SessionMessage[] {
  return database.query("SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC").all(sessionId) as SessionMessage[];
}

/**
 * 获取单条 session 消息。
 *
 * @param messageId 消息 id。
 * @param database 可选数据库连接。
 * @returns 找到时返回消息，否则返回 `null`。
 */
export function getSessionMessage(messageId: string, database: Database = getDb()): SessionMessage | null {
  return database.query("SELECT * FROM messages WHERE id = ?").get(messageId) as SessionMessage | null;
}

/**
 * 给助手消息追加一个合成工具卡。
 *
 * 合成工具卡用于后台 worker 的展示，例如 `memory_extract` 和 `memory_reconsolidate`。
 *
 * @param messageId 助手消息 id。
 * @param toolName 工具名。
 * @param input 工具卡初始输入。
 * @param database 可选数据库连接。
 * @returns 新生成的 toolCallId，用于后续更新同一个工具卡。
 */
export function appendAssistantToolPart(
  messageId: string,
  toolName: string,
  input: unknown,
  database: Database = getDb(),
): { toolCallId: string } {
  // 合成工具卡：后台 worker 不在主模型流里运行，但前端需要像工具调用一样展示。
  // 所以这里直接把 tool part 写进 assistant message 的 JSON content。
  const toolCallId = `${toolName}-${crypto.randomUUID()}`;
  const part = {
    type: `tool-${toolName}`,
    toolCallId,
    state: "input-available",
    input,
  };
  updateAssistantParts(messageId, (parts) => [...parts, part], database);
  return { toolCallId };
}

/**
 * 更新助手消息里的某个合成工具卡。
 *
 * @param messageId 助手消息 id。
 * @param toolCallId 要更新的工具调用 id。
 * @param update 工具状态、输出或错误信息。
 * @param database 可选数据库连接。
 */
export function updateAssistantToolPart(
  messageId: string,
  toolCallId: string,
  update: AssistantToolPartUpdate,
  database: Database = getDb(),
): void {
  // worker 完成后更新同一个 toolCallId，历史会话刷新后仍能看到最终状态。
  updateAssistantParts(
    messageId,
    (parts) =>
      parts.map((part) => {
        if (!isRecord(part) || part.toolCallId !== toolCallId) return part;
        return {
          ...part,
          ...definedProperties(update),
        };
      }),
    database,
  );
}

function updateAssistantParts(
  messageId: string,
  update: (parts: Array<Record<string, unknown>>) => Array<Record<string, unknown>>,
  database: Database,
): void {
  // 只允许更新 assistant 消息，避免后台任务误改用户原文。
  // content 统一存 JSON parts，前端用 parseDbContent 恢复成文字、推理和工具卡。
  const message = getSessionMessage(messageId, database);
  if (!message || message.role !== "assistant") return;

  const parts = parseAssistantParts(message.content);
  replaceAssistantMessageContent(messageId, JSON.stringify(update(parts)), database);
}

function parseAssistantParts(content: string): Array<Record<string, unknown>> {
  try {
    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRecord);
  } catch {
    return [];
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function definedProperties(update: AssistantToolPartUpdate): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(update)) {
    if (value !== undefined) result[key] = value;
  }
  return result;
}
