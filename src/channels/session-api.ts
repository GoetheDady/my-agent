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

export function createSession(title?: string): Session {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = Date.now();
  db.run(
    "INSERT INTO sessions (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)",
    [id, title ?? "新对话", now, now],
  );
  return { id, title: title ?? "新对话", created_at: now, updated_at: now };
}

export function listSessions(): Session[] {
  const db = getDb();
  return db.query("SELECT * FROM sessions ORDER BY updated_at DESC").all() as Session[];
}

export function updateSessionTitle(id: string, title: string): void {
  const db = getDb();
  const now = Date.now();
  db.run("UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?", [title, now, id]);
}

export function deleteSession(id: string): void {
  const db = getDb();
  db.run("DELETE FROM sessions WHERE id = ?", [id]);
}

export function appendMessage(sessionId: string, role: "user" | "assistant", content: string): SessionMessage {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = Date.now();
  db.run(
    "INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)",
    [id, sessionId, role, JSON.stringify(content), now],
  );
  db.run("UPDATE sessions SET updated_at = ? WHERE id = ?", [now, sessionId]);
  return { id, session_id: sessionId, role, content: JSON.stringify(content), created_at: now };
}

export function getSessionMessages(sessionId: string): SessionMessage[] {
  const db = getDb();
  return db.query("SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC").all(sessionId) as SessionMessage[];
}
