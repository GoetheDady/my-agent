import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { ensureDefaultAgent } from "../agents/agent-registry";
import {
  appendMessage,
  createSession,
  getSessionMessage,
} from "../sessions/service";
import { initializeDatabaseSchema } from "../core/database";
import { appendEvent, listTaskEvents } from "../events/event-log";
import { createTask } from "../tasks/task-store";
import {
  MemoryExtractionWorker,
  persistExtractionFailure,
  retryFailedExtractions,
  type MemoryExtractionJob,
  type MemoryWorkerStore,
} from "./extraction-worker";
import type { Memory } from "./store";

function createMemory(overrides: Partial<Memory>): Memory {
  return {
    id: "memory-1",
    user_id: "default",
    agent_id: "",
    memory_type: "preference",
    content: "用户喜欢西红柿",
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

function createWorkerDb() {
  const db = new Database(":memory:");
  db.run("PRAGMA foreign_keys = ON");
  initializeDatabaseSchema(db);
  ensureDefaultAgent(db);

  const session = createSession("test", db);
  const task = createTask({
    id: "task-1",
    conversation_id: session.id,
    source_channel: "web",
    input: "hello",
  }, db);
  const assistantMessage = appendMessage(
    session.id,
    "assistant",
    JSON.stringify([{ type: "text", text: "done" }]),
    db,
  );

  return { db, session, task, assistantMessage };
}

function parseAssistantParts(db: Database, messageId: string): Array<Record<string, unknown>> {
  const message = getSessionMessage(messageId, db);
  expect(message).not.toBeNull();
  return JSON.parse(message!.content) as Array<Record<string, unknown>>;
}

function createStore(overrides: Partial<MemoryWorkerStore> = {}): MemoryWorkerStore {
  return {
    addMemory: async () => null,
    getMemory: async () => null,
    listMemories: async () => ({ memories: [], total: 0 }),
    searchMemories: async () => [],
    updateMemory: async () => null,
    setMemoryStatus: async () => null,
    ...overrides,
  };
}

function createRetryJob(input: ReturnType<typeof createWorkerDb>): MemoryExtractionJob {
  return {
    agentId: "default",
    taskId: input.task.id,
    conversationId: input.session.id,
    sessionId: input.session.id,
    assistantMessageId: input.assistantMessage.id,
    userText: "我正在开发自己的 agent runtime",
    assistantText: "好的",
    database: input.db,
  };
}

describe("memory extraction worker", () => {
  test("persists extraction failures for retry", () => {
    const context = createWorkerDb();
    const { db, assistantMessage } = context;
    const before = Date.now();

    try {
      persistExtractionFailure(db, assistantMessage.id, "default", new Error("embedding timeout"), createRetryJob(context));
      const retry = db.query<{
        message_id: string;
        agent_id: string;
        attempt_count: number;
        next_retry_at: number;
        last_error: string;
      }, []>("SELECT * FROM memory_extraction_retries").get();

      expect(retry).toMatchObject({
        message_id: assistantMessage.id,
        agent_id: "default",
        attempt_count: 0,
      });
      expect(JSON.parse(retry!.last_error)).toMatchObject({ error: "embedding timeout" });
      expect(retry!.next_retry_at).toBeGreaterThanOrEqual(before + 30_000);
      expect(retry!.next_retry_at).toBeLessThanOrEqual(Date.now() + 30_000);
    } finally {
      db.close();
    }
  });

  test("retryFailedExtractions increments attempts and schedules exponential backoff on failure", async () => {
    const context = createWorkerDb();
    const { db, assistantMessage } = context;
    const worker = new MemoryExtractionWorker({
      store: createStore(),
      profileSync: async () => ({ status: "skipped", applied: [] }),
      planner: async () => {
        throw new Error("planner unavailable");
      },
    });

    try {
      persistExtractionFailure(db, assistantMessage.id, "default", new Error("initial"), createRetryJob(context));
      db.run("UPDATE memory_extraction_retries SET next_retry_at = ?", [Date.now() - 1]);
      const before = Date.now();

      await retryFailedExtractions(db, worker);
      const retry = db.query<{ attempt_count: number; next_retry_at: number; last_error: string }, []>(
        "SELECT attempt_count, next_retry_at, last_error FROM memory_extraction_retries",
      ).get();

      expect(retry).toMatchObject({ attempt_count: 1 });
      expect(JSON.parse(retry!.last_error)).toMatchObject({ error: "planner unavailable" });
      expect(retry!.next_retry_at).toBeGreaterThanOrEqual(before + 60_000);
      expect(retry!.next_retry_at).toBeLessThanOrEqual(Date.now() + 60_000);
    } finally {
      db.close();
    }
  });

  test("retryFailedExtractions deletes retry record after success", async () => {
    const context = createWorkerDb();
    const { db, assistantMessage } = context;
    const worker = new MemoryExtractionWorker({
      store: createStore(),
      profileSync: async () => ({ status: "skipped", applied: [] }),
      planner: async () => ({ new_memories: [], updates: [], summary: "无新增记忆" }),
    });

    try {
      persistExtractionFailure(db, assistantMessage.id, "default", new Error("initial"), createRetryJob(context));
      db.run("UPDATE memory_extraction_retries SET next_retry_at = ?", [Date.now() - 1]);

      await retryFailedExtractions(db, worker);

      const retry = db.query("SELECT id FROM memory_extraction_retries").get();
      expect(retry).toBeNull();
    } finally {
      db.close();
    }
  });

  test("retryFailedExtractions ignores exhausted records", async () => {
    const { db, assistantMessage } = createWorkerDb();
    const worker = new MemoryExtractionWorker({
      store: createStore(),
      profileSync: async () => ({ status: "skipped", applied: [] }),
      planner: async () => {
        throw new Error("should not run");
      },
    });

    try {
      db.run(
        `INSERT INTO memory_extraction_retries
         (id, message_id, agent_id, attempt_count, next_retry_at, last_error, created_at)
         VALUES (?, ?, ?, 5, ?, ?, ?)`,
        [assistantMessage.id, assistantMessage.id, "default", Date.now() - 1, "exhausted", Date.now()],
      );

      await retryFailedExtractions(db, worker);

      const retry = db.query<{ attempt_count: number; last_error: string }, []>(
        "SELECT attempt_count, last_error FROM memory_extraction_retries",
      ).get();
      expect(retry).toEqual({ attempt_count: 5, last_error: "exhausted" });
    } finally {
      db.close();
    }
  });

  test("adds a synthetic memory_extract tool part and records completed events", async () => {
    const { db, session, task, assistantMessage } = createWorkerDb();
    const savedMemories: Memory[] = [];
    const store = createStore({
      addMemory: async (params) => {
        const memory = createMemory({
          id: "new-memory",
          content: params.content,
          memory_type: params.memory_type,
          status: params.status,
        });
        savedMemories.push(memory);
        return memory;
      },
    });
    const worker = new MemoryExtractionWorker({
      store,
      profileSync: async () => ({ status: "skipped", applied: [] }),
      planner: async () => ({
        new_memories: [{ content: "用户正在开发自己的 agent runtime", memory_type: "project" }],
        updates: [],
        summary: "新增项目记忆",
      }),
    });

    try {
      const result = await worker.enqueue({
        agentId: "default",
        taskId: task.id,
        conversationId: session.id,
        sessionId: session.id,
        assistantMessageId: assistantMessage.id,
        userText: "我正在开发自己的 agent runtime",
        assistantText: "好的",
        database: db,
      });

      expect(result.addedMemoryIds).toEqual(["new-memory"]);
      expect(savedMemories[0]).toMatchObject({ status: "active" });
      const parts = parseAssistantParts(db, assistantMessage.id);
      expect(parts).toContainEqual(expect.objectContaining({
        type: "tool-memory_extract",
        state: "output-available",
        output: expect.objectContaining({ addedCount: 1, summary: "新增项目记忆" }),
      }));
      expect(listTaskEvents(task.id, db).map((event) => event.type)).toContain("memory.extract.completed");
    } finally {
      db.close();
    }
  });

  test("reconsolidates retrieved memories by updating the original active memory", async () => {
    const { db, session, task, assistantMessage } = createWorkerDb();
    appendEvent({
      agent_id: "default",
      task_id: task.id,
      conversation_id: session.id,
      type: "memory.search",
      payload: { query: "喜欢吃什么", resultIds: ["memory-old"] },
    }, db);

    let updatedContent = "";
    const store = createStore({
      getMemory: async (id) => createMemory({ id, content: "用户喜欢西红柿" }),
      updateMemory: async (id, content) => {
        updatedContent = content;
        return createMemory({ id, content });
      },
    });
    const worker = new MemoryExtractionWorker({
      store,
      profileSync: async () => ({ status: "skipped", applied: [] }),
      planner: async () => ({
        new_memories: [],
        updates: [{
          memory_id: "memory-old",
          content: "用户曾表示喜欢西红柿；现在明确表示不喜欢西红柿，改为喜欢黄瓜。",
        }],
        summary: "更新饮食偏好",
      }),
    });

    try {
      const result = await worker.enqueue({
        agentId: "default",
        taskId: task.id,
        conversationId: session.id,
        sessionId: session.id,
        assistantMessageId: assistantMessage.id,
        userText: "我现在不喜欢西红柿了，喜欢黄瓜",
        assistantText: "记住了",
        database: db,
      });

      expect(result.updatedMemoryIds).toEqual(["memory-old"]);
      expect(updatedContent).toContain("曾表示喜欢西红柿");
      expect(updatedContent).toContain("现在明确表示不喜欢西红柿");
      const parts = parseAssistantParts(db, assistantMessage.id);
      expect(parts).toContainEqual(expect.objectContaining({
        type: "tool-memory_reconsolidate",
        state: "output-available",
        output: expect.objectContaining({ updatedCount: 1 }),
      }));
      expect(listTaskEvents(task.id, db).map((event) => event.type)).toContain("memory.reconsolidate.completed");
    } finally {
      db.close();
    }
  });

  test("worker searches related old memories even when the agent did not call memory_search", async () => {
    const { db, session, task, assistantMessage } = createWorkerDb();
    let plannerSawOldMemory = false;
    let updatedContent = "";
    const store = createStore({
      searchMemories: async () => [createMemory({ id: "memory-old", content: "用户喜欢西红柿" })],
      updateMemory: async (id, content) => {
        updatedContent = content;
        return createMemory({ id, content });
      },
    });
    const worker = new MemoryExtractionWorker({
      store,
      profileSync: async () => ({ status: "skipped", applied: [] }),
      planner: async ({ retrievedMemories }) => {
        plannerSawOldMemory = retrievedMemories.some((memory) => memory.id === "memory-old");
        return {
          new_memories: [],
          updates: [{
            memory_id: "memory-old",
            content: "用户曾表示喜欢西红柿；现在明确表示不喜欢西红柿，改为喜欢黄瓜。",
            confidence: 0.9,
          }],
          summary: "自主检索并更新旧记忆",
        };
      },
    });

    try {
      const result = await worker.enqueue({
        agentId: "default",
        taskId: task.id,
        conversationId: session.id,
        sessionId: session.id,
        assistantMessageId: assistantMessage.id,
        userText: "我现在不喜欢西红柿了，喜欢黄瓜",
        assistantText: "记住了",
        database: db,
      });

      expect(plannerSawOldMemory).toBe(true);
      expect(result.retrievedMemoryIds).toEqual(["memory-old"]);
      expect(result.updatedMemoryIds).toEqual(["memory-old"]);
      expect(updatedContent).toContain("现在明确表示不喜欢西红柿");
      const events = listTaskEvents(task.id, db);
      expect(events).toContainEqual(expect.objectContaining({ type: "memory.search" }));
      expect(events).toContainEqual(expect.objectContaining({ type: "memory.reconsolidate.completed" }));
    } finally {
      db.close();
    }
  });

  test("skips low-confidence and duplicate new memories", async () => {
    const { db, session, task, assistantMessage } = createWorkerDb();
    let addCalls = 0;
    const store = createStore({
      addMemory: async () => {
        addCalls += 1;
        return createMemory({ id: `new-${addCalls}` });
      },
      listMemories: async () => ({ memories: [createMemory({ id: "existing", content: "用户偏好浅色 UI" })], total: 1 }),
      searchMemories: async () => [createMemory({ id: "existing", content: "用户偏好浅色 UI" })],
    });
    const worker = new MemoryExtractionWorker({
      store,
      profileSync: async () => ({ status: "skipped", applied: [] }),
      planner: async () => ({
        new_memories: [
          { content: "用户偏好浅色 UI", confidence: 0.95 },
          { content: "用户喜欢某个未确认工具", confidence: 0.4 },
        ],
        updates: [],
        summary: "跳过低质量记忆",
      }),
    });

    try {
      const result = await worker.enqueue({
        agentId: "default",
        taskId: task.id,
        conversationId: session.id,
        sessionId: session.id,
        assistantMessageId: assistantMessage.id,
        userText: "我偏好浅色 UI",
        assistantText: "好的",
        database: db,
      });

      expect(addCalls).toBe(0);
      expect(result.addedMemoryIds).toEqual([]);
      const parts = parseAssistantParts(db, assistantMessage.id);
      expect(parts).toContainEqual(expect.objectContaining({
        type: "tool-memory_extract",
        state: "output-available",
        output: expect.objectContaining({ addedCount: 0 }),
      }));
    } finally {
      db.close();
    }
  });

  test("skips duplicate active memory fragments even when related-memory search misses them", async () => {
    const { db, session, task, assistantMessage } = createWorkerDb();
    let addCalls = 0;
    const existing = createMemory({
      id: "existing-active",
      content: "用户正在开发 my-agent 项目，偏好浅色、舒服、密度适中的 Web UI。",
    });
    const store = createStore({
      addMemory: async () => {
        addCalls += 1;
        return createMemory({ id: `new-${addCalls}` });
      },
      listMemories: async () => ({ memories: [existing], total: 1 }),
    });
    const worker = new MemoryExtractionWorker({
      store,
      profileSync: async () => ({ status: "skipped", applied: [] }),
      planner: async () => ({
        new_memories: [{
          content: "用户偏好浅色、舒服、密度适中的 Web UI。",
          memory_type: "preference",
          confidence: 0.95,
        }],
        updates: [],
        summary: "跳过重复记忆",
      }),
    });

    try {
      const result = await worker.enqueue({
        agentId: "default",
        taskId: task.id,
        conversationId: session.id,
        sessionId: session.id,
        assistantMessageId: assistantMessage.id,
        userText: "请记住：我正在开发 my-agent 项目，我偏好浅色、舒服、密度适中的 Web UI。",
        assistantText: "记住了",
        database: db,
      });

      expect(addCalls).toBe(0);
      expect(result.addedMemoryIds).toEqual([]);
      const parts = parseAssistantParts(db, assistantMessage.id);
      expect(parts).toContainEqual(expect.objectContaining({
        type: "tool-memory_extract",
        state: "output-available",
        output: expect.objectContaining({ addedCount: 0 }),
      }));
    } finally {
      db.close();
    }
  });

  test("runs profile sync after memory changes without adding chat tool cards", async () => {
    const { db, session, task, assistantMessage } = createWorkerDb();
    let syncedContents: string[] = [];
    const store = createStore({
      addMemory: async (params) => createMemory({
        id: "identity-memory",
        content: params.content,
        memory_type: params.memory_type,
        status: params.status,
      }),
    });
    const worker = new MemoryExtractionWorker({
      store,
      profileSync: async (input) => {
        syncedContents = input.memories.map((memory) => memory.content);
        return { status: "completed", applied: [] };
      },
      planner: async () => ({
        new_memories: [{ content: "用户名字叫张三", memory_type: "identity", confidence: 0.95 }],
        updates: [],
        summary: "新增身份记忆",
      }),
    });

    try {
      const result = await worker.enqueue({
        agentId: "default",
        taskId: task.id,
        conversationId: session.id,
        sessionId: session.id,
        assistantMessageId: assistantMessage.id,
        userText: "请记住：我叫张三",
        assistantText: "记住了",
        database: db,
      });

      expect(result.addedMemoryIds).toEqual(["identity-memory"]);
      expect(syncedContents).toEqual(["用户名字叫张三"]);
      const parts = parseAssistantParts(db, assistantMessage.id);
      expect(parts.some((part) => part.type === "tool-profile_sync")).toBe(false);
    } finally {
      db.close();
    }
  });

  test("processes queued jobs serially", async () => {
    const first = createWorkerDb();
    const second = createWorkerDb();
    let active = 0;
    let maxActive = 0;
    const store = createStore();
    const worker = new MemoryExtractionWorker({
      store,
      profileSync: async () => ({ status: "skipped", applied: [] }),
      planner: async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return { new_memories: [], updates: [], summary: "done" };
      },
    });

    try {
      await Promise.all([
        worker.enqueue({
          agentId: "default",
          taskId: first.task.id,
          conversationId: first.session.id,
          sessionId: first.session.id,
          assistantMessageId: first.assistantMessage.id,
          userText: "a",
          assistantText: "b",
          database: first.db,
        }),
        worker.enqueue({
          agentId: "default",
          taskId: second.task.id,
          conversationId: second.session.id,
          sessionId: second.session.id,
          assistantMessageId: second.assistantMessage.id,
          userText: "c",
          assistantText: "d",
          database: second.db,
        }),
      ]);

      expect(maxActive).toBe(1);
    } finally {
      first.db.close();
      second.db.close();
    }
  });
});
