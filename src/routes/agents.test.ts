import { Database } from "bun:sqlite";
import { Hono } from "hono";
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureDefaultAgent } from "../agents/agent-registry";
import { AgentConfigService } from "../agents/config-service";
import { initializeDatabaseSchema } from "../core/database";
import { createAgentRoutes } from "./agents";

function withAgentApp<T>(run: (app: Hono, db: Database) => T | Promise<T>): Promise<T> {
  const rootDir = mkdtempSync(join(tmpdir(), "my-agent-routes-"));
  const db = new Database(":memory:");
  db.run("PRAGMA foreign_keys = ON");
  initializeDatabaseSchema(db);
  ensureDefaultAgent(db);
  const app = new Hono();
  app.route("/agents", createAgentRoutes(new AgentConfigService({ rootDir }), db));

  return Promise.resolve()
    .then(() => run(app, db))
    .finally(() => {
      db.close();
      rmSync(rootDir, { recursive: true, force: true });
    });
}

describe("agent config routes", () => {
  test("GET /agents/:id/config returns config", async () => {
    await withAgentApp(async (app) => {
      const res = await app.request("/agents/default/config");
      const body = await res.json() as { config: { agentId: string; model: Record<string, unknown> } };

      expect(res.status).toBe(200);
      expect(body.config.agentId).toBe("default");
      expect(body.config.model).not.toHaveProperty("temperature");
    });
  });

  test("PATCH /agents/:id/config updates allowed fields", async () => {
    await withAgentApp(async (app) => {
      const res = await app.request("/agents/default/config", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ patch: { name: "Config Agent" } }),
      });
      const body = await res.json() as { config: { name: string } };

      expect(res.status).toBe(200);
      expect(body.config.name).toBe("Config Agent");
    });
  });

  test("POST /agents/:id/config/reset restores defaults", async () => {
    await withAgentApp(async (app) => {
      await app.request("/agents/default/config", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ patch: { name: "Changed" } }),
      });

      const res = await app.request("/agents/default/config/reset", { method: "POST" });
      const body = await res.json() as { config: { name: string } };

      expect(res.status).toBe(200);
      expect(body.config.name).toBe("Default Agent");
    });
  });
});
