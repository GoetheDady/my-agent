import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { ensureDefaultAgent } from "../agents/agent-registry";
import { initializeDatabaseSchema } from "../core/database";
import { createTask, markTaskCompleted, markTaskRunning } from "../tasks/task-store";
import { upsertEpisodeForTask } from "./episode-store";
import {
  memoryEvidence,
  memoryPlan,
  memoryRecall,
  memoryReflect,
  memoryRemember,
  type HumanMemoryStorePort,
} from "./human-memory-tools";
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

function withHumanMemoryDb<T>(run: (db: Database) => T | Promise<T>): Promise<T> {
  const db = new Database(":memory:");
  db.run("PRAGMA foreign_keys = ON");
  initializeDatabaseSchema(db);
  ensureDefaultAgent(db);
  return Promise.resolve(run(db)).finally(() => db.close());
}

describe("human memory tools", () => {
  test("memoryRecall routes semantic, episodic, and prospective memories", async () => {
    await withHumanMemoryDb((db) => {
      const task = createTask({
        id: "task-1",
        conversation_id: "conversation-1",
        source_channel: "web",
        input: "帮我总结当前记忆系统还缺什么",
      }, db);
      markTaskRunning(task.id, db);
      markTaskCompleted(task.id, "缺少情景记忆和前瞻记忆", db);
      upsertEpisodeForTask(task.id, db);

      const store: HumanMemoryStorePort = {
        searchMemories: async () => [createMemory({ id: "semantic", content: "用户正在开发 my-agent 项目" })],
        listMemories: async ({ type }) => ({
          memories: type === "prospective"
            ? [createMemory({ id: "future", memory_type: "prospective", content: "后续接入飞书和微信渠道" })]
            : [],
          total: type === "prospective" ? 1 : 0,
        }),
        getMemory: async (id) => createMemory({ id, source_text: JSON.stringify({ evidenceEventIds: ["event-1"] }) }),
        addMemory: async () => null,
        setMemoryStatus: async () => null,
      };

      return Promise.all([
        memoryRecall({ query: "我在开发什么", intent: "semantic" }, { database: db, store }),
        memoryRecall({ query: "刚才做了什么", intent: "episodic" }, { database: db, store }),
        memoryRecall({ query: "后续要做什么", intent: "prospective" }, { database: db, store }),
      ]).then(([semantic, episodic, prospective]) => {
        expect(semantic.semantic[0].content).toContain("my-agent");
        expect(episodic.episodic[0].summary).toContain("缺少情景记忆");
        expect(prospective.prospective[0].content).toContain("飞书");
      });
    });
  });

  test("memoryPlan creates, lists, and completes prospective memories", async () => {
    let saved = createMemory({ id: "future-1", memory_type: "prospective", content: "接入飞书渠道" });
    const store: HumanMemoryStorePort = {
      searchMemories: async () => [],
      listMemories: async () => ({ memories: [saved], total: 1 }),
      getMemory: async () => null,
      addMemory: async (params) => {
        saved = createMemory({ id: "future-1", memory_type: params.memory_type, content: params.content });
        return saved;
      },
      setMemoryStatus: async (id, status) => createMemory({ id, status, memory_type: "prospective" }),
    };

    const created = await memoryPlan({ action: "create", content: "接入飞书渠道" }, { store });
    const listed = await memoryPlan({ action: "list" }, { store });
    const completed = await memoryPlan({ action: "complete", memoryId: "future-1" }, { store });

    expect(created.memory?.memory_type).toBe("prospective");
    expect(listed.memories).toHaveLength(1);
    expect(completed.memory?.status).toBe("completed");
  });

  test("memoryRecall maps social intent to preference memories and ranks change traces first", async () => {
    await withHumanMemoryDb(async (db) => {
      const oldMemory = createMemory({
        id: "old-tomato",
        memory_type: "preference",
        content: "用户喜欢西红柿。",
        confidence: 1,
        updated_at: 10,
      });
      const changedMemory = createMemory({
        id: "changed-cucumber",
        memory_type: "preference",
        content: "用户曾表示喜欢西红柿；现在明确表示不喜欢西红柿，改为喜欢黄瓜。",
        confidence: 0.95,
        updated_at: 20,
      });
      const store: HumanMemoryStorePort = {
        searchMemories: async () => [],
        listMemories: async ({ type }) => ({
          memories: type === "preference" ? [oldMemory, changedMemory] : [],
          total: type === "preference" ? 2 : 0,
        }),
        getMemory: async () => null,
        addMemory: async () => null,
        setMemoryStatus: async () => null,
      };

      const result = await memoryRecall(
        { query: "我现在喜欢什么？我以前有没有改过主意？", intent: "social" },
        { database: db, store },
      );

      expect(result.social.map((memory) => memory.id)).toEqual(["changed-cucumber", "old-tomato"]);
      expect(result.social[0].content).toContain("改为喜欢黄瓜");
    });
  });

  test("memoryRemember writes procedural memory and memoryReflect creates review item", async () => {
    await withHumanMemoryDb(async (db) => {
      const store: HumanMemoryStorePort = {
        searchMemories: async () => [],
        listMemories: async () => ({ memories: [], total: 0 }),
        getMemory: async (id) => createMemory({ id, source_text: JSON.stringify({ reason: "test" }) }),
        addMemory: async (params) => createMemory({ id: "procedure", memory_type: params.memory_type, content: params.content }),
        setMemoryStatus: async () => null,
      };

      const remembered = await memoryRemember(
        { content: "修改记忆系统后要同步计划文档", kind: "procedural" },
        { store },
      );
      const review = memoryReflect({
        title: "重复记忆风险",
        proposedContent: "只做整条文本去重是不够的。",
      }, { database: db });
      const evidence = await memoryEvidence({ id: "procedure" }, { store });

      expect(remembered.memory?.memory_type).toBe("procedural");
      expect(review.reviewItem.status).toBe("pending");
      expect(evidence.source).toEqual({ reason: "test" });
    });
  });
});
