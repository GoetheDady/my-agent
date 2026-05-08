import { Database } from "bun:sqlite";
import { Hono } from "hono";
import { describe, expect, test } from "bun:test";
import { ensureDefaultAgent, updateAgentStatus } from "../agents/agent-registry";
import { initializeDatabaseSchema } from "../core/database";
import { appendEvent } from "../events/event-log";
import { createTask, getTask } from "../tasks/task-store";
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

  test("GET /runtime/events returns agent events", async () => {
    await withRuntimeApp(async (app, db) => {
      appendEvent({ id: "event-1", type: "user.message", payload: { text: "hello" } }, db);

      const res = await app.request("/runtime/events?agentId=default");
      const body = await res.json() as { events: Array<{ id: string }> };

      expect(res.status).toBe(200);
      expect(body.events.map((event) => event.id)).toEqual(["event-1"]);
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
});
