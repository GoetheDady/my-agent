import type { Database } from "bun:sqlite";
import { Hono } from "hono";
import { getDb } from "../core/database";
import { SkillService, defaultSkillService } from "../skills";

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

export default createSkillsRoutes();
