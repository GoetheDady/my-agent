import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { ensureDefaultAgent } from "../agents/agent-registry";
import { initializeDatabaseSchema } from "../core/database";
import { listAgentEvents } from "../events/event-log";
import {
  createMemoryDecision,
  getMemoryDecision,
  listMemoryDecisions,
  undoMemoryDecision,
  type MemoryDecisionMemoryStore,
  type MemoryDecisionSnapshot,
} from "./decision-store";
import { createDreamRun } from "./dream-run-store";
import type { Memory } from "./store";

function withDecisionDb<T>(run: (db: Database) => T | Promise<T>): Promise<T> {
  const db = new Database(":memory:");
  db.run("PRAGMA foreign_keys = ON");
  initializeDatabaseSchema(db);
  ensureDefaultAgent(db);
  return Promise.resolve(run(db)).finally(() => db.close());
}

function createMemory(overrides: Partial<Memory>): Memory {
  return {
    id: "memory-1",
    user_id: "default",
    agent_id: "",
    memory_type: "fact",
    content: "用户偏好浅色 UI",
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

function snapshot(memory: Memory): MemoryDecisionSnapshot {
  return {
    id: memory.id,
    content: memory.content,
    memory_type: memory.memory_type,
    status: memory.status,
    confidence: memory.confidence,
    updated_at: memory.updated_at,
  };
}

describe("memory decision store", () => {
  test("records applied decisions and emits audit events", async () => {
    await withDecisionDb((db) => {
      const run = createDreamRun({
        agentId: "default",
        date: "2026-05-09",
        timezone: "Asia/Shanghai",
        dryRun: false,
      }, db);
      const decision = createMemoryDecision({
        agentId: "default",
        dreamRunId: run.id,
        type: "exact_dedupe",
        status: "applied",
        title: "停用重复记忆",
        targetMemoryIds: ["a", "b"],
        confidence: 0.95,
      }, db);

      expect(getMemoryDecision(decision.id, db)?.status).toBe("applied");
      expect(listMemoryDecisions({ agentId: "default" }, db)).toHaveLength(1);
      expect(listAgentEvents("default", 5, db).map((event) => event.type)).toContain("memory.decision.applied");
    });
  });

  test("undo restores before snapshots and marks created memories inactive", async () => {
    await withDecisionDb(async (db) => {
      const before = createMemory({ id: "old", content: "用户喜欢西红柿", status: "active", updated_at: 10 });
      const created = createMemory({ id: "new", content: "用户曾经喜欢西红柿；现在不喜欢西红柿。", status: "active", updated_at: 20 });
      const memories = new Map<string, Memory>([
        [before.id, { ...before, content: "用户不喜欢西红柿", status: "superseded" }],
        [created.id, created],
      ]);
      const store: MemoryDecisionMemoryStore = {
        getMemory: async (id) => memories.get(id) ?? null,
        setMemoryStatus: async (id, status) => {
          const memory = memories.get(id);
          if (!memory) return null;
          const updated = { ...memory, status };
          memories.set(id, updated);
          return updated;
        },
        restoreMemorySnapshot: async (value) => {
          const existing = memories.get(value.id);
          if (!existing) return null;
          const restored = { ...existing, ...value };
          memories.set(value.id, restored);
          return restored;
        },
      };
      const run = createDreamRun({
        agentId: "default",
        date: "2026-05-09",
        timezone: "Asia/Shanghai",
        dryRun: false,
      }, db);
      const decision = createMemoryDecision({
        agentId: "default",
        dreamRunId: run.id,
        type: "semantic_merge",
        status: "applied",
        title: "合并记忆",
        beforeSnapshot: [snapshot(before)],
        afterSnapshot: [snapshot(memories.get(before.id)!), snapshot(created)],
        targetMemoryIds: [before.id],
        createdMemoryIds: [created.id],
      }, db);

      const result = await undoMemoryDecision(decision.id, { database: db, store });

      expect(result.changed).toBe(true);
      expect(result.decision?.status).toBe("undone");
      expect(memories.get(before.id)?.content).toBe("用户喜欢西红柿");
      expect(memories.get(before.id)?.status).toBe("active");
      expect(memories.get(created.id)?.status).toBe("inactive");
      expect(listAgentEvents("default", 5, db).map((event) => event.type)).toContain("memory.decision.undone");
    });
  });
});
