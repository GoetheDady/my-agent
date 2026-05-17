import { Database } from "bun:sqlite";
import { Hono } from "hono";
import { describe, expect, test } from "bun:test";
import { ensureDefaultAgent, updateAgentStatus } from "../agents/agent-registry";
import { initializeDatabaseSchema } from "../core/database";
import { appendEvent, listTaskEvents } from "../events/event-log";
import { finalizeEpisodeForTask } from "../memory/episode-store";
import { claimTask } from "../tasks/task-queue";
import { createTask, getTask, markTaskCompleted, markTaskFailed, markTaskRunning, updateTaskProgress } from "../tasks/task-store";
import { addTaskDependency, setTaskPlan } from "../tasks/task-plan-store";
import { createRuntimeRoutes } from "./runtime";

function withRuntimeApp<T>(run: (app: Hono, db: Database) => T | Promise<T>): Promise<T> {
  const db = new Database(":memory:");
  db.run("PRAGMA foreign_keys = ON");
  initializeDatabaseSchema(db);
  ensureDefaultAgent(db);
  const app = new Hono();
  app.route("/runtime", createRuntimeRoutes(db));

  return Promise.resolve()
    .then(() => run(app, db))
    .finally(() => db.close());
}

describe("runtime routes", () => {
  test("GET /runtime/agents/default returns default agent", async () => {
    await withRuntimeApp(async (app) => {
      const res = await app.request("/runtime/agents/default");
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toMatchObject({
        id: "default",
        status: "idle",
      });
    });
  });

  test("GET /runtime/tasks returns tasks for an agent", async () => {
    await withRuntimeApp(async (app, db) => {
      createTask({ id: "task-1", source_channel: "web", input: "hello" }, db);

      const res = await app.request("/runtime/tasks?agentId=default");
      const body = await res.json() as { tasks: Array<{ id: string }> };

      expect(res.status).toBe(200);
      expect(body.tasks.map((task) => task.id)).toEqual(["task-1"]);
    });
  });

  test("GET /runtime/tasks/:id returns one task", async () => {
    await withRuntimeApp(async (app, db) => {
      createTask({ id: "task-1", source_channel: "web", input: "hello" }, db);

      const res = await app.request("/runtime/tasks/task-1");
      const body = await res.json() as { task: { id: string; status: string; progress_status: string } };

      expect(res.status).toBe(200);
      expect(body.task).toMatchObject({
        id: "task-1",
        status: "queued",
        progress_status: "waiting",
      });
    });
  });

  test("GET /runtime/tasks/:id/timeline returns task, episode, and timeline", async () => {
    await withRuntimeApp(async (app, db) => {
      const task = createTask({
        id: "task-1",
        source_channel: "web",
        input: "timeline",
        created_at: 100,
      }, db);
      markTaskRunning(task.id, db);
      appendEvent({
        agent_id: "default",
        task_id: task.id,
        type: "task.started",
        payload: { input: task.input },
        created_at: 101,
      }, db);
      updateTaskProgress(task.id, {
        status: "using_tool",
        message: "正在执行工具：read_file",
        metadata: {
          currentToolName: "read_file",
          currentToolCallId: "call-1",
          recentOutput: "ok",
        },
      }, db);
      appendEvent({
        agent_id: "default",
        task_id: task.id,
        type: "tool.call",
        payload: { toolName: "read_file", toolCallId: "call-1", args: { path: "src/runtime/task-timeline.ts" } },
        created_at: 120,
      }, db);
      appendEvent({
        agent_id: "default",
        task_id: task.id,
        type: "tool.result",
        payload: { toolName: "read_file", toolCallId: "call-1", success: true, durationMs: 11, outputPreview: "ok" },
        created_at: 121,
      }, db);
      markTaskCompleted(task.id, "done", db);
      appendEvent({
        agent_id: "default",
        task_id: task.id,
        type: "task.completed",
        payload: { result: "done" },
        created_at: 130,
      }, db);
      finalizeEpisodeForTask(task.id, db);

      const res = await app.request("/runtime/tasks/task-1/timeline");
      const body = await res.json() as {
        task: { id: string; status: string };
        episode: { task_id: string } | null;
        current: { progressStatus: string; progressMessage: string; currentToolName: string | null };
        timeline: Array<{ kind: string; title: string; createdAt: number }>;
      };

      expect(res.status).toBe(200);
      expect(body.task).toMatchObject({ id: "task-1", status: "completed" });
      expect(body.episode?.task_id).toBe("task-1");
      expect(body.current).toMatchObject({
        progressStatus: "completed",
        progressMessage: "任务已完成",
        currentToolName: "read_file",
      });
      expect(body.timeline.map((item) => item.title)).toEqual(expect.arrayContaining([
        "任务开始",
        "任务进度",
        "工具调用",
        "工具结果",
        "任务完成",
        "经历记录创建",
      ]));
      expect(body.timeline.map((item) => item.createdAt)).toEqual(
        [...body.timeline.map((item) => item.createdAt)].sort((a, b) => a - b),
      );
    });
  });

  test("GET /runtime/tasks/:id/timeline returns plan, dependencies, and children", async () => {
    await withRuntimeApp(async (app, db) => {
      createTask({ id: "parent", source_channel: "web", input: "parent", created_at: 100 }, db);
      createTask({ id: "blocker", source_channel: "web", input: "blocker", created_at: 101 }, db);
      const [step] = setTaskPlan("parent", [{ title: "子任务", detail: "由 child 完成" }], db);
      createTask({
        id: "child",
        parent_task_id: "parent",
        plan_step_id: step.id,
        source_channel: "delegation",
        input: "child",
        created_at: 102,
      }, db);
      addTaskDependency("parent", "blocker", "等待 blocker", db);

      const res = await app.request("/runtime/tasks/parent/timeline");
      const body = await res.json() as {
        plan: { steps: Array<{ title: string; child_task_id: string | null }> };
        dependencies: Array<{ depends_on_task_id: string; reason: string }>;
        children: Array<{ id: string }>;
      };

      expect(res.status).toBe(200);
      expect(body.plan.steps).toEqual([
        expect.objectContaining({ title: "子任务", child_task_id: "child" }),
      ]);
      expect(body.dependencies).toEqual([
        expect.objectContaining({ depends_on_task_id: "blocker", reason: "等待 blocker" }),
      ]);
      expect(body.children).toEqual([expect.objectContaining({ id: "child" })]);
    });
  });

  test("task plan routes read and replace plans", async () => {
    await withRuntimeApp(async (app, db) => {
      createTask({ id: "task-1", source_channel: "web", input: "hello" }, db);

      const putRes = await app.request("/runtime/tasks/task-1/plan", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          steps: [
            { title: "读取上下文", detail: "read" },
            { title: "实现", detail: "" },
          ],
        }),
      });
      const getRes = await app.request("/runtime/tasks/task-1/plan");
      const body = await getRes.json() as { steps: Array<{ title: string; step_index: number }> };

      expect(putRes.status).toBe(200);
      expect(getRes.status).toBe(200);
      expect(body.steps.map((step) => [step.step_index, step.title])).toEqual([
        [0, "读取上下文"],
        [1, "实现"],
      ]);
    });
  });

  test("PUT /runtime/tasks/:id/plan rejects replacing a plan with child tasks", async () => {
    await withRuntimeApp(async (app, db) => {
      createTask({ id: "parent", source_channel: "web", input: "parent" }, db);
      const [step] = setTaskPlan("parent", [{ title: "child", detail: "" }], db);
      createTask({
        id: "child",
        parent_task_id: "parent",
        plan_step_id: step.id,
        source_channel: "delegation",
        input: "child",
      }, db);

      const res = await app.request("/runtime/tasks/parent/plan", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ steps: [{ title: "新计划" }] }),
      });
      const body = await res.json() as { error: string };

      expect(res.status).toBe(409);
      expect(body.error).toBe("已有步骤关联子任务，不能直接覆盖计划。");
    });
  });

  test("dependency routes add and remove dependencies", async () => {
    await withRuntimeApp(async (app, db) => {
      createTask({ id: "task-1", source_channel: "web", input: "hello" }, db);
      createTask({ id: "blocker", source_channel: "web", input: "blocker" }, db);

      const addRes = await app.request("/runtime/tasks/task-1/dependencies", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dependsOnTaskId: "blocker", reason: "等待 blocker" }),
      });
      const addBody = await addRes.json() as { dependency: { depends_on_task_id: string } };

      const deleteRes = await app.request("/runtime/tasks/task-1/dependencies/blocker", { method: "DELETE" });

      expect(addRes.status).toBe(200);
      expect(addBody.dependency.depends_on_task_id).toBe("blocker");
      expect(deleteRes.status).toBe(200);
    });
  });

  test("dependency route returns 409 for invalid dependencies", async () => {
    await withRuntimeApp(async (app, db) => {
      createTask({ id: "task-1", source_channel: "web", input: "hello" }, db);

      const res = await app.request("/runtime/tasks/task-1/dependencies", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dependsOnTaskId: "task-1" }),
      });
      const body = await res.json() as { error: string };

      expect(res.status).toBe(409);
      expect(body.error).toBe("任务不能依赖自己。");
    });
  });

  test("GET /runtime/tasks/:id/timeline returns 404 for missing task", async () => {
    await withRuntimeApp(async (app) => {
      const res = await app.request("/runtime/tasks/missing-task/timeline");
      const body = await res.json() as { error: string };

      expect(res.status).toBe(404);
      expect(body.error).toBe("任务不存在。");
    });
  });

  test("GET /runtime/events returns agent events", async () => {
    await withRuntimeApp(async (app, db) => {
      appendEvent({ id: "event-1", type: "user.message", payload: { text: "hello" } }, db);

      const res = await app.request("/runtime/events?agentId=default");
      const body = await res.json() as { events: Array<{ id: string }> };

      expect(res.status).toBe(200);
      expect(body.events.map((event) => event.id)).toEqual(["event-1"]);
    });
  });

  test("GET /runtime/tasks/:id/events returns task timeline", async () => {
    await withRuntimeApp(async (app, db) => {
      createTask({ id: "task-1", source_channel: "web", input: "hello" }, db);
      appendEvent({ id: "event-1", task_id: "task-1", type: "task.started" }, db);

      const res = await app.request("/runtime/tasks/task-1/events");
      const body = await res.json() as { events: Array<{ id: string }> };

      expect(res.status).toBe(200);
      expect(body.events.map((event) => event.id)).toEqual(["event-1"]);
    });
  });

  test("POST /runtime/tasks/:id/retry retries failed task", async () => {
    await withRuntimeApp(async (app, db) => {
      createTask({ id: "task-1", source_channel: "web", input: "hello" }, db);
      claimTask("task-1", db);
      markTaskFailed("task-1", "boom", db);

      const res = await app.request("/runtime/tasks/task-1/retry", { method: "POST" });
      const body = await res.json() as { task: { id: string; status: string } };

      expect(res.status).toBe(200);
      expect(body.task).toMatchObject({
        id: "task-1",
        status: "queued",
      });
    });
  });

  test("POST /runtime/tasks/:id/retry returns 409 for completed task", async () => {
    await withRuntimeApp(async (app, db) => {
      createTask({ id: "task-1", source_channel: "web", input: "hello" }, db);
      claimTask("task-1", db);
      markTaskCompleted("task-1", "done", db);

      const res = await app.request("/runtime/tasks/task-1/retry", { method: "POST" });
      const body = await res.json() as { error: string };

      expect(res.status).toBe(409);
      expect(body.error).toBe("任务已完成，不能重试。");
    });
  });

  test("POST /runtime/tasks/:id/cancel cancels queued task", async () => {
    await withRuntimeApp(async (app, db) => {
      createTask({ id: "task-1", source_channel: "web", input: "hello" }, db);

      const res = await app.request("/runtime/tasks/task-1/cancel", { method: "POST" });
      const body = await res.json() as { task: { id: string; status: string } };

      expect(res.status).toBe(200);
      expect(body.task).toMatchObject({
        id: "task-1",
        status: "canceled",
      });
      expect(getTask("task-1", db)?.status).toBe("canceled");
    });
  });

  test("POST /runtime/tasks/:id/cancel releases running agent", async () => {
    await withRuntimeApp(async (app, db) => {
      createTask({ id: "task-1", source_channel: "web", input: "hello" }, db);
      updateAgentStatus("default", "running", "task-1", db);

      const res = await app.request("/runtime/tasks/task-1/cancel", { method: "POST" });
      const agentRes = await app.request("/runtime/agents/default");
      const agent = await agentRes.json();

      expect(res.status).toBe(200);
      expect(agent).toMatchObject({
        status: "idle",
        current_task_id: null,
      });
    });
  });

  test("POST /runtime/tasks/:id/cancel returns 409 for completed task", async () => {
    await withRuntimeApp(async (app, db) => {
      createTask({ id: "task-1", source_channel: "web", input: "hello" }, db);
      claimTask("task-1", db);
      markTaskCompleted("task-1", "done", db);

      const res = await app.request("/runtime/tasks/task-1/cancel", { method: "POST" });
      const body = await res.json() as { error: string };

      expect(res.status).toBe(409);
      expect(body.error).toBe("任务已完成，不能取消。");
      expect(listTaskEvents("task-1", db).map((event) => event.type)).toContain("task.cancel.rejected");
    });
  });

  test("POST /runtime/watchdog/run scans and repairs task state", async () => {
    await withRuntimeApp(async (app, db) => {
      createTask({ id: "stale-web", source_channel: "web", input: "stale", created_at: Date.now() - 120_000 }, db);

      const res = await app.request("/runtime/watchdog/run", { method: "POST" });
      const body = await res.json() as {
        scanned: number;
        canceled: number;
        recovered: number;
        alerted: number;
        repaired: number;
      };

      expect(res.status).toBe(200);
      expect(body).toMatchObject({
        canceled: 1,
        recovered: 0,
        alerted: 0,
        repaired: 0,
      });
      expect(body.scanned).toBeGreaterThanOrEqual(1);
      expect(getTask("stale-web", db)).toMatchObject({
        status: "canceled",
        failure_type: "system_canceled",
      });
    });
  });

  test("POST /runtime/watchdog/run returns zero counts when no task needs repair", async () => {
    await withRuntimeApp(async (app) => {
      const res = await app.request("/runtime/watchdog/run", { method: "POST" });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toEqual({
        scanned: 0,
        canceled: 0,
        recovered: 0,
        alerted: 0,
        repaired: 0,
      });
    });
  });
});
