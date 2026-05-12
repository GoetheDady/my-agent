import { Database } from "bun:sqlite";
import { Hono } from "hono";
import { describe, expect, test } from "bun:test";
import { ensureDefaultAgent } from "../agents/agent-registry";
import { initializeDatabaseSchema } from "../core/database";
import { SkillService } from "../skills";
import { createSkillsRoutes } from "./skills";

function withSkillsApp<T>(run: (app: Hono, db: Database) => T | Promise<T>): Promise<T> {
  const db = new Database(":memory:");
  db.run("PRAGMA foreign_keys = ON");
  initializeDatabaseSchema(db);
  ensureDefaultAgent(db);
  const service = new SkillService({ rootDir: `/tmp/my-agent-skills-${Date.now()}` });
  const app = new Hono();
  app.route("/skills", createSkillsRoutes(service, db));

  return Promise.resolve()
    .then(() => run(app, db))
    .finally(() => db.close());
}

describe("skills routes", () => {
  test("GET /skills returns the skill list and index", async () => {
    await withSkillsApp(async (app) => {
      const listRes = await app.request("/skills?agentId=default");
      const listBody = await listRes.json() as { skills: Array<{ id: string }> };
      expect(listRes.status).toBe(200);
      expect(listBody.skills).toEqual([]);

      const indexRes = await app.request("/skills/index?agentId=default");
      const indexBody = await indexRes.json() as { index: string };
      expect(indexRes.status).toBe(200);
      expect(indexBody.index).toBe("");
    });
  });

  test("POST /skills creates a skill and GET /skills/:id returns it", async () => {
    await withSkillsApp(async (app) => {
      const createRes = await app.request("/skills", {
        method: "POST",
        body: JSON.stringify({
          skillId: "web-debug",
          name: "Web Debug",
          description: "调试网页",
          content: "# Web Debug\n\nUse browser tools.",
        }),
        headers: { "content-type": "application/json" },
      });
      expect(createRes.status).toBe(201);

      const viewRes = await app.request("/skills/web-debug?agentId=default");
      const viewBody = await viewRes.json() as { skill: { id: string }; content: string };
      expect(viewRes.status).toBe(200);
      expect(viewBody.skill.id).toBe("web-debug");
      expect(viewBody.content).toContain("Use browser tools");
    });
  });
});
