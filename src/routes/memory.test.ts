import { Database } from "bun:sqlite";
import { Hono } from "hono";
import { describe, expect, test } from "bun:test";
import { ensureDefaultAgent } from "../agents/agent-registry";
import { initializeDatabaseSchema } from "../core/database";
import { upsertEpisodeForTask } from "../memory/episode-store";
import { createTask, markTaskFailed, markTaskRunning } from "../tasks/task-store";
import { createMemoryRoutes } from "./memory";

function withMemoryApp<T>(run: (app: Hono, db: Database) => T | Promise<T>): Promise<T> {
  const db = new Database(":memory:");
  db.run("PRAGMA foreign_keys = ON");
  initializeDatabaseSchema(db);
  ensureDefaultAgent(db);
  const app = new Hono();
  app.route("/memory", createMemoryRoutes(db));

  return Promise.resolve()
    .then(() => run(app, db))
    .finally(() => db.close());
}

describe("memory routes", () => {
  test("episode endpoints return task outcome fields and support filters", async () => {
    await withMemoryApp(async (app, db) => {
      const task = createTask({
        id: "task-failed",
        source_channel: "web",
        input: "检查模型调用失败",
      }, db);
      markTaskRunning(task.id, db);
      markTaskFailed(task.id, "model down", {
        failure_type: "model_error",
        failure_stage: "model_call",
        retriable: true,
      }, db);
      const episode = upsertEpisodeForTask(task.id, db);

      const listRes = await app.request("/memory/episodes?agentId=default&status=failed&failureType=model_error");
      const listBody = await listRes.json() as { episodes: Array<{ id: string; task_status: string; failure_type: string }> };
      expect(listRes.status).toBe(200);
      expect(listBody.episodes).toEqual([
        expect.objectContaining({
          id: episode?.id,
          task_status: "failed",
          failure_type: "model_error",
        }),
      ]);

      const byTaskRes = await app.request("/memory/episodes/by-task/task-failed");
      const byTaskBody = await byTaskRes.json() as { episode: { id: string; task_id: string; retriable: boolean } };
      expect(byTaskRes.status).toBe(200);
      expect(byTaskBody.episode).toMatchObject({
        id: episode?.id,
        task_id: task.id,
        retriable: true,
      });

      const byIdRes = await app.request(`/memory/episodes/${episode?.id}`);
      const byIdBody = await byIdRes.json() as { episode: { id: string; failure_stage: string } };
      expect(byIdRes.status).toBe(200);
      expect(byIdBody.episode).toMatchObject({
        id: episode?.id,
        failure_stage: "model_call",
      });
    });
  });
});
