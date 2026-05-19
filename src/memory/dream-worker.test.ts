import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { ensureDefaultAgent } from "../agents/agent-registry";
import { initializeDatabaseSchema } from "../core/database";
import { listAgentEvents } from "../events/event-log";
import { createTask, markTaskCompleted, markTaskRunning } from "../tasks/task-store";
import { listDreamRuns, runDreamWorker, type DreamMemoryStore } from "./dream-worker";
import { listMemoryDecisions } from "./decision-store";
import { upsertEpisodeForTask } from "./episode-store";
import { listSkillCandidates } from "../skills/candidate-store";
import type { Memory, MemorySnapshotRestore } from "./store";

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
  test("releases global running lock when setup fails before dream run exists", async () => {
    const closedDb = new Database(":memory:");
    closedDb.close();

    await expect(runDreamWorker({
      database: closedDb,
      date: "2026-05-09",
      dryRun: true,
    })).rejects.toThrow();

    await withDreamDb(async (db) => {
      const result = await runDreamWorker({
        database: db,
        date: "2026-05-09",
        dryRun: true,
        dedupeStore: createMemoryStore(new Map()),
      });

      expect(result.dryRun).toBe(true);
    });
  });

  test("generates daily summary in dry run without persisting it", async () => {
    await withDreamDb(async (db) => {
      const task = createTask({
        id: "task-dream",
        source_channel: "web",
        input: "实现人类式记忆计划",
        created_at: new Date("2026-05-08T18:00:00.000Z").getTime(),
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
        date: dateKeyForTest(Date.now(), "Asia/Shanghai"),
        dryRun: true,
        dedupeStore,
      });

      expect(result.summary.summary).toContain("实现人类式记忆计划");
      expect(result.dedupe.duplicateGroups).toHaveLength(1);
      expect(result.dryRun).toBe(true);
      expect(result.decisions).toEqual([]);
      expect(listAgentEvents("default", 10, db).map((event) => event.type)).toContain("dream.completed");
    });
  });

  test("applies exact dedupe through auditable memory decisions", async () => {
    await withDreamDb(async (db) => {
      const memories = new Map<string, Memory>([
        ["better", createMemory({ id: "better", content: "用户偏好浅色 UI。", confidence: 0.95, created_at: 2 })],
        ["older", createMemory({ id: "older", content: "用户偏好浅色 UI", confidence: 0.8, created_at: 1 })],
      ]);
      const store = createMemoryStore(memories);

      const result = await runDreamWorker({
        database: db,
        date: "2026-05-09",
        dryRun: false,
        memoryStore: store,
        profileSync: async () => ({ status: "skipped", applied: [] }),
      });

      expect(result.dedupe.duplicateGroups).toHaveLength(1);
      expect(result.decisionCount).toBe(1);
      expect(memories.get("older")?.status).toBe("inactive");
      expect(listMemoryDecisions({ agentId: "default" }, db)[0]?.type).toBe("exact_dedupe");
      expect(listDreamRuns({ agentId: "default" }, db)[0]?.status).toBe("completed");
      expect(listAgentEvents("default", 20, db).map((event) => event.type)).toContain("memory.decision.applied");
    });
  });

  test("keeps preference change trace when active memories conflict", async () => {
    await withDreamDb(async (db) => {
      const memories = new Map<string, Memory>([
        ["old", createMemory({ id: "old", content: "用户喜欢西红柿", updated_at: 1, created_at: 1 })],
        ["new", createMemory({ id: "new", content: "用户不喜欢西红柿", updated_at: 2, created_at: 2 })],
      ]);
      const store = createMemoryStore(memories);

      const result = await runDreamWorker({
        database: db,
        date: "2026-05-09",
        dryRun: false,
        memoryStore: store,
        profileSync: async () => ({ status: "skipped", applied: [] }),
      });

      expect(result.decisions.map((decision) => decision.type)).toContain("conflict_update");
      expect(memories.get("new")?.content).toContain("曾经喜欢西红柿");
      expect(memories.get("old")?.status).toBe("superseded");
    });
  });

  test("syncs active memories after dream decisions are applied", async () => {
    await withDreamDb(async (db) => {
      const memories = new Map<string, Memory>([
        ["old", createMemory({ id: "old", content: "用户喜欢西红柿", updated_at: 1, created_at: 1 })],
        ["new", createMemory({ id: "new", content: "用户不喜欢西红柿", updated_at: 2, created_at: 2 })],
      ]);
      const store = createMemoryStore(memories);
      let syncedIds: string[] = [];

      await runDreamWorker({
        database: db,
        date: "2026-05-09",
        dryRun: false,
        memoryStore: store,
        profileSync: async (input) => {
          syncedIds = input.memories.map((memory) => memory.id);
          return { status: "completed", applied: [] };
        },
      });

      expect(syncedIds).toEqual(["new"]);
    });
  });

  test("creates skill candidates from repeated high quality episodes during real run", async () => {
    await withDreamDb(async (db) => {
      for (const id of ["one", "two"]) {
        const task = createTask({
          id: `task-skill-${id}`,
          source_channel: "web",
          input: "实现可复用调试流程",
          created_at: new Date("2026-05-09T08:00:00.000Z").getTime(),
        }, db);
        markTaskRunning(task.id, db);
        markTaskCompleted(task.id, "完成了可复用调试流程。", db);
        const episode = upsertEpisodeForTask(task.id, db);
        if (!episode) throw new Error("episode should exist");
        db.query("UPDATE episodes SET key_steps = ?, importance = ? WHERE id = ?")
          .run(JSON.stringify(["复现问题", "补测试", "修复并验证"]), 0.8, episode.id);
      }

      const result = await runDreamWorker({
        database: db,
        date: "2026-05-09",
        dryRun: false,
        memoryStore: createMemoryStore(new Map()),
        profileSync: async () => ({ status: "skipped", applied: [] }),
      });

      expect(result.skillCandidateCount).toBe(1);
      expect(listSkillCandidates({ agentId: "default", status: "pending" }, db)).toHaveLength(1);
    });
  });
});

