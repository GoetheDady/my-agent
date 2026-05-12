import type { Database } from "bun:sqlite";
import { Hono } from "hono";
import { defaultAgentConfigService, type AgentConfigService } from "../agents/config-service";
import type { AgentConfigPatch } from "../agents/config-types";
import { defaultAgentService, type AgentService } from "../agents/service";
import { getDb } from "../core/database";

export function createAgentRoutes(
  service: AgentConfigService = defaultAgentConfigService,
  database: Database = getDb(),
  agentService: AgentService = defaultAgentService,
): Hono {
  const app = new Hono();

  app.get("/", (c) => {
    return c.json({
      agents: agentService.listAgents({ database }).map((result) => ({
        ...result.agent,
        config: {
          name: result.config.name,
          description: result.config.description,
          model: result.config.model,
          tools: result.config.tools,
          memory: result.config.memory,
          skills: {
            enabled: result.config.skills.enabled,
            indexEnabled: result.config.skills.indexEnabled,
            enabledCount: Object.values(result.config.skills.items).filter((skill) => skill.status === "enabled").length,
            disabledCount: Object.values(result.config.skills.items).filter((skill) => skill.status === "disabled").length,
          },
        },
      })),
    });
  });

  app.post("/", async (c) => {
    const body = await c.req.json().catch(() => ({})) as {
      agentId?: string;
      name?: string;
      description?: string;
      workspacePath?: string;
      model?: { provider?: string; model?: string };
    };
    if (!body.agentId || !body.name) {
      return c.json({ error: "缺少 agentId 或 name" }, 400);
    }
    try {
      return c.json(agentService.createAgent({
        agentId: body.agentId,
        name: body.name,
        description: body.description,
        workspacePath: body.workspacePath,
        model: body.model,
      }, { database }), 201);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "Agent 创建失败" }, 400);
    }
  });

  app.get("/:agentId/config", (c) => {
    const agentId = c.req.param("agentId");
    if (!agentService.getAgent(agentId, { database })) {
      return c.json({ error: "Agent not found" }, 404);
    }
    return c.json({ config: service.getPublicAgentConfig(agentId, { agentId, database }) });
  });

  app.patch("/:agentId/config", async (c) => {
    const agentId = c.req.param("agentId");
    const body = await c.req.json().catch(() => ({})) as { patch?: AgentConfigPatch } & AgentConfigPatch;
    const patch = body.patch ?? body;
    if (!agentService.getAgent(agentId, { database })) {
      return c.json({ error: "Agent not found" }, 404);
    }
    try {
      service.patchAgentConfig(agentId, patch, { agentId, database });
      return c.json({ config: service.getPublicAgentConfig(agentId, { agentId, database }) });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "配置更新失败" }, 400);
    }
  });

  app.post("/:agentId/config/reset", (c) => {
    const agentId = c.req.param("agentId");
    if (!agentService.getAgent(agentId, { database })) {
      return c.json({ error: "Agent not found" }, 404);
    }
    return c.json(service.resetAgentConfig(agentId, { agentId, database }));
  });

  app.patch("/:agentId", async (c) => {
    const agentId = c.req.param("agentId");
    const body = await c.req.json().catch(() => ({})) as {
      name?: string;
      description?: string;
      workspacePath?: string;
    };
    try {
      return c.json(agentService.updateAgent(agentId, {
        name: body.name,
        description: body.description,
        workspacePath: body.workspacePath,
      }, { database }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Agent 更新失败";
      const status = message.includes("not found") ? 404 : 400;
      return c.json({ error: message }, status);
    }
  });

  app.get("/:agentId", (c) => {
    const agentId = c.req.param("agentId");
    const agent = agentService.getAgent(agentId, { database });
    if (!agent) return c.json({ error: "Agent not found" }, 404);
    return c.json(agent);
  });

  return app;
}
