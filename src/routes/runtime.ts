import type { Database } from "bun:sqlite";
import { Hono } from "hono";
import { getAgent } from "../agents/agent-registry";
import { getDb } from "../core/database";
import { listAgentEvents, listTaskEvents } from "../events/event-log";
import { finalizeEpisodeForTask } from "../memory/episode-store";
import { getTaskTimeline } from "../runtime/task-timeline";
import { getTask, listTasks, markTaskCanceled, retryTask } from "../tasks/task-store";
import {
  addTaskDependency,
  listTaskDependencies,
  listTaskSteps,
  removeTaskDependency,
  setTaskPlan,
  type TaskPlanStepInput,
} from "../tasks/task-plan-store";
import type { TaskStatus } from "../tasks/task-types";
import { runTaskWatchdogOnce } from "../tasks/watchdog";

/**
 * 创建 Runtime 观察与控制路由。
 *
 * 这个路由只负责查看 Agent、任务和事件，以及取消任务；
 * 不直接执行业务逻辑。
 *
 * @param database 可选数据库连接。
 * @returns Hono 路由实例。
 */
export function createRuntimeRoutes(database: Database = getDb()): Hono {
  const app = new Hono();

  /**
   * Runtime API 只负责“观察和控制当前执行状态”：
   * - agents/:id 返回 Agent 状态。
   * - tasks 返回队列/历史任务。
   * - events 返回最近事件流。
   * - cancel 取消 queued/running task。
   *
   * 它不直接执行业务逻辑，业务动作仍由 chat/channel/task queue 驱动。
   */

  app.get("/agents/:id", (c) => {
    const agent = getAgent(c.req.param("id"), database);
    if (!agent) return c.json({ error: "Agent 不存在。" }, 404);
    return c.json(agent);
  });

  app.get("/tasks", (c) => {
    const agentId = c.req.query("agentId") ?? "default";
    const statuses = c.req
      .queries("status")
      ?.flatMap((value) => value.split(",").filter(Boolean)) as TaskStatus[] | undefined;
    return c.json({ tasks: listTasks(agentId, statuses, database) });
  });

  app.get("/tasks/:id", (c) => {
    const task = getTask(c.req.param("id"), database);
    if (!task) return c.json({ error: "任务不存在。" }, 404);
    return c.json({ task });
  });

  app.get("/tasks/:id/timeline", (c) => {
    const timeline = getTaskTimeline(c.req.param("id"), database);
    if (!timeline) return c.json({ error: "任务不存在。" }, 404);
    return c.json(timeline);
  });

  app.get("/tasks/:id/events", (c) => {
    const taskId = c.req.param("id");
    const task = getTask(taskId, database);
    if (!task) return c.json({ error: "任务不存在。" }, 404);
    return c.json({ events: listTaskEvents(taskId, database) });
  });

  app.get("/tasks/:id/plan", (c) => {
    const taskId = c.req.param("id");
    const task = getTask(taskId, database);
    if (!task) return c.json({ error: "任务不存在。" }, 404);
    return c.json({
      steps: listTaskSteps(taskId, database),
      dependencies: listTaskDependencies(taskId, database),
    });
  });

  app.put("/tasks/:id/plan", async (c) => {
    const taskId = c.req.param("id");
    const task = getTask(taskId, database);
    if (!task) return c.json({ error: "任务不存在。" }, 404);
    const body = await readJsonObject(c.req.raw);
    const steps = Array.isArray(body.steps)
      ? body.steps.map(toTaskPlanStepInput)
      : [];
    try {
      return c.json({ steps: setTaskPlan(taskId, steps, database) });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 409);
    }
  });

  app.post("/tasks/:id/dependencies", async (c) => {
    const taskId = c.req.param("id");
    const task = getTask(taskId, database);
    if (!task) return c.json({ error: "任务不存在。" }, 404);
    const body = await readJsonObject(c.req.raw);
    const dependsOnTaskId = typeof body.dependsOnTaskId === "string"
      ? body.dependsOnTaskId
      : "";
    const reason = typeof body.reason === "string" ? body.reason : "";
    try {
      return c.json({ dependency: addTaskDependency(taskId, dependsOnTaskId, reason, database) });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 409);
    }
  });

  app.delete("/tasks/:id/dependencies/:dependsOnTaskId", (c) => {
    const taskId = c.req.param("id");
    const task = getTask(taskId, database);
    if (!task) return c.json({ error: "任务不存在。" }, 404);
    return c.json({
      removed: removeTaskDependency(taskId, c.req.param("dependsOnTaskId"), database),
    });
  });

  app.get("/events", (c) => {
    const agentId = c.req.query("agentId") ?? "default";
    const limit = parseInt(c.req.query("limit") ?? "50", 10);
    return c.json({ events: listAgentEvents(agentId, limit, database) });
  });

  app.get("/events/skills", (c) => {
    const agentId = c.req.query("agentId") ?? "default";
    const limit = parseInt(c.req.query("limit") ?? "50", 10);
    return c.json({
      events: listAgentEvents(agentId, limit, database).filter((event) => event.type.startsWith("skill.")),
    });
  });

  app.post("/watchdog/run", (c) => {
    return c.json(runTaskWatchdogOnce(database));
  });

  app.post("/tasks/:id/retry", async (c) => {
    const taskId = c.req.param("id");
    const task = getTask(taskId, database);
    if (!task) return c.json({ error: "任务不存在。" }, 404);

    const body = await readJsonBody(c.req.raw);
    try {
      return c.json({
        task: retryTask(taskId, { force: body.force === true }, database),
      });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 409);
    }
  });

  app.post("/tasks/:id/cancel", (c) => {
    const taskId = c.req.param("id");
    const task = getTask(taskId, database);
    if (!task) return c.json({ error: "任务不存在。" }, 404);

    // cancel 是控制台操作：释放 task/agent 状态，但不会删除已经保存的事件。
    try {
      markTaskCanceled(taskId, { failureType: "user_canceled", requestedBy: "runtime_api" }, database);
      finalizeEpisodeForTask(taskId, database);
      return c.json({ task: getTask(taskId, database) });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 409);
    }
  });

  return app;
}

async function readJsonBody(request: Request): Promise<{ force?: boolean }> {
  try {
    return await request.json() as { force?: boolean };
  } catch {
    return {};
  }
}

async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  try {
    const parsed = await request.json() as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function toTaskPlanStepInput(value: unknown): TaskPlanStepInput {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return {
    title: typeof record.title === "string" ? record.title : "",
    detail: typeof record.detail === "string" ? record.detail : "",
  };
}
