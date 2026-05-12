import { Database } from "bun:sqlite";
import { Hono } from "hono";
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureDefaultAgent } from "../agents/agent-registry";
import { AgentConfigService } from "../agents/config-service";
import { AgentService } from "../agents/service";
import { initializeDatabaseSchema } from "../core/database";
import { createAgentRoutes } from "./agents";

function withAgentApp<T>(run: (app: Hono, db: Database) => T | Promise<T>): Promise<T> {
  const rootDir = mkdtempSync(join(tmpdir(), "my-agent-routes-"));
  const db = new Database(":memory:");
  db.run("PRAGMA foreign_keys = ON");
  initializeDatabaseSchema(db);
  ensureDefaultAgent(db);
  const configService = new AgentConfigService({ rootDir });
  const agentService = new AgentService({
    configService,
    profileRootDir: rootDir,
  });
  const app = new Hono();
  app.route("/agents", createAgentRoutes(configService, db, agentService));

  return Promise.resolve()
    .then(() => run(app, db))
    .finally(() => {
      db.close();
      rmSync(rootDir, { recursive: true, force: true });
    });
}

describe("agent config routes", () => {
  test("GET /agents lists agents with config summary", async () => {
    await withAgentApp(async (app) => {
      const res = await app.request("/agents");
      const body = await res.json() as { agents: Array<{ id: string; config: { skills: { enabledCount: number } } }> };

      expect(res.status).toBe(200);
      expect(body.agents.map((agent) => agent.id)).toEqual(["default"]);
      expect(body.agents[0].config.skills.enabledCount).toBe(0);
    });
  });

  test("POST /agents creates an agent", async () => {
    await withAgentApp(async (app, db) => {
      const res = await app.request("/agents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agentId: "researcher",
          name: "Researcher",
          description: "资料研究 Agent",
          workspacePath: "/tmp/research",
        }),
      });
      const body = await res.json() as { agent: { id: string; workspace_path: string }; config: { description: string } };

      expect(res.status).toBe(201);
      expect(body.agent.id).toBe("researcher");
      expect(body.agent.workspace_path).toBe("/tmp/research");
      expect(body.config.description).toBe("资料研究 Agent");
      expect(db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM agents WHERE id = 'researcher'").get()?.count).toBe(1);
    });
  });

  test("PATCH /agents/:id updates agent metadata", async () => {
    await withAgentApp(async (app) => {
      await app.request("/agents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agentId: "researcher", name: "Researcher" }),
      });

      const res = await app.request("/agents/researcher", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Research Agent", workspacePath: "/tmp/new" }),
      });
      const body = await res.json() as { agent: { name: string; workspace_path: string } };

      expect(res.status).toBe(200);
      expect(body.agent.name).toBe("Research Agent");
      expect(body.agent.workspace_path).toBe("/tmp/new");
    });
  });

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
