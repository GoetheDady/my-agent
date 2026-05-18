import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureDefaultAgent } from "../agents/agent-registry";
import { initializeDatabaseSchema } from "./database";
import {
  backupDatabase,
  backupDatabaseIfStale,
  createTimestampedBackupPath,
  exportDatabaseJson,
  listBackups,
  pruneBackups,
} from "./backup";
import { createSession } from "../sessions/service";
import { createTask } from "../tasks/task-store";

function createTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function withBackupDb<T>(run: (db: Database, tempDir: string) => T | Promise<T>): Promise<T> {
  const tempDir = createTempDir("my-agent-backup-");
  const dbPath = join(tempDir, "agent.sqlite");
  const db = new Database(dbPath);
  db.run("PRAGMA foreign_keys = ON");
  initializeDatabaseSchema(db);
  ensureDefaultAgent(db);
  return Promise.resolve()
    .then(() => run(db, tempDir))
    .finally(() => {
      db.close();
      rmSync(tempDir, { recursive: true, force: true });
    });
}

describe("backup core", () => {
  test("backupDatabase creates a readable sqlite snapshot", async () => {
    await withBackupDb(async (db, tempDir) => {
      createTask({ id: "task-1", source_channel: "web", input: "hello" }, db);
      const targetPath = join(tempDir, "backups", "agent.sqlite");

      const result = await backupDatabase(targetPath, db);
      expect(result.path).toBe(targetPath);
      expect(result.size).toBeGreaterThan(0);
      expect(existsSync(targetPath)).toBe(true);

      const backupDb = new Database(targetPath, { readonly: true });
      try {
        const row = backupDb.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM tasks").get();
        expect(row?.count).toBe(1);
      } finally {
        backupDb.close();
      }
    });
  });

  test("exportDatabaseJson exports structured sqlite metadata", async () => {
    await withBackupDb(async (db) => {
      createSession({ title: "会话一", agentId: "default" }, db);
      createTask({ id: "task-1", source_channel: "web", input: "导出任务" }, db);

      const exported = exportDatabaseJson(db);
      expect(exported.version).toBe(1);
      expect(exported.agents.map((agent) => agent.id)).toEqual(["default"]);
      expect(exported.tasks.map((task) => task.id)).toEqual(["task-1"]);
      expect(exported.sessions).toHaveLength(1);
      expect(exported.memories.count).toBe(0);
      expect(exported.memories.note).toContain("LanceDB");
    });
  });

  test("pruneBackups keeps the newest files only", async () => {
    await withBackupDb(async (_db, tempDir) => {
      const backupDir = join(tempDir, "backups");
      mkdirSync(backupDir, { recursive: true });
      for (let index = 0; index < 6; index += 1) {
        const file = join(backupDir, `agent-2026-01-01T00-00-0${index}.sqlite`);
        writeFileSync(file, String(index));
      }

      pruneBackups(backupDir, 5);
      const backups = listBackups(backupDir);
      expect(backups).toHaveLength(5);
      expect(backups.some((backup) => backup.filename.endsWith("00.sqlite"))).toBe(false);
    });
  });

  test("backupDatabaseIfStale skips when a recent backup already exists", async () => {
    await withBackupDb(async (_db, tempDir) => {
      const backupDir = join(tempDir, "backups");
      mkdirSync(backupDir, { recursive: true });
      const targetPath = createTimestampedBackupPath(backupDir);
      writeFileSync(targetPath, "recent");

      const result = await backupDatabaseIfStale({
        backupDir,
        intervalMs: 24 * 60 * 60 * 1000,
      });

      expect(result.created).toBe(false);
      expect(listBackups(backupDir)).toHaveLength(1);
    });
  });
});
