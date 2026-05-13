import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { ensureDefaultAgent, getAgent } from "../agents/agent-registry";
import { initializeDatabaseSchema } from "../core/database";
import { claimNextTask, claimTask } from "./task-queue";
import {
  createTask,
  getTask,
  listTasks,
  markTaskCompleted,
  markTaskFailed,
  recoverRunningTasks,
} from "./task-store";

function withTaskDb<T>(run: (db: Database) => T): T {
  const db = new Database(":memory:");
  db.run("PRAGMA foreign_keys = ON");
  initializeDatabaseSchema(db);
  ensureDefaultAgent(db);

  try {
    return run(db);
  } finally {
    db.close();
  }
}

function insertAgent(db: Database, agentId: string, name: string): void {
  const now = Date.now();
  db
    .query(
      `INSERT INTO agents (id, name, status, current_task_id, workspace_path, created_at, updated_at)
       VALUES (?, ?, 'idle', NULL, '', ?, ?)`,
    )
    .run(agentId, name, now, now);
}

describe("task queue", () => {
  test("createTask stores queued task", () => {
    withTaskDb((db) => {
      const task = createTask(
        { source_channel: "web", source_user_id: "user-1", input: "hello" },
        db,
      );

      expect(task.status).toBe("queued");
      expect(getTask(task.id, db)).toMatchObject({
        id: task.id,
        agent_id: "default",
        source_channel: "web",
        source_user_id: "user-1",
        input: "hello",
        status: "queued",
      });
    });
  });

  test("claimNextTask returns oldest highest-priority queued task", () => {
    withTaskDb((db) => {
      createTask(
        { id: "low-old", source_channel: "web", input: "low", priority: 1, created_at: 1 },
        db,
      );
      createTask(
        {
          id: "high-old",
          source_channel: "web",
          input: "high old",
          priority: 10,
          created_at: 2,
        },
        db,
      );
      createTask(
        {
          id: "high-new",
          source_channel: "web",
          input: "high new",
          priority: 10,
          created_at: 3,
        },
        db,
      );

      const claimed = claimNextTask("default", db);

      expect(claimed?.id).toBe("high-old");
      expect(claimed?.status).toBe("running");
      expect(getAgent("default", db)).toMatchObject({
        status: "running",
        current_task_id: "high-old",
      });
    });
  });

  test("claimNextTask does not claim another task while agent is running", () => {
    withTaskDb((db) => {
      createTask({ id: "first", source_channel: "web", input: "first", created_at: 1 }, db);
      createTask({ id: "second", source_channel: "web", input: "second", created_at: 2 }, db);

      expect(claimNextTask("default", db)?.id).toBe("first");
      expect(claimNextTask("default", db)).toBeNull();
      expect(getTask("second", db)?.status).toBe("queued");
    });
  });

  test("different agents can hold independent running tasks", () => {
    withTaskDb((db) => {
      insertAgent(db, "researcher", "Researcher");
      createTask({ id: "default-task", agent_id: "default", source_channel: "web", input: "default" }, db);
      createTask({ id: "research-task", agent_id: "researcher", source_channel: "web", input: "research" }, db);

      expect(claimNextTask("default", db)).toMatchObject({ id: "default-task", status: "running" });
      expect(claimNextTask("researcher", db)).toMatchObject({ id: "research-task", status: "running" });
      expect(getAgent("default", db)).toMatchObject({ status: "running", current_task_id: "default-task" });
      expect(getAgent("researcher", db)).toMatchObject({ status: "running", current_task_id: "research-task" });
    });
  });

  test("claimTask claims a specific queued task only when agent is idle", () => {
    withTaskDb((db) => {
      createTask({ id: "first", source_channel: "web", input: "first", created_at: 1 }, db);
      createTask({ id: "second", source_channel: "web", input: "second", created_at: 2 }, db);

      expect(claimTask("second", db)).toMatchObject({
        id: "second",
        status: "running",
      });
      expect(getTask("first", db)?.status).toBe("queued");
      expect(claimTask("first", db)).toBeNull();
    });
  });

  test("markTaskCompleted sets current agent back to idle", () => {
    withTaskDb((db) => {
      createTask({ id: "first", source_channel: "web", input: "first", created_at: 1 }, db);
      createTask({ id: "second", source_channel: "web", input: "second", created_at: 2 }, db);

      expect(claimNextTask("default", db)?.id).toBe("first");
      markTaskCompleted("first", "done", db);

      expect(getTask("first", db)).toMatchObject({
        status: "completed",
        result: "done",
      });
      expect(getAgent("default", db)).toMatchObject({
        status: "idle",
        current_task_id: null,
      });
      expect(claimNextTask("default", db)?.id).toBe("second");
    });
  });

  test("markTaskFailed stores error and releases current agent", () => {
    withTaskDb((db) => {
      createTask({ id: "first", source_channel: "web", input: "first" }, db);
      claimNextTask("default", db);

      markTaskFailed("first", "boom", db);

      expect(getTask("first", db)).toMatchObject({
        status: "failed",
        error: "boom",
      });
      expect(getAgent("default", db)).toMatchObject({
        status: "idle",
        current_task_id: null,
      });
    });
  });

  test("listTasks filters by status", () => {
    withTaskDb((db) => {
      createTask({ id: "queued", source_channel: "web", input: "queued", created_at: 1 }, db);
      createTask({ id: "running", source_channel: "web", input: "running", created_at: 2 }, db);
      claimNextTask("default", db);

      expect(listTasks("default", ["queued"], db).map((task) => task.id)).toEqual(["running"]);
    });
  });

  test("recoverRunningTasks fails stale running task and releases agent", () => {
    withTaskDb((db) => {
      createTask({ id: "stale", source_channel: "feishu", input: "stale" }, db);
      claimNextTask("default", db);

      expect(recoverRunningTasks(db)).toBe(1);

      expect(getTask("stale", db)).toMatchObject({
        status: "failed",
        error: "Recovered stale running task after service restart",
      });
      expect(getAgent("default", db)).toMatchObject({
        status: "idle",
        current_task_id: null,
      });
    });
  });
});
