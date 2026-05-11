import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { ensureDefaultAgent } from "../agents/agent-registry";
import { initializeDatabaseSchema } from "../core/database";
import { listAgentEvents } from "../events/event-log";
import { MemoryService, type MemoryServiceStore } from "./service";
import type { Memory } from "./store";
import { createTestMemory } from "./test-utils";

function createStore(initial: Memory[] = []): { store: MemoryServiceStore; memories: Map<string, Memory>; addCalls: () => number } {
  const memories = new Map(initial.map((memory) => [memory.id, memory]));
  let addCount = 0;
  return {
    memories,
    addCalls: () => addCount,
    store: {
      listMemories: async (params) => {
        let items = Array.from(memories.values());
        if (params.status) items = items.filter((memory) => memory.status === params.status);
        if (params.type) items = items.filter((memory) => memory.memory_type === params.type);
        return { memories: items, total: items.length };
      },
      getMemory: async (id) => memories.get(id) ?? null,
      addMemory: async (params) => {
        addCount += 1;
        const memory = createTestMemory({
          id: `memory-${addCount}`,
          content: params.content,
          memory_type: params.memory_type ?? "fact",
          confidence: params.confidence ?? 0.8,
          status: params.status ?? "active",
          source_session_id: params.source_session_id ?? "",
          source_text: params.source_text ?? "",
          created_at: addCount,
          updated_at: addCount,
        });
        memories.set(memory.id, memory);
        return memory;
      },
      updateMemory: async (id, content) => {
        const memory = memories.get(id);
        if (!memory) return null;
        const updated = { ...memory, content, updated_at: memory.updated_at + 1 };
        memories.set(id, updated);
        return updated;
      },
      setMemoryStatus: async (id, status) => {
        const memory = memories.get(id);
        if (!memory) return null;
        const updated = { ...memory, status, updated_at: memory.updated_at + 1 };
        memories.set(id, updated);
        return updated;
      },
    },
  };
}

async function withDb<T>(run: (db: Database) => T | Promise<T>): Promise<T> {
  const db = new Database(":memory:");
  db.run("PRAGMA foreign_keys = ON");
  initializeDatabaseSchema(db);
  ensureDefaultAgent(db);
  try {
    return await run(db);
  } finally {
    db.close();
  }
}

describe("MemoryService", () => {
  test("remember creates the first memory and records action", async () => {
    await withDb(async (db) => {
      const { store } = createStore();
      const service = new MemoryService({ store, profileSync: async () => ({ status: "skipped", applied: [] }) });

      const result = await service.remember(
        { content: "用户正在开发 my-agent 项目", memory_type: "project" },
        { database: db, store },
      );

      expect(result.action).toBe("created");
      expect(result.memory?.content).toContain("my-agent");
      const event = listAgentEvents("default", 10, db).find((item) => item.type === "memory.remember");
      expect(event).toBeDefined();
      expect(JSON.parse(event!.payload)).toMatchObject({ action: "created", memoryId: result.memory?.id });
    });
  });

  test("remember reuses duplicate content without creating another memory", async () => {
    const existing = createTestMemory({ id: "existing", content: "用户正在开发 my-agent 项目" });
    const { store, addCalls } = createStore([existing]);
    const service = new MemoryService({ store, profileSync: async () => ({ status: "skipped", applied: [] }) });

    const result = await service.remember({ content: "请记住：我正在开发 my-agent 项目" }, { store });

    expect(result.action).toBe("reused");
    expect(result.memory?.id).toBe("existing");
    expect(result.duplicateOfMemoryId).toBe("existing");
    expect(addCalls()).toBe(0);
  });

  test("remember updates existing memory when incoming content is more complete", async () => {
    const existing = createTestMemory({ id: "existing", content: "用户偏好浅色 UI" });
    const { store, memories, addCalls } = createStore([existing]);
    const service = new MemoryService({ store, profileSync: async () => ({ status: "skipped", applied: [] }) });

    const result = await service.remember(
      { content: "用户偏好浅色、舒服、密度适中的 Web UI。", memory_type: "preference" },
      { store },
    );

    expect(result.action).toBe("updated");
    expect(result.memory?.id).toBe("existing");
    expect(memories.get("existing")?.content).toContain("密度适中");
    expect(addCalls()).toBe(0);
  });

  test("canonical UI preference expressions are treated as the same memory", async () => {
    const existing = createTestMemory({
      id: "ui-preference",
      memory_type: "preference",
      content: "用户偏好浅色、密度适中的 UI。",
    });
    const { store, addCalls } = createStore([existing]);
    const service = new MemoryService({ store, profileSync: async () => ({ status: "skipped", applied: [] }) });

    const result = await service.remember({
      content: "用户的 UI 偏好是浅色、中等密度、舒适。",
      memory_type: "preference",
    }, { store });

    expect(result.action).toBe("updated");
    expect(result.memory?.id).toBe("ui-preference");
    expect(addCalls()).toBe(0);
  });

  test("opposite preference polarity is not treated as duplicate", async () => {
    const existing = createTestMemory({ id: "tomato", content: "用户喜欢西红柿" });
    const { store, addCalls } = createStore([existing]);
    const service = new MemoryService({ store, profileSync: async () => ({ status: "skipped", applied: [] }) });

    const result = await service.remember({ content: "用户不喜欢西红柿", memory_type: "preference" }, { store });

    expect(result.action).toBe("created");
    expect(addCalls()).toBe(1);
    expect(result.memory?.id).not.toBe("tomato");
  });

  test("profile sync only runs for created and updated memories", async () => {
    const existing = createTestMemory({ id: "existing", content: "用户正在开发 my-agent 项目" });
    const { store } = createStore([existing]);
    let syncCount = 0;
    const service = new MemoryService({
      store,
      profileSync: async () => {
        syncCount += 1;
        return { status: "completed", applied: [] };
      },
    });

    await service.remember({ content: "用户正在开发 my-agent 项目" }, { store });
    await service.remember({ content: "用户正在长期开发 my-agent 项目，并关注记忆系统。", memory_type: "project" }, { store });

    expect(syncCount).toBe(1);
  });
});
