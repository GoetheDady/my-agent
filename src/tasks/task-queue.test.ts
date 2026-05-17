import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { ensureDefaultAgent, getAgent } from "../agents/agent-registry";
import { initializeDatabaseSchema } from "../core/database";
import { claimNextTask, claimTask } from "./task-queue";
import {
  createTask,
  getTask,
  listTasks,
  markTaskCanceled,
  markTaskCompleted,
  markTaskFailed,
  recoverRunningTasks,
  renewTaskLease,
  retryTask,
  updateTaskProgress,
} from "./task-store";
import { listTaskEvents } from "../events/event-log";
import {
  addTaskDependency,
  listTaskSteps,
  setTaskPlan,
  updateTaskStepStatus,
} from "./task-plan-store";

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
        parent_task_id: null,
        plan_step_id: null,
        source_channel: "web",
        source_user_id: "user-1",
        input: "hello",
        status: "queued",
        attempt_count: 0,
        max_attempts: 3,
        lease_expires_at: null,
        idempotency_key: null,
        canceled_at: null,
        failure_type: null,
        failure_stage: null,
        retriable: null,
        progress_status: "waiting",
        progress_message: "",
      });
    });
  });

  test("createTask stores parent task and plan step links", () => {
    withTaskDb((db) => {
      createTask({ id: "parent", source_channel: "web", input: "parent" }, db);
      const [step] = setTaskPlan("parent", [{ title: "child step", detail: "" }], db);

      const child = createTask({
        id: "child",
        parent_task_id: "parent",
        plan_step_id: step.id,
        source_channel: "delegation",
        input: "child",
      }, db);

      expect(child).toMatchObject({
        parent_task_id: "parent",
        plan_step_id: step.id,
      });
      expect(listTaskEvents("parent", db).map((event) => event.type)).toContain("task.child.created");
    });
  });

  test("createTask returns existing task for duplicate idempotency key", () => {
    withTaskDb((db) => {
      const first = createTask({
        id: "first",
        source_channel: "feishu",
        input: "hello",
        idempotency_key: "feishu:message-1",
      }, db);
      const second = createTask({
        id: "second",
        source_channel: "feishu",
        input: "duplicate",
        idempotency_key: "feishu:message-1",
      }, db);

      expect(second.id).toBe(first.id);
      expect(listTasks("default", undefined, db).map((task) => task.id)).toEqual(["first"]);
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
      expect(claimed?.attempt_count).toBe(1);
      expect(claimed?.lease_expires_at).toBeGreaterThan(Date.now());
      expect(claimed?.progress_status).toBe("claimed");
      expect(claimed?.progress_message).toBe("任务已领取");
      expect(getAgent("default", db)).toMatchObject({
        status: "running",
        current_task_id: "high-old",
      });
    });
  });

  test("claimNextTask skips queued tasks with unmet dependencies", () => {
    withTaskDb((db) => {
      createTask({ id: "blocked", source_channel: "web", input: "blocked", priority: 10, created_at: 1 }, db);
      createTask({ id: "blocker", source_channel: "web", input: "blocker", priority: 1, created_at: 2 }, db);
      createTask({ id: "free", source_channel: "web", input: "free", priority: 0, created_at: 3 }, db);
      addTaskDependency("blocked", "blocker", "等待 blocker 完成", db);

      expect(claimNextTask("default", db)?.id).toBe("blocker");
      markTaskCompleted("blocker", "done", db);
      expect(claimNextTask("default", db)?.id).toBe("blocked");
    });
  });

  test("claimTask marks a dependency-blocked task without claiming it", () => {
    withTaskDb((db) => {
      createTask({ id: "blocked", source_channel: "web", input: "blocked", priority: 10 }, db);
      createTask({ id: "blocker", source_channel: "web", input: "blocker", priority: 1 }, db);
      addTaskDependency("blocked", "blocker", "等待 blocker 完成", db);

      expect(claimTask("blocked", db)).toBeNull();

      expect(getTask("blocked", db)).toMatchObject({
        status: "queued",
        progress_status: "blocked",
        progress_message: "等待依赖任务完成",
      });
      expect(listTaskEvents("blocked", db).map((event) => event.type)).toContain("task.dependency.blocked");
      expect(getAgent("default", db)).toMatchObject({ status: "idle", current_task_id: null });
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
        lease_expires_at: null,
        progress_status: "completed",
      });
      expect(getAgent("default", db)).toMatchObject({
        status: "idle",
        current_task_id: null,
      });
      expect(claimNextTask("default", db)?.id).toBe("second");
    });
  });

  test("child task terminal state updates the linked parent step", () => {
    withTaskDb((db) => {
      createTask({ id: "parent", source_channel: "web", input: "parent" }, db);
      const [step] = setTaskPlan("parent", [{ title: "child step", detail: "" }], db);
      createTask({
        id: "child",
        parent_task_id: "parent",
        plan_step_id: step.id,
        source_channel: "delegation",
        input: "child",
      }, db);
      updateTaskStepStatus(step.id, "running", db);

      markTaskCompleted("child", "done", db);

      expect(listTaskSteps("parent", db)[0]).toMatchObject({
        id: step.id,
        status: "completed",
        child_task_id: "child",
      });
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
        lease_expires_at: null,
        failure_type: "model_error",
        failure_stage: "model_call",
        retriable: true,
        progress_status: "failed",
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

  test("markTaskCanceled clears lease and releases running agent", () => {
    withTaskDb((db) => {
      createTask({ id: "cancel-me", source_channel: "web", input: "cancel" }, db);
      claimNextTask("default", db);

      markTaskCanceled("cancel-me", db);

      expect(getTask("cancel-me", db)).toMatchObject({
        status: "canceled",
        lease_expires_at: null,
        failure_type: "user_canceled",
        failure_stage: "cancel",
        retriable: false,
        progress_status: "canceled",
      });
      expect(typeof getTask("cancel-me", db)?.canceled_at).toBe("number");
      expect(getAgent("default", db)).toMatchObject({
        status: "idle",
        current_task_id: null,
      });
    });
  });

  test("renewTaskLease extends running task lease and writes event", () => {
    withTaskDb((db) => {
      createTask({ id: "running", source_channel: "web", input: "run" }, db);
      claimNextTask("default", db);
      db.query("UPDATE tasks SET lease_expires_at = ? WHERE id = ?").run(Date.now() - 1, "running");

      const renewed = renewTaskLease("running", db);

      expect(renewed?.lease_expires_at).toBeGreaterThan(Date.now());
      expect(listTaskEvents("running", db).map((event) => event.type)).toContain("task.lease.renewed");
    });
  });

  test("updateTaskProgress stores current progress and writes event", () => {
    withTaskDb((db) => {
      createTask({ id: "progress", source_channel: "web", input: "run" }, db);
      claimNextTask("default", db);

      updateTaskProgress("progress", { status: "calling_model", message: "正在调用模型" }, db);

      expect(getTask("progress", db)).toMatchObject({
        progress_status: "calling_model",
        progress_message: "正在调用模型",
      });
      expect(listTaskEvents("progress", db).map((event) => event.type)).toContain("task.progress.updated");
    });
  });

  test("retryTask requeues failed task without increasing attempt count", () => {
    withTaskDb((db) => {
      createTask({ id: "retry-me", source_channel: "web", input: "retry" }, db);
      claimNextTask("default", db);
      markTaskFailed("retry-me", "boom", db);

      const retried = retryTask("retry-me", {}, db);

      expect(retried).toMatchObject({
        status: "queued",
        attempt_count: 1,
        result: null,
        error: null,
        completed_at: null,
        lease_expires_at: null,
        failure_type: null,
        failure_stage: null,
        retriable: null,
        progress_status: "waiting",
        progress_message: "任务已重新排队",
      });
      expect(listTaskEvents("retry-me", db).map((event) => event.type)).toContain("task.retry_scheduled");
    });
  });

  test("retryTask rejects completed task", () => {
    withTaskDb((db) => {
      createTask({ id: "done", source_channel: "web", input: "done" }, db);
      claimNextTask("default", db);
      markTaskCompleted("done", "ok", db);

      expect(() => retryTask("done", {}, db)).toThrow("任务已完成，不能重试。");
    });
  });

  test("retryTask rejects canceled task by default and allows force retry", () => {
    withTaskDb((db) => {
      createTask({ id: "canceled", source_channel: "web", input: "cancel" }, db);
      markTaskCanceled("canceled", db);

      expect(() => retryTask("canceled", {}, db)).toThrow("任务已取消");
      expect(retryTask("canceled", { force: true }, db)).toMatchObject({
        status: "queued",
        canceled_at: null,
      });
    });
  });

  test("retryTask rejects max attempts unless forced", () => {
    withTaskDb((db) => {
      createTask({ id: "maxed", source_channel: "web", input: "max", max_attempts: 1 }, db);
      claimNextTask("default", db);
      markTaskFailed("maxed", "boom", db);

      expect(() => retryTask("maxed", {}, db)).toThrow("任务已达到最大执行次数");
      expect(retryTask("maxed", { force: true }, db)).toMatchObject({ status: "queued" });
    });
  });

  test("recoverRunningTasks ignores unexpired running task", () => {
    withTaskDb((db) => {
      createTask({ id: "active", source_channel: "web", input: "active" }, db);
      claimNextTask("default", db);

      expect(recoverRunningTasks(db)).toBe(0);
      expect(getTask("active", db)).toMatchObject({ status: "running" });
      expect(getAgent("default", db)).toMatchObject({
        status: "running",
        current_task_id: "active",
      });
    });
  });

  test("recoverRunningTasks requeues expired running task and releases agent", () => {
    withTaskDb((db) => {
      createTask({ id: "stale", source_channel: "web", input: "stale" }, db);
      claimNextTask("default", db);
      db.query("UPDATE tasks SET lease_expires_at = ? WHERE id = ?").run(Date.now() - 1, "stale");

      expect(recoverRunningTasks(db)).toBe(1);

      expect(getTask("stale", db)).toMatchObject({
        status: "queued",
        error: null,
        lease_expires_at: null,
        progress_status: "waiting",
      });
      expect(getAgent("default", db)).toMatchObject({
        status: "idle",
        current_task_id: null,
      });
      expect(listTaskEvents("stale", db).map((event) => event.type)).toEqual([
        "task.recovered",
        "task.retry_scheduled",
      ]);
    });
  });

  test("recoverRunningTasks permanently fails expired task after max attempts", () => {
    withTaskDb((db) => {
      createTask({ id: "max-stale", source_channel: "web", input: "stale", max_attempts: 1 }, db);
      claimNextTask("default", db);
      db.query("UPDATE tasks SET lease_expires_at = ? WHERE id = ?").run(Date.now() - 1, "max-stale");

      expect(recoverRunningTasks(db)).toBe(1);

      expect(getTask("max-stale", db)).toMatchObject({
        status: "failed",
        lease_expires_at: null,
        failure_type: "lease_expired",
        failure_stage: "recovery",
        retriable: false,
        progress_status: "failed",
      });
      expect(getAgent("default", db)).toMatchObject({
        status: "idle",
        current_task_id: null,
      });
      expect(listTaskEvents("max-stale", db).map((event) => event.type)).toEqual([
        "task.failed_permanently",
        "task.failed.classified",
      ]);
    });
  });
});
