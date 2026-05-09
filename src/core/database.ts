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

  database.run(`
    CREATE TABLE IF NOT EXISTS episodes (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      conversation_id TEXT,
      task_id TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      outcome TEXT NOT NULL DEFAULT '',
      time_range_start INTEGER NOT NULL,
      time_range_end INTEGER NOT NULL,
      people TEXT NOT NULL DEFAULT '[]',
      tools_used TEXT NOT NULL DEFAULT '[]',
      files_touched TEXT NOT NULL DEFAULT '[]',
      decisions TEXT NOT NULL DEFAULT '[]',
      problems TEXT NOT NULL DEFAULT '[]',
      source_event_ids TEXT NOT NULL DEFAULT '[]',
      importance REAL NOT NULL DEFAULT 0.5,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(task_id),
      FOREIGN KEY (agent_id) REFERENCES agents(id),
      FOREIGN KEY (task_id) REFERENCES tasks(id)
    )
  `);

  database.run(`
    CREATE TABLE IF NOT EXISTS daily_summaries (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      date TEXT NOT NULL,
      timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
      summary TEXT NOT NULL,
      highlights TEXT NOT NULL DEFAULT '[]',
      episode_ids TEXT NOT NULL DEFAULT '[]',
      memory_change_ids TEXT NOT NULL DEFAULT '[]',
      open_questions TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(agent_id, date, timezone),
      FOREIGN KEY (agent_id) REFERENCES agents(id)
    )
  `);

  database.run(`
    CREATE TABLE IF NOT EXISTS memory_review_items (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      title TEXT NOT NULL,
      proposed_content TEXT NOT NULL,
      target_memory_ids TEXT NOT NULL DEFAULT '[]',
      source_event_ids TEXT NOT NULL DEFAULT '[]',
      confidence REAL NOT NULL DEFAULT 0.5,
      reason TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      reviewed_at INTEGER,
      FOREIGN KEY (agent_id) REFERENCES agents(id)
    )
  `);

  database.run(`
    CREATE TABLE IF NOT EXISTS dream_runs (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      date TEXT NOT NULL,
      timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
      trigger TEXT NOT NULL,
      dry_run INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      completed_at INTEGER,
      error TEXT,
      FOREIGN KEY (agent_id) REFERENCES agents(id)
    )
  `);

  database.run(`
    CREATE TABLE IF NOT EXISTS memory_decisions (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      dream_run_id TEXT,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      title TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      confidence REAL NOT NULL DEFAULT 0.5,
      target_memory_ids TEXT NOT NULL DEFAULT '[]',
      created_memory_ids TEXT NOT NULL DEFAULT '[]',
      source_event_ids TEXT NOT NULL DEFAULT '[]',
      before_snapshot TEXT NOT NULL DEFAULT '[]',
      after_snapshot TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL,
      applied_at INTEGER,
      undone_at INTEGER,
      error TEXT,
      FOREIGN KEY (agent_id) REFERENCES agents(id),
      FOREIGN KEY (dream_run_id) REFERENCES dream_runs(id)
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
  database.run(`CREATE INDEX IF NOT EXISTS idx_episodes_agent_time ON episodes(agent_id, time_range_end)`);
  database.run(`CREATE INDEX IF NOT EXISTS idx_episodes_task ON episodes(task_id)`);
  database.run(
    `CREATE INDEX IF NOT EXISTS idx_daily_summaries_agent_date ON daily_summaries(agent_id, date)`,
  );
  database.run(
    `CREATE INDEX IF NOT EXISTS idx_memory_review_agent_status ON memory_review_items(agent_id, status, created_at)`,
  );
  database.run(
    `CREATE INDEX IF NOT EXISTS idx_dream_runs_agent_date ON dream_runs(agent_id, date, trigger, dry_run, status)`,
  );
  database.run(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_dream_runs_scheduled_completed
     ON dream_runs(agent_id, date, trigger, dry_run)
     WHERE trigger = 'scheduled' AND dry_run = 0 AND status = 'completed'`,
  );
  database.run(
    `CREATE INDEX IF NOT EXISTS idx_memory_decisions_agent_status
     ON memory_decisions(agent_id, status, created_at)`,
  );
  database.run(
    `CREATE INDEX IF NOT EXISTS idx_memory_decisions_dream_run ON memory_decisions(dream_run_id)`,
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
