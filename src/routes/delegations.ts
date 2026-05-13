import type { Database } from "bun:sqlite";
import { Hono } from "hono";
import { getDb } from "../core/database";
import { DelegationService, defaultDelegationService } from "../delegations/service";
import type { DelegationStatus } from "../delegations/types";

function parseStatus(value?: string): DelegationStatus | undefined {
  if (
    value === "queued" ||
    value === "completed" ||
    value === "failed" ||
    value === "canceled"
  ) {
    return value;
  }
  return undefined;
}

export function createDelegationRoutes(
  database: Database = getDb(),
  service: DelegationService = defaultDelegationService,
): Hono {
  const app = new Hono();

  app.get("/", (c) => {
    return c.json({
      delegations: service.listDelegations({
        agentId: c.req.query("agentId"),
        sessionId: c.req.query("sessionId"),
        status: parseStatus(c.req.query("status")),
        limit: Number(c.req.query("limit") ?? 100),
      }),
    });
  });

  app.get("/:id", (c) => {
    const delegation = service.getDelegation(c.req.param("id"));
    if (!delegation) return c.json({ error: "Delegation not found" }, 404);
    return c.json({ delegation });
  });

  app.post("/:id/cancel", (c) => {
    try {
      return c.json({ delegation: service.cancelDelegation(c.req.param("id")) });
    } catch (error) {
      const message = error instanceof Error ? error.message : "取消 delegation 失败";
      return c.json({ error: message }, message.includes("not found") ? 404 : 400);
    }
  });

  void database;
  return app;
}

export default createDelegationRoutes();
