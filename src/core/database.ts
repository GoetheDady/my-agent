/**
 * 数据库初始化模块
 *
 * 职责：初始化 SQLite 数据库连接，创建 sessions / messages 表。
 * 使用 WAL 模式支持多进程并发读。
 */

import { Database } from "bun:sqlite";
import { resolve } from "path";

let db: Database | null = null;

export function getDb(): Database {
  if (db) return db;

  const dbPath = resolve(import.meta.dir, "../../data/agent.sqlite");

  db = new Database(dbPath, { create: true });

  // WAL 模式：支持多进程并发读，写不阻塞读
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA foreign_keys = ON");

  // 建表
  db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '新对话',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    )
  `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id)`);

  db.run(`
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT 'default',
      agent_id TEXT NOT NULL DEFAULT '',
      memory_type TEXT NOT NULL DEFAULT 'fact',
      content TEXT NOT NULL,
      embedding TEXT NOT NULL,
      source_session_id TEXT NOT NULL DEFAULT '',
      source_text TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      confidence REAL NOT NULL DEFAULT 1.0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_accessed_at INTEGER NOT NULL,
      access_count INTEGER NOT NULL DEFAULT 0,
      embedding_model TEXT NOT NULL DEFAULT 'embedding-3',
      embedding_dim INTEGER NOT NULL DEFAULT 0
    )
  `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_memories_user ON memories(user_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_memories_agent ON memories(user_id, agent_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_memories_status ON memories(status)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(memory_type)`);

  console.log(`[db] 数据库已初始化: ${dbPath}`);
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
