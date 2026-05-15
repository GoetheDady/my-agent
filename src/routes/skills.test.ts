import { Database } from "bun:sqlite";
import { Hono } from "hono";
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureDefaultAgent } from "../agents/agent-registry";
import { initializeDatabaseSchema } from "../core/database";
import { SkillService } from "../skills";
import { createSkillsRoutes } from "./skills";

function createTempRoot(): string {
  return mkdtempSync(join(tmpdir(), "my-agent-skills-route-"));
}

function withSkillsApp<T>(
  run: (app: Hono, db: Database, service: SkillService) => T | Promise<T>,
  service?: SkillService,
): Promise<T> {
  const db = new Database(":memory:");
  db.run("PRAGMA foreign_keys = ON");
  initializeDatabaseSchema(db);
  ensureDefaultAgent(db);
  const ownedRootDir = service ? null : createTempRoot();
  const skillService = service ?? new SkillService({ rootDir: ownedRootDir ?? undefined });
  const app = new Hono();
  app.route("/skills", createSkillsRoutes(skillService, db));

  return Promise.resolve()
    .then(() => run(app, db, skillService))
    .finally(() => {
      db.close();
      if (ownedRootDir) rmSync(ownedRootDir, { recursive: true, force: true });
    });
}

describe("skills routes", () => {
  test("GET /skills returns the skill list and index", async () => {
    await withSkillsApp(async (app) => {
      const listRes = await app.request("/skills?agentId=default");
      const listBody = await listRes.json() as {
        skills: Array<{ id: string; readonly: boolean; origin: { type: string }; status: string }>;
      };
      expect(listRes.status).toBe(200);
      expect(listBody.skills).toContainEqual(expect.objectContaining({
        id: "skill-creator",
        readonly: true,
        origin: expect.objectContaining({ type: "builtin" }),
        status: "enabled",
      }));

      const indexRes = await app.request("/skills/index?agentId=default");
      const indexBody = await indexRes.json() as { index: string };
      expect(indexRes.status).toBe(200);
      expect(indexBody.index).toContain("skill-creator");
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

  test("POST /skills/install installs a remote skill and update rejects non-remote skills", async () => {
    const rootDir = createTempRoot();
    const remoteDir = createTempRoot();
    const service = new SkillService({
      rootDir,
      remoteSkillFetcher: () => ({ directory: remoteDir, commit: "commit-one", cleanup: () => undefined }),
    });
    try {
      writeFileSync(join(remoteDir, "SKILL.md"), "# Remote Skill\n\nBody.");
      await withSkillsApp(async (app) => {
        const installRes = await app.request("/skills/install", {
          method: "POST",
          body: JSON.stringify({ url: "https://github.com/acme/remote-skill" }),
          headers: { "content-type": "application/json" },
        });
        const installBody = await installRes.json() as { skill: { id: string; status: string; origin: { type: string } } };

        expect(installRes.status).toBe(201);
        expect(installBody.skill).toMatchObject({
          id: "remote-skill",
          status: "disabled",
          origin: { type: "remote_installed" },
        });

        const createRes = await app.request("/skills", {
          method: "POST",
          body: JSON.stringify({
            skillId: "local-skill",
            name: "Local Skill",
            description: "本地",
            content: "# Local Skill",
          }),
          headers: { "content-type": "application/json" },
        });
        expect(createRes.status).toBe(201);

        const updateRes = await app.request("/skills/local-skill/update", { method: "POST" });
        const updateBody = await updateRes.json() as { error: string };
        expect(updateRes.status).toBe(409);
        expect(updateBody.error).toBe("只有远程安装的 skill 可以更新。");
      }, service);
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
      rmSync(remoteDir, { recursive: true, force: true });
    }
  });

  test("POST /skills/install rejects non-GitHub URLs", async () => {
    await withSkillsApp(async (app) => {
      const res = await app.request("/skills/install", {
        method: "POST",
        body: JSON.stringify({ url: "https://example.com/acme/skill" }),
        headers: { "content-type": "application/json" },
      });
      const body = await res.json() as { error: string };

      expect(res.status).toBe(409);
      expect(body.error).toContain("只支持");
    });
  });
});
