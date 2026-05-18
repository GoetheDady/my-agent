import { Database } from "bun:sqlite";
import { Hono } from "hono";
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureDefaultAgent } from "../agents/agent-registry";
import { initializeDatabaseSchema } from "../core/database";
import { createSkillCandidate } from "../skills/candidate-store";
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

  test("remote skill install stores content hash and update emits content change", async () => {
    const rootDir = createTempRoot();
    const firstRemoteDir = createTempRoot();
    const secondRemoteDir = createTempRoot();
    let fetchCount = 0;
    const service = new SkillService({
      rootDir,
      remoteSkillFetcher: () => {
        fetchCount += 1;
        return fetchCount === 1
          ? { directory: firstRemoteDir, commit: "commit-one", cleanup: () => undefined }
          : { directory: secondRemoteDir, commit: "commit-two", cleanup: () => undefined };
      },
    });
    try {
      writeFileSync(join(firstRemoteDir, "SKILL.md"), "# Remote Skill\n\nBody one.");
      writeFileSync(join(secondRemoteDir, "SKILL.md"), "# Remote Skill\n\nBody two.");
      await withSkillsApp(async (app, db) => {
        const installRes = await app.request("/skills/install", {
          method: "POST",
          body: JSON.stringify({ url: "https://github.com/acme/remote-skill" }),
          headers: { "content-type": "application/json" },
        });
        const installBody = await installRes.json() as { skill: { origin: { contentHash?: string } } };
        expect(installRes.status).toBe(201);
        expect(installBody.skill.origin.contentHash).toMatch(/^[a-f0-9]{64}$/);

        const updateRes = await app.request("/skills/remote-skill/update", { method: "POST" });
        const updateBody = await updateRes.json() as { skill: { origin: { contentHash?: string } }; changed: boolean };
        expect(updateRes.status).toBe(200);
        expect(updateBody.changed).toBe(true);
        expect(updateBody.skill.origin.contentHash).toMatch(/^[a-f0-9]{64}$/);
        expect(updateBody.skill.origin.contentHash).not.toBe(installBody.skill.origin.contentHash);
        const events = db.query<{ type: string }, []>("SELECT type FROM events ORDER BY created_at ASC").all();
        expect(events.map((event) => event.type)).toContain("skill.content.changed");
      }, service);
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
      rmSync(firstRemoteDir, { recursive: true, force: true });
      rmSync(secondRemoteDir, { recursive: true, force: true });
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

  test("skill candidate routes list, accept, and reject candidates", async () => {
    await withSkillsApp(async (app, db) => {
      const accepted = createSkillCandidate({
        name: "Debug Flow",
        description: "可复用调试流程",
        category: "engineering",
        content: "# Debug Flow\n\nSteps.",
        sourceEpisodeIds: ["episode-1"],
      }, db);
      const rejected = createSkillCandidate({
        name: "Noisy Flow",
        description: "不稳定流程",
        content: "# Noisy Flow",
      }, db);

      const listRes = await app.request("/skills/candidates?agentId=default");
      const listBody = await listRes.json() as { candidates: Array<{ id: string }> };
      expect(listRes.status).toBe(200);
      expect(listBody.candidates.map((candidate) => candidate.id)).toEqual([rejected.id, accepted.id]);

      const acceptRes = await app.request(`/skills/candidates/${accepted.id}/accept`, {
        method: "POST",
        body: JSON.stringify({ skillId: "debug-flow" }),
        headers: { "content-type": "application/json" },
      });
      const acceptBody = await acceptRes.json() as { candidate: { status: string }; skill: { id: string } };
      expect(acceptRes.status).toBe(200);
      expect(acceptBody.candidate.status).toBe("accepted");
      expect(acceptBody.skill.id).toBe("debug-flow");

      const rejectRes = await app.request(`/skills/candidates/${rejected.id}/reject`, {
        method: "POST",
        body: JSON.stringify({ note: "太噪音" }),
        headers: { "content-type": "application/json" },
      });
      const rejectBody = await rejectRes.json() as { candidate: { status: string; review_note: string } };
      expect(rejectRes.status).toBe(200);
      expect(rejectBody.candidate).toMatchObject({ status: "rejected", review_note: "太噪音" });
    });
  });
});
