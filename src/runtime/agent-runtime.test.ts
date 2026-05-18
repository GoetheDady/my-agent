import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { ensureDefaultAgent, getAgent, updateAgentStatus } from "../agents/agent-registry";
import { AgentBusyError, runAgentTask, toAgentUiMessageStreamResponse, toModelMessages } from "./agent-runtime";
import { initializeDatabaseSchema } from "../core/database";
import { listTaskEvents } from "../events/event-log";
import { createTask, getTask } from "../tasks/task-store";
import type { TaskRecord } from "../tasks/task-types";

async function withRunnerDb<T>(run: (db: Database, task: TaskRecord) => T | Promise<T>): Promise<T> {
  const db = new Database(":memory:");
  db.run("PRAGMA foreign_keys = ON");
  initializeDatabaseSchema(db);
  ensureDefaultAgent(db);
  const task = createTask({ id: "task-1", source_channel: "web", input: "hello" }, db);

  try {
    return await run(db, task);
  } finally {
    db.close();
  }
}

function fakeStreamTextSuccess() {
  return {
    toUIMessageStreamResponse: () => new Response("ok"),
  };
}

describe("agent runtime", () => {
  test("marks task as running", async () => {
    await withRunnerDb(async (db, task) => {
      await runAgentTask({
        task,
        messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
        memorySearcher: async () => [],
        streamTextRunner: fakeStreamTextSuccess as never,
        database: db,
      });

      expect(getTask(task.id, db)).toMatchObject({ status: "running" });
      expect(getAgent("default", db)).toMatchObject({
        status: "running",
        current_task_id: task.id,
      });
    });
  });

  test("appends task started event", async () => {
    await withRunnerDb(async (db, task) => {
      await runAgentTask({
        task,
        messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
        memorySearcher: async () => [],
        streamTextRunner: fakeStreamTextSuccess as never,
        database: db,
      });

      expect(listTaskEvents(task.id, db).map((event) => event.type)).toContain("task.started");
    });
  });

  test("completes task with assistant output when stream finishes", async () => {
    await withRunnerDb(async (db, task) => {
      await runAgentTask({
        task,
        messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
        memorySearcher: async () => [],
        streamTextRunner: ((options: { onFinish?: (event: { text: string }) => void }) => {
          options.onFinish?.({ text: "done" });
          return fakeStreamTextSuccess();
        }) as never,
        database: db,
      });

      expect(getTask(task.id, db)).toMatchObject({
        status: "completed",
        result: "done",
        progress_status: "completed",
      });
      expect(getAgent("default", db)).toMatchObject({
        status: "idle",
        current_task_id: null,
      });
      const completedTypes = listTaskEvents(task.id, db).map((event) => event.type);
      expect(completedTypes.filter((type) => type === "task.progress.updated")).toHaveLength(4);
      expect(completedTypes).toContain("task.started");
      expect(completedTypes).toContain("assistant.message");
      expect(completedTypes).toContain("task.completed");
      expect(completedTypes).toContain("episode.created");
    });
  });

  test("records tool progress when the stream emits tool chunks", async () => {
    await withRunnerDb(async (db, task) => {
      await runAgentTask({
        task,
        messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
        memorySearcher: async () => [],
        streamTextRunner: ((options: {
          onChunk?: (event: { chunk: { type: string } }) => void;
          onFinish?: (event: { text: string }) => void;
        }) => {
          options.onChunk?.({ chunk: { type: "tool-call" } });
          options.onFinish?.({ text: "done" });
          return fakeStreamTextSuccess();
        }) as never,
        database: db,
      });

      const progressEvents = listTaskEvents(task.id, db)
        .filter((event) => event.type === "task.progress.updated")
        .map((event) => JSON.parse(event.payload) as { progressStatus: string });

      expect(progressEvents.map((event) => event.progressStatus)).toContain("using_tool");
    });
  });

  test("marks task failed when model call throws", async () => {
    await withRunnerDb(async (db, task) => {
      await expect(
        runAgentTask({
          task,
          messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
          memorySearcher: async () => [],
          streamTextRunner: (() => {
            throw new Error("model down");
          }) as never,
          database: db,
        }),
      ).rejects.toThrow("model down");

      expect(getTask(task.id, db)).toMatchObject({
        status: "failed",
        error: "model down",
        failure_type: "model_error",
        failure_stage: "model_call",
        retriable: true,
        progress_status: "failed",
      });
      expect(getAgent("default", db)).toMatchObject({
        status: "idle",
        current_task_id: null,
      });
      const failedTypes = listTaskEvents(task.id, db).map((event) => event.type);
      expect(failedTypes.filter((type) => type === "task.progress.updated")).toHaveLength(3);
      expect(failedTypes).toContain("task.started");
      expect(failedTypes).toContain("task.failed.classified");
      expect(failedTypes).toContain("task.failed");
    });
  });

  test("marks task canceled and releases agent when the client aborts the stream", async () => {
    await withRunnerDb(async (db, task) => {
      const controller = new AbortController();

      await runAgentTask({
        task,
        messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
        memorySearcher: async () => [],
        abortSignal: controller.signal,
        streamTextRunner: fakeStreamTextSuccess as never,
        database: db,
      });

      controller.abort();

      expect(getTask(task.id, db)).toMatchObject({
        status: "canceled",
        error: null,
        failure_type: "user_canceled",
        failure_stage: "cancel",
        retriable: false,
        progress_status: "canceled",
      });
      expect(getAgent("default", db)).toMatchObject({
        status: "idle",
        current_task_id: null,
      });
      const canceledTypes = listTaskEvents(task.id, db).map((event) => event.type);
      expect(canceledTypes.filter((type) => type === "task.progress.updated")).toHaveLength(3);
      expect(canceledTypes).toContain("task.started");
      expect(canceledTypes).toContain("task.cancel.requested");
      expect(canceledTypes).toContain("task.canceled");
    });
  });

  test("leaves task queued when agent is busy", async () => {
    await withRunnerDb(async (db, task) => {
      updateAgentStatus("default", "running", "other-task", db);

      await expect(
        runAgentTask({
          task,
          messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
          streamTextRunner: fakeStreamTextSuccess as never,
          database: db,
        }),
      ).rejects.toThrow(AgentBusyError);

      expect(getTask(task.id, db)).toMatchObject({
        status: "queued",
        error: null,
      });
      expect(listTaskEvents(task.id, db)).toEqual([]);
    });
  });

  test("injects retrieved memories into the system prompt", async () => {
    await withRunnerDb(async (db, task) => {
      let receivedSystemPrompt = "";

      await runAgentTask({
        task,
        messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
        memorySearcher: async () => [
          { memory_type: "semantic", content: "用户偏好简洁回复" },
        ],
        streamTextRunner: ((options: { system?: string }) => {
          receivedSystemPrompt = options.system ?? "";
          return fakeStreamTextSuccess();
        }) as never,
        database: db,
      });

      expect(receivedSystemPrompt).toContain("<relevant-memories>");
      expect(receivedSystemPrompt).toContain("[semantic] 用户偏好简洁回复");
    });
  });

  test("continues when relevant memory search fails", async () => {
    await withRunnerDb(async (db, task) => {
      let receivedSystemPrompt = "";

      await runAgentTask({
        task,
        messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
        memorySearcher: async () => {
          throw new Error("embedding unavailable");
        },
        streamTextRunner: ((options: { system?: string }) => {
          receivedSystemPrompt = options.system ?? "";
          return fakeStreamTextSuccess();
        }) as never,
        database: db,
      });

      expect(getTask(task.id, db)).toMatchObject({ status: "running" });
      expect(receivedSystemPrompt).not.toContain("<relevant-memories>");
    });
  });

  test("filters synthetic memory worker tool parts before converting history to model messages", async () => {
    const messages = await toModelMessages([
      {
        role: "assistant",
        parts: [
          { type: "text", text: "我记下了。" },
          {
            type: "tool-memory_extract",
            toolCallId: "memory_extract-1",
            state: "input-available",
            input: { assistantMessageId: "message-1" },
          },
        ],
      },
    ]);

    const serialized = JSON.stringify(messages);
    expect(serialized).toContain("我记下了。");
    expect(serialized).not.toContain("memory_extract-1");
  });

  test("passes original UI messages to the UI stream response for approval continuations", () => {
    const originalMessages = [
      {
        id: "assistant-message-1",
        role: "assistant",
        parts: [
          {
            type: "tool-agent_create",
            toolCallId: "call-1",
            state: "approval-responded",
            input: { agentId: "testagent" },
            approval: { id: "approval-1", approved: true },
          },
        ],
      },
    ];
    let receivedOriginalMessages: unknown;

    const response = toAgentUiMessageStreamResponse(
      {
        taskId: "task-1",
        result: {
          toUIMessageStreamResponse: (options: { originalMessages?: unknown }) => {
            receivedOriginalMessages = options.originalMessages;
            return new Response("ok");
          },
        },
      } as never,
      () => {},
      originalMessages,
    );

    expect(response.status).toBe(200);
    expect(receivedOriginalMessages).toBe(originalMessages);
  });
});
