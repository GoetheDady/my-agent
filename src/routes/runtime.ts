import type { Database } from "bun:sqlite";
import { Hono } from "hono";
import { getAgent } from "../agents/agent-registry";
import { getDb } from "../core/database";
import { listAgentEvents } from "../events/event-log";
import { getTask, listTasks, markTaskCanceled } from "../tasks/task-store";
import type { TaskStatus } from "../tasks/task-types";

export function createRuntimeRoutes(database: Database = getDb()): Hono {
  const app = new Hono();

  app.get("/agents/:id", (c) => {
    const agent = getAgent(c.req.param("id"), database);
    if (!agent) return c.json({ error: "Agent not found" }, 404);
    return c.json(agent);
  });

  app.get("/tasks", (c) => {
    const agentId = c.req.query("agentId") ?? "default";
    const statuses = c.req
      .queries("status")
      ?.flatMap((value) => value.split(",").filter(Boolean)) as TaskStatus[] | undefined;
    return c.json({ tasks: listTasks(agentId, statuses, database) });
  });

  app.get("/events", (c) => {
    const agentId = c.req.query("agentId") ?? "default";
    const limit = parseInt(c.req.query("limit") ?? "50", 10);
    return c.json({ events: listAgentEvents(agentId, limit, database) });
  });

  app.post("/tasks/:id/cancel", (c) => {
    const taskId = c.req.param("id");
    const task = getTask(taskId, database);
    if (!task) return c.json({ error: "Task not found" }, 404);

    markTaskCanceled(taskId, database);
    return c.json({ task: getTask(taskId, database) });
  });

  return app;
}
