import type { Database } from "bun:sqlite";
import { getDb } from "../core/database";

export interface Session {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
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

export function createSession(title?: string, database: Database = getDb()): Session {
  const id = crypto.randomUUID();
  const now = Date.now();
  database.run(
    "INSERT INTO sessions (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)",
    [id, title ?? "新对话", now, now],
  );
  return { id, title: title ?? "新对话", created_at: now, updated_at: now };
}

export function listSessions(): Session[] {
  const db = getDb();
  return db.query("SELECT * FROM sessions ORDER BY updated_at DESC").all() as Session[];
}

export function getSession(id: string, database: Database = getDb()): Session | null {
  return database.query("SELECT * FROM sessions WHERE id = ?").get(id) as Session | null;
}

export function updateSessionTitle(id: string, title: string, database: Database = getDb()): void {
  const now = Date.now();
  database.run("UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?", [title, now, id]);
}

export function deleteSession(id: string): void {
  const db = getDb();
  db.run("DELETE FROM sessions WHERE id = ?", [id]);
}

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
  return { id, session_id: sessionId, role, content, created_at: now };
}

export function getSessionMessages(sessionId: string, database: Database = getDb()): SessionMessage[] {
  return database.query("SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC").all(sessionId) as SessionMessage[];
}

export function getSessionMessage(messageId: string, database: Database = getDb()): SessionMessage | null {
  return database.query("SELECT * FROM messages WHERE id = ?").get(messageId) as SessionMessage | null;
}

export function appendAssistantToolPart(
  messageId: string,
  toolName: string,
  input: unknown,
  database: Database = getDb(),
): { toolCallId: string } {
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

export function updateAssistantToolPart(
  messageId: string,
  toolCallId: string,
  update: AssistantToolPartUpdate,
  database: Database = getDb(),
): void {
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
  const message = getSessionMessage(messageId, database);
  if (!message || message.role !== "assistant") return;

  const parts = parseAssistantParts(message.content);
  const nextContent = JSON.stringify(update(parts));
  const now = Date.now();

  database.run("UPDATE messages SET content = ? WHERE id = ?", [nextContent, messageId]);
  database.run("UPDATE sessions SET updated_at = ? WHERE id = ?", [now, message.session_id]);
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