function createMemoryStore(memories: Map<string, Memory>): DreamMemoryStore {
  return {
    listMemories: async (params) => {
      let items = Array.from(memories.values());
      if (params.status) items = items.filter((memory) => memory.status === params.status);
      if (params.type) items = items.filter((memory) => memory.memory_type === params.type);
      return { memories: items, total: items.length };
    },
    getMemory: async (id) => memories.get(id) ?? null,
    setMemoryStatus: async (id, status) => {
      const memory = memories.get(id);
      if (!memory) return null;
      const updated = { ...memory, status, updated_at: Date.now() };
      memories.set(id, updated);
      return updated;
    },
    addMemory: async (params) => {
      const memory = createMemory({
        id: crypto.randomUUID(),
        content: params.content,
        memory_type: params.memory_type ?? "fact",
        status: params.status ?? "active",
        confidence: params.confidence ?? 0.8,
        source_text: params.source_text ?? "",
      });
      memories.set(memory.id, memory);
      return memory;
    },
    updateMemory: async (id, content) => {
      const memory = memories.get(id);
      if (!memory) return null;
      const updated = { ...memory, content, updated_at: Date.now() };
      memories.set(id, updated);
      return updated;
    },
    restoreMemorySnapshot: async (snapshot: MemorySnapshotRestore) => {
      const memory = memories.get(snapshot.id);
      if (!memory) return null;
      const restored = {
        ...memory,
        content: snapshot.content,
        memory_type: snapshot.memory_type,
        status: snapshot.status,
        confidence: snapshot.confidence,
        updated_at: snapshot.updated_at ?? Date.now(),
      };
      memories.set(snapshot.id, restored);
      return restored;
    },
  };
}

function dateKeyForTest(timestamp: number, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(timestamp));
}
