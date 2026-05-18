import type { Database } from "bun:sqlite";
import { Hono } from "hono";
import { getDb } from "../core/database";
import { SkillService, defaultSkillService } from "../skills";
import {
  getSkillCandidate,
  listSkillCandidates,
  markSkillCandidateAccepted,
  markSkillCandidateRejected,
} from "../skills/candidate-store";

export function createSkillsRoutes(service: SkillService = defaultSkillService, database: Database = getDb()): Hono {
  const app = new Hono();

  app.get("/", (c) => {
    const agentId = c.req.query("agentId") ?? "default";
    const status = c.req.query("status");
    const result = service.listSkills(
      { agentId, database },
      status === "enabled" || status === "disabled" ? status : "all",
    );
    return c.json(result);
  });

  app.get("/index", (c) => {
    const agentId = c.req.query("agentId") ?? "default";
    return c.json({
      agentId,
      index: service.buildSkillIndex(agentId),
    });
  });

  app.get("/candidates", (c) => {
    const agentId = c.req.query("agentId") ?? "default";
    const status = c.req.query("status");
    return c.json({
      candidates: listSkillCandidates({
        agentId,
        status: status === "accepted" || status === "rejected" || status === "pending" ? status : "pending",
      }, database),
    });
  });

  app.post("/candidates/:id/accept", async (c) => {
    const body = await c.req.json().catch(() => ({})) as {
      agentId?: string;
      skillId?: string;
      note?: string;
      status?: "enabled" | "disabled";
    };
    const candidate = getSkillCandidate(c.req.param("id"), database);
    if (!candidate) return c.json({ error: "Skill candidate 不存在" }, 404);
    if (candidate.status !== "pending") return c.json({ error: "Skill candidate 已审查" }, 409);
    const skillId = normalizeSkillId(body.skillId ?? candidate.name);
    try {
      const skill = service.createSkill({
        skillId,
        name: candidate.name,
        description: candidate.description,
        category: candidate.category,
        content: candidate.content,
        status: body.status ?? "enabled",
      }, { agentId: body.agentId ?? candidate.agent_id, database });
      const reviewed = markSkillCandidateAccepted(candidate.id, { note: body.note, skillId: skill.id }, database);
      return c.json({ candidate: reviewed, skill });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 409);
    }
  });

  app.post("/candidates/:id/reject", async (c) => {
    const body = await c.req.json().catch(() => ({})) as { note?: string };
    const candidate = getSkillCandidate(c.req.param("id"), database);
    if (!candidate) return c.json({ error: "Skill candidate 不存在" }, 404);
    if (candidate.status !== "pending") return c.json({ error: "Skill candidate 已审查" }, 409);
    return c.json({ candidate: markSkillCandidateRejected(candidate.id, body.note ?? "", database) });
  });

  app.get("/:skillId", (c) => {
    const agentId = c.req.query("agentId") ?? "default";
    const filePath = c.req.query("filePath") ?? undefined;
    const result = service.viewSkill(c.req.param("skillId"), { agentId, database }, { filePath, allowDisabled: true });
    if (result.error === "skill_not_found") return c.json({ error: "skill 不存在" }, 404);
    if (result.error === "file_not_found") return c.json({ error: "skill 文件不存在" }, 404);
    return c.json(result);
  });

  app.post("/", async (c) => {
    const body = await c.req.json().catch(() => ({})) as {
      agentId?: string;
      skillId?: string;
      name?: string;
      description?: string;
      content?: string;
      category?: string;
      allowedTools?: string[];
    };
    if (!body.skillId || !body.name || !body.description || !body.content) {
      return c.json({ error: "缺少 skillId / name / description / content" }, 400);
    }
    try {
      const skill = service.createSkill({
        skillId: body.skillId,
        name: body.name,
        description: body.description,
        content: body.content,
        category: body.category,
        allowedTools: body.allowedTools,
        status: "enabled",
      }, { agentId: body.agentId ?? "default", database });
      return c.json({ skill }, 201);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 409);
    }
  });

  app.post("/install", async (c) => {
    const body = await c.req.json().catch(() => ({})) as {
      agentId?: string;
      url?: string;
      skillId?: string;
      branch?: string;
      subdir?: string;
      status?: "enabled" | "disabled";
    };
    if (!body.url) return c.json({ error: "缺少 url" }, 400);
    try {
      return c.json(await service.installSkill({
        url: body.url,
        skillId: body.skillId,
        branch: body.branch,
        subdir: body.subdir,
        status: body.status,
      }, { agentId: body.agentId ?? "default", database }), 201);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 409);
    }
  });

  app.post("/:skillId", async (c) => {
    const body = await c.req.json().catch(() => ({})) as {
      agentId?: string;
      name?: string;
      description?: string;
      content?: string;
      category?: string;
      allowedTools?: string[];
      status?: "enabled" | "disabled";
    };
    try {
      const skill = service.createSkill({
        skillId: c.req.param("skillId"),
        name: body.name ?? c.req.param("skillId"),
        description: body.description ?? "",
        content: body.content ?? "",
        category: body.category,
        allowedTools: body.allowedTools,
        status: body.status,
      }, { agentId: body.agentId ?? "default", database });
      return c.json({ skill });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 409);
    }
  });

  app.post("/:skillId/update", async (c) => {
    const body = await c.req.json().catch(() => ({})) as { agentId?: string };
    try {
      return c.json(await service.updateSkill(c.req.param("skillId"), {
        agentId: body.agentId ?? "default",
        database,
      }));
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 409);
    }
  });

  app.post("/:skillId/enable", async (c) => {
    const body = await c.req.json().catch(() => ({})) as { agentId?: string };
    const result = service.enableSkill(c.req.param("skillId"), { agentId: body.agentId ?? "default", database });
    if (!result.skill) return c.json({ error: "skill 不存在" }, 404);
    return c.json(result);
  });

  app.post("/:skillId/disable", async (c) => {
    const body = await c.req.json().catch(() => ({})) as { agentId?: string };
    const result = service.disableSkill(c.req.param("skillId"), { agentId: body.agentId ?? "default", database });
    if (!result.skill) return c.json({ error: "skill 不存在" }, 404);
    return c.json(result);
  });

  return app;
}

function normalizeSkillId(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "");
  return normalized.length > 0 ? normalized : "skill";
}

export default createSkillsRoutes();
