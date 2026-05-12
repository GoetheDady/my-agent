import type { Database } from "bun:sqlite";
import { Hono } from "hono";
import { defaultAgentConfigService, type AgentConfigService } from "../agents/config-service";
import type { AgentConfigPatch } from "../agents/config-types";
import { getAgent } from "../agents/agent-registry";
import { getDb } from "../core/database";

export function createAgentRoutes(service: AgentConfigService = defaultAgentConfigService, database: Database = getDb()): Hono {
  const app = new Hono();

  app.get("/:agentId/config", (c) => {
    const agentId = c.req.param("agentId");
    return c.json({ config: service.getAgentConfig(agentId, { agentId, database }) });
  });

  app.patch("/:agentId/config", async (c) => {
    const agentId = c.req.param("agentId");
    const body = await c.req.json().catch(() => ({})) as { patch?: AgentConfigPatch } & AgentConfigPatch;
    const patch = body.patch ?? body;
    try {
      return c.json({ config: service.patchAgentConfig(agentId, patch, { agentId, database }) });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "配置更新失败" }, 400);
    }
  });

  app.post("/:agentId/config/reset", (c) => {
    const agentId = c.req.param("agentId");
    return c.json(service.resetAgentConfig(agentId, { agentId, database }));
  });

  app.get("/:agentId", (c) => {
    const agentId = c.req.param("agentId");
    const agent = getAgent(agentId, database);
    if (!agent) return c.json({ error: "Agent not found" }, 404);
    return c.json({ agent, config: service.getAgentConfig(agentId, { agentId, database }) });
  });

  return app;
}

export default createAgentRoutes();

