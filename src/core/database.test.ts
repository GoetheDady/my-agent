import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { initializeDatabaseSchema } from "./database";

type TableColumn = {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
};

type ForeignKey = {
  table: string;
  from: string;
  to: string;
  on_delete: string;
};

type IndexColumn = {
  name: string;
};

type ExpectedColumn = [name: string, type: string, notnull: number, dfltValue: string | null, pk: number];

function withSchemaDb<T>(run: (db: Database) => T): T {
  const db = new Database(":memory:");
  db.run("PRAGMA foreign_keys = ON");
  initializeDatabaseSchema(db);

  try {
    return run(db);
  } finally {
    db.close();
  }
}

function readTableColumns(db: Database, tableName: string): ExpectedColumn[] {
  return db
    .query<TableColumn, []>(`PRAGMA table_info(${tableName})`)
    .all()
    .map((column) => [
      column.name,
      column.type,
      column.notnull,
      column.dflt_value,
      column.pk,
    ]);
}

function readForeignKeys(db: Database, tableName: string): ForeignKey[] {
  return db
    .query<ForeignKey, []>(`PRAGMA foreign_key_list(${tableName})`)
    .all()
    .map((foreignKey) => ({
      table: foreignKey.table,
      from: foreignKey.from,
      to: foreignKey.to,
      on_delete: foreignKey.on_delete,
    }));
}

function readIndexColumns(db: Database, indexName: string): string[] {
  return db
    .query<IndexColumn, []>(`PRAGMA index_info(${indexName})`)
    .all()
    .map((column) => column.name);
}

describe("runtime database schema", () => {
  test("creates runtime tables with expected columns, defaults, and primary keys", () => {
    withSchemaDb((db) => {
      expect(readTableColumns(db, "agents")).toEqual([
        ["id", "TEXT", 0, null, 1],
        ["name", "TEXT", 1, null, 0],
        ["status", "TEXT", 1, "'idle'", 0],
        ["current_task_id", "TEXT", 0, null, 0],
        ["workspace_path", "TEXT", 1, "''", 0],
        ["created_at", "INTEGER", 1, null, 0],
        ["updated_at", "INTEGER", 1, null, 0],
      ]);

      expect(readTableColumns(db, "tasks")).toEqual([
        ["id", "TEXT", 0, null, 1],
        ["agent_id", "TEXT", 1, null, 0],
        ["conversation_id", "TEXT", 0, null, 0],
        ["source_channel", "TEXT", 1, null, 0],
        ["source_user_id", "TEXT", 1, "'default'", 0],
        ["status", "TEXT", 1, null, 0],
        ["priority", "INTEGER", 1, "0", 0],
        ["input", "TEXT", 1, null, 0],
        ["result", "TEXT", 0, null, 0],
        ["error", "TEXT", 0, null, 0],
        ["created_at", "INTEGER", 1, null, 0],
        ["started_at", "INTEGER", 0, null, 0],
        ["completed_at", "INTEGER", 0, null, 0],
      ]);

      expect(readTableColumns(db, "events")).toEqual([
        ["id", "TEXT", 0, null, 1],
        ["agent_id", "TEXT", 1, null, 0],
        ["task_id", "TEXT", 0, null, 0],
        ["conversation_id", "TEXT", 0, null, 0],
        ["type", "TEXT", 1, null, 0],
        ["payload", "TEXT", 1, null, 0],
        ["created_at", "INTEGER", 1, null, 0],
      ]);

      expect(readTableColumns(db, "working_memory")).toEqual([
        ["agent_id", "TEXT", 1, null, 1],
        ["task_id", "TEXT", 1, null, 2],
        ["key", "TEXT", 1, null, 3],
        ["value", "TEXT", 1, null, 0],
        ["updated_at", "INTEGER", 1, null, 0],
      ]);

      expect(readTableColumns(db, "conversations")).toEqual([
        ["id", "TEXT", 0, null, 1],
        ["agent_id", "TEXT", 1, null, 0],
        ["channel", "TEXT", 1, null, 0],
        ["external_id", "TEXT", 1, null, 0],
        ["title", "TEXT", 1, "'新对话'", 0],
        ["created_at", "INTEGER", 1, null, 0],
        ["updated_at", "INTEGER", 1, null, 0],
      ]);

      expect(readTableColumns(db, "channel_identities")).toEqual([
        ["id", "TEXT", 0, null, 1],
        ["user_id", "TEXT", 1, null, 0],
        ["channel", "TEXT", 1, null, 0],
        ["external_user_id", "TEXT", 1, null, 0],
        ["display_name", "TEXT", 1, "''", 0],
        ["created_at", "INTEGER", 1, null, 0],
        ["updated_at", "INTEGER", 1, null, 0],
      ]);
    });
  });

  test("creates runtime foreign keys", () => {
    withSchemaDb((db) => {
      expect(readForeignKeys(db, "tasks")).toEqual([
        { table: "agents", from: "agent_id", to: "id", on_delete: "NO ACTION" },
      ]);

      expect(readForeignKeys(db, "events")).toEqual([
        { table: "tasks", from: "task_id", to: "id", on_delete: "NO ACTION" },
        { table: "agents", from: "agent_id", to: "id", on_delete: "NO ACTION" },
      ]);

      expect(readForeignKeys(db, "working_memory")).toEqual([
        { table: "tasks", from: "task_id", to: "id", on_delete: "NO ACTION" },
        { table: "agents", from: "agent_id", to: "id", on_delete: "NO ACTION" },
      ]);

      expect(readForeignKeys(db, "conversations")).toEqual([
        { table: "agents", from: "agent_id", to: "id", on_delete: "NO ACTION" },
      ]);

      expect(readForeignKeys(db, "channel_identities")).toEqual([]);
    });
  });

  test("creates runtime indexes with expected columns", () => {
    withSchemaDb((db) => {
      expect(readIndexColumns(db, "idx_tasks_agent_status")).toEqual([
        "agent_id",
        "status",
        "priority",
        "created_at",
      ]);
      expect(readIndexColumns(db, "idx_events_agent_created")).toEqual(["agent_id", "created_at"]);
      expect(readIndexColumns(db, "idx_events_task_created")).toEqual(["task_id", "created_at"]);
      expect(readIndexColumns(db, "idx_conversations_agent_updated")).toEqual([
        "agent_id",
        "updated_at",
      ]);
    });
  });
});
