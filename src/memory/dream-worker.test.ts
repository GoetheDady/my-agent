import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { ensureDefaultAgent } from "../agents/agent-registry";
import { initializeDatabaseSchema } from "../core/database";
import { listAgentEvents } from "../events/event-log";
import { createTask, markTaskCompleted, markTaskRunning } from "../tasks/task-store";
import { runDreamWorker } from "./dream-worker";
import { upsertEpisodeForTask } from "./episode-store";
import type { Memory } from "./store";

function createMemory(overrides: Partial<Memory>): Memory {
  return {
    id: "memory-1",
    user_id: "default",
    agent_id: "",
    memory_type: "fact",
    content: "用户正在开发 my-agent 项目",
    embedding: [],
    source_session_id: "",
    source_text: "",
    status: "active",
    confidence: 0.9,
    created_at: 1,
    updated_at: 1,
    last_accessed_at: 1,
    access_count: 0,
    embedding_model: "test",
    embedding_dim: 0,
    ...overrides,
  };
}

function withDreamDb<T>(run: (db: Database) => T | Promise<T>): Promise<T> {
  const db = new Database(":memory:");
  db.run("PRAGMA foreign_keys = ON");
  initializeDatabaseSchema(db);
  ensureDefaultAgent(db);
  return Promise.resolve(run(db)).finally(() => db.close());
}

describe("dream worker", () => {
  test("generates daily summary in dry run without persisting it", async () => {
    await withDreamDb(async (db) => {
      const task = createTask({
        id: "task-dream",
        source_channel: "web",
        input: "实现人类式记忆计划",
        created_at: new Date("2026-05-09T02:00:00.000Z").getTime(),
      }, db);
      markTaskRunning(task.id, db);
      markTaskCompleted(task.id, "完成了 schema 和工具基础", db);
      upsertEpisodeForTask(task.id, db);

      const dedupeStore = {
        listMemories: async () => ({
          memories: [
            createMemory({ id: "a", content: "用户偏好浅色 UI" }),
            createMemory({ id: "b", content: "用户偏好浅色 UI。" }),
          ],
          total: 2,
        }),
        setMemoryStatus: async (id: string, status: string) => createMemory({ id, status }),
      };

      const result = await runDreamWorker({
        database: db,
        date: "2026-05-09",
        dryRun: true,
        dedupeStore,
      });

      expect(result.summary.summary).toContain("实现人类式记忆计划");
      expect(result.dedupe.duplicateGroups).toHaveLength(1);
      expect(result.dryRun).toBe(true);
      expect(listAgentEvents("default", 10, db).map((event) => event.type)).toContain("dream.completed");
    });
  });
});
