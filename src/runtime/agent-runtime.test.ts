import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { ensureDefaultAgent, getAgent, updateAgentStatus } from "../agents/agent-registry";
import { AgentBusyError, runAgentTask, toModelMessages } from "./agent-runtime";
import { initializeDatabaseSchema } from "../core/database";
import { listTaskEvents } from "../events/event-log";
import { createTask, getTask } from "../tasks/task-store";
import type { TaskRecord } from "../tasks/task-types";

function withRunnerDb<T>(run: (db: Database, task: TaskRecord) => T): T {
  const db = new Database(":memory:");
  db.run("PRAGMA foreign_keys = ON");
  initializeDatabaseSchema(db);
  ensureDefaultAgent(db);
  const task = createTask({ id: "task-1", source_channel: "web", input: "hello" }, db);

  try {
    return run(db, task);
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
  test("marks task as running", () => {
    withRunnerDb((db, task) => {
      runAgentTask({
        task,
        messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
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

  test("appends task started event", () => {
    withRunnerDb((db, task) => {
      runAgentTask({
        task,
        messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
        streamTextRunner: fakeStreamTextSuccess as never,
        database: db,
      });

      expect(listTaskEvents(task.id, db).map((event) => event.type)).toContain("task.started");
    });
  });

  test("completes task with assistant output when stream finishes", () => {
    withRunnerDb((db, task) => {
      runAgentTask({
        task,
        messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
        streamTextRunner: ((options: { onFinish?: (event: { text: string }) => void }) => {
          options.onFinish?.({ text: "done" });
          return fakeStreamTextSuccess();
        }) as never,
        database: db,
      });

      expect(getTask(task.id, db)).toMatchObject({
        status: "completed",
        result: "done",
      });
      expect(getAgent("default", db)).toMatchObject({
        status: "idle",
        current_task_id: null,
      });
      expect(listTaskEvents(task.id, db).map((event) => event.type)).toEqual([
        "task.started",
        "assistant.message",
        "task.completed",
        "episode.created",
      ]);
    });
  });

  test("marks task failed when model call throws", () => {
    withRunnerDb((db, task) => {
      expect(() =>
        runAgentTask({
          task,
          messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
          streamTextRunner: (() => {
            throw new Error("model down");
          }) as never,
          database: db,
        }),
      ).toThrow("model down");

      expect(getTask(task.id, db)).toMatchObject({
        status: "failed",
        error: "model down",
      });
      expect(getAgent("default", db)).toMatchObject({
        status: "idle",
        current_task_id: null,
      });
      expect(listTaskEvents(task.id, db).map((event) => event.type)).toEqual([
        "task.started",
        "task.failed",
      ]);
    });
  });

  test("marks task failed and releases agent when the client aborts the stream", () => {
    withRunnerDb((db, task) => {
      const controller = new AbortController();

      runAgentTask({
        task,
        messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
        abortSignal: controller.signal,
        streamTextRunner: fakeStreamTextSuccess as never,
        database: db,
      });

      controller.abort();

      expect(getTask(task.id, db)).toMatchObject({
        status: "failed",
        error: "Client aborted stream",
      });
      expect(getAgent("default", db)).toMatchObject({
        status: "idle",
        current_task_id: null,
      });
      expect(listTaskEvents(task.id, db).map((event) => event.type)).toEqual([
        "task.started",
        "task.failed",
      ]);
    });
  });

  test("leaves task queued when agent is busy", () => {
    withRunnerDb((db, task) => {
      updateAgentStatus("default", "running", "other-task", db);

      expect(() =>
        runAgentTask({
          task,
          messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
          streamTextRunner: fakeStreamTextSuccess as never,
          database: db,
        }),
      ).toThrow(AgentBusyError);

      expect(getTask(task.id, db)).toMatchObject({
        status: "queued",
        error: null,
      });
      expect(listTaskEvents(task.id, db)).toEqual([]);
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
});
