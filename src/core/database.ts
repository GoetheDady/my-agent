/**
 * 数据库初始化模块
 *
 * 职责：初始化 SQLite 数据库连接，创建 runtime / sessions / messages 表。
 * 使用 WAL 模式支持多进程并发读。
 */

import { Database } from "bun:sqlite";
import { resolve } from "path";

let db: Database | null = null;

export function initializeDatabaseSchema(database: Database): void {
  // 建表
  database.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '新对话',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  database.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    )
  `);

  database.run(`CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id)`);

  database.run(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'idle',
      current_task_id TEXT,
      workspace_path TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  database.run(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      conversation_id TEXT,
      source_channel TEXT NOT NULL,
      source_user_id TEXT NOT NULL DEFAULT 'default',
      status TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 0,
      input TEXT NOT NULL,
      result TEXT,
      error TEXT,
      created_at INTEGER NOT NULL,
      started_at INTEGER,
      completed_at INTEGER,
      FOREIGN KEY (agent_id) REFERENCES agents(id)
    )
  `);

  database.run(`
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      task_id TEXT,
      conversation_id TEXT,
      type TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (agent_id) REFERENCES agents(id),
      FOREIGN KEY (task_id) REFERENCES tasks(id)
    )
  `);

  database.run(`
    CREATE TABLE IF NOT EXISTS working_memory (
      agent_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (agent_id, task_id, key),
      FOREIGN KEY (agent_id) REFERENCES agents(id),
      FOREIGN KEY (task_id) REFERENCES tasks(id)
    )
  `);

  database.run(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      channel TEXT NOT NULL,
      external_id TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '新对话',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(channel, external_id),
      FOREIGN KEY (agent_id) REFERENCES agents(id)
    )
  `);

  database.run(`
    CREATE TABLE IF NOT EXISTS channel_identities (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      channel TEXT NOT NULL,
      external_user_id TEXT NOT NULL,
      display_name TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(channel, external_user_id)
    )
  `);

  database.run(
    `CREATE INDEX IF NOT EXISTS idx_tasks_agent_status ON tasks(agent_id, status, priority, created_at)`,
  );
  database.run(`CREATE INDEX IF NOT EXISTS idx_events_agent_created ON events(agent_id, created_at)`);
  database.run(`CREATE INDEX IF NOT EXISTS idx_events_task_created ON events(task_id, created_at)`);
  database.run(
    `CREATE INDEX IF NOT EXISTS idx_conversations_agent_updated ON conversations(agent_id, updated_at)`,
  );
}

export function getDb(): Database {
  if (db) return db;

  const dbPath = resolve(import.meta.dir, "../../data/agent.sqlite");

  db = new Database(dbPath, { create: true });

  // WAL 模式：支持多进程并发读，写不阻塞读
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA foreign_keys = ON");

  initializeDatabaseSchema(db);

  console.log(`[db] 数据库已初始化: ${dbPath}`);
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
