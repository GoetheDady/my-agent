import { describe, expect, test } from "bun:test";
import {
  dedupeActiveMemories,
  type MemoryDedupeStore,
} from "./dedupe";
import type { Memory } from "./store";

function createMemory(overrides: Partial<Memory>): Memory {
  return {
    id: "memory-1",
    user_id: "default",
    agent_id: "",
    memory_type: "preference",
    content: "用户偏好浅色 UI",
    embedding: [],
    source_session_id: "",
    source_text: "",
    status: "active",
    confidence: 0.8,
    created_at: 1,
    updated_at: 1,
    last_accessed_at: 1,
    access_count: 0,
    embedding_model: "test",
    embedding_dim: 0,
    ...overrides,
  };
}

describe("memory dedupe", () => {
  test("marks exact duplicate active memories inactive and keeps the best memory", async () => {
    const memories = [
      createMemory({ id: "older", content: "用户偏好浅色 UI", confidence: 0.8, created_at: 1 }),
      createMemory({ id: "better", content: "用户偏好浅色 UI。", confidence: 0.95, created_at: 2 }),
      createMemory({ id: "different", content: "用户偏好深色 UI", confidence: 0.9, created_at: 3 }),
    ];
    const inactiveIds: string[] = [];
    const store: MemoryDedupeStore = {
      listMemories: async () => ({ memories, total: memories.length }),
      setMemoryStatus: async (id, status) => {
        inactiveIds.push(id);
        return createMemory({ id, status });
      },
    };

    const result = await dedupeActiveMemories({ store });

    expect(result.scannedCount).toBe(3);
    expect(result.duplicateGroups).toEqual([{
      content: "用户偏好浅色 UI。",
      keptMemoryId: "better",
      duplicateMemoryIds: ["older"],
    }]);
    expect(result.inactiveMemoryIds).toEqual(["older"]);
    expect(inactiveIds).toEqual(["older"]);
  });

  test("dry run reports duplicates without changing memory status", async () => {
    const memories = [
      createMemory({ id: "a", content: "用户正在开发 my-agent 项目" }),
      createMemory({ id: "b", content: "用户正在开发 my-agent 项目。" }),
    ];
    const inactiveIds: string[] = [];
    const store: MemoryDedupeStore = {
      listMemories: async () => ({ memories, total: memories.length }),
      setMemoryStatus: async (id, status) => {
        inactiveIds.push(id);
        return createMemory({ id, status });
      },
    };

    const result = await dedupeActiveMemories({ store, dryRun: true });

    expect(result.dryRun).toBe(true);
    expect(result.duplicateGroups).toHaveLength(1);
    expect(result.inactiveMemoryIds).toEqual([]);
    expect(inactiveIds).toEqual([]);
  });

  test("marks preference fragments inactive when already embedded in a broader fact", async () => {
    const memories = [
      createMemory({
        id: "fact",
        memory_type: "fact",
        content: "用户正在开发 my-agent 项目，偏好浅色、舒服、密度适中的 Web UI。",
        confidence: 0.8,
        created_at: 2,
      }),
      createMemory({
        id: "preference",
        memory_type: "preference",
        content: "用户偏好浅色、舒服、密度适中的 Web UI。",
        confidence: 0.95,
        created_at: 1,
      }),
    ];
    const inactiveIds: string[] = [];
    const store: MemoryDedupeStore = {
      listMemories: async () => ({ memories, total: memories.length }),
      setMemoryStatus: async (id, status) => {
        inactiveIds.push(id);
        return createMemory({ id, status });
      },
    };

    const result = await dedupeActiveMemories({ store });

    expect(result.duplicateGroups).toEqual([{
      content: "用户正在开发 my-agent 项目，偏好浅色、舒服、密度适中的 Web UI。",
      keptMemoryId: "fact",
      duplicateMemoryIds: ["preference"],
    }]);
    expect(result.inactiveMemoryIds).toEqual(["preference"]);
    expect(inactiveIds).toEqual(["preference"]);
  });

  test("does not merge opposite preference changes", async () => {
    const memories = [
      createMemory({ id: "likes", content: "用户喜欢西红柿" }),
      createMemory({ id: "dislikes", content: "用户不喜欢西红柿" }),
    ];
    const inactiveIds: string[] = [];
    const store: MemoryDedupeStore = {
      listMemories: async () => ({ memories, total: memories.length }),
      setMemoryStatus: async (id, status) => {
        inactiveIds.push(id);
        return createMemory({ id, status });
      },
    };

    const result = await dedupeActiveMemories({ store });

    expect(result.duplicateGroups).toEqual([]);
    expect(result.inactiveMemoryIds).toEqual([]);
    expect(inactiveIds).toEqual([]);
  });
});
