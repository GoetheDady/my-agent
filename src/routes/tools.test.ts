import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { ensureDefaultAgent } from "../agents/agent-registry";
import { AgentConfigService } from "../agents/config-service";
import { initializeDatabaseSchema } from "../core/database";
import { appendMessage, createSession } from "../sessions/service";
import { ApprovalService } from "../tools/approval-service";
import { createToolRoutes } from "./tools";
import "../tools/service";

function createFixture() {
  const db = new Database(":memory:");
  db.run("PRAGMA foreign_keys = ON");
  initializeDatabaseSchema(db);
  ensureDefaultAgent(db);
  const configService = new AgentConfigService({
    rootDir: `/tmp/my-agent-tools-route-${crypto.randomUUID()}`,
  });
  const approvalService = new ApprovalService(db, configService);
  const app = createToolRoutes({
    database: db,
    agentConfigService: configService,
    approvalService,
  });
  return { app, db, configService, approvalService };
}

describe("tool routes", () => {
  test("GET /tools returns policy summary for an agent", async () => {
    const { app, db } = createFixture();
    try {
      const response = await app.request("/?agentId=default");
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.config.enabledToolsets).toContain("file");
      expect(body.tools.some((tool: { name: string }) => tool.name === "write_file")).toBe(true);
    } finally {
      db.close();
    }
  });

  test("approval endpoints create and resolve approvals", async () => {
    const { app, db } = createFixture();
    try {
      const createResponse = await app.request("/approvals", {
        method: "POST",
        body: JSON.stringify({
          agentId: "default",
          toolCallId: "call_route",
          toolName: "write_file",
          args: { path: "README.md", mode: "append" },
        }),
      });
      const created = await createResponse.json();
      const approveResponse = await app.request(`/approvals/${created.approval.id}/approve`, {
        method: "POST",
        body: JSON.stringify({ rememberChoice: true }),
      });
      const approved = await approveResponse.json();

      expect(createResponse.status).toBe(201);
      expect(approveResponse.status).toBe(200);
      expect(approved.approval.status).toBe("approved");
    } finally {
      db.close();
    }
  });

  test("PATCH /config updates agent tool policy", async () => {
    const { app, db, configService } = createFixture();
    try {
      const response = await app.request("/config/default", {
        method: "PATCH",
        body: JSON.stringify({
          removeEnabledToolsets: ["file"],
          addRequiresApproval: ["skill_enable"],
          addAllowedPaths: ["README.md"],
        }),
      });
      const body = await response.json();
      const config = configService.getAgentConfig("default", { database: db });

      expect(response.status).toBe(200);
      expect(body.config.enabledToolsets).not.toContain("file");
      expect(config.tools.requiresApproval).toContain("skill_enable");
      expect(config.tools.allowedPaths).toContain("README.md");
    } finally {
      db.close();
    }
  });

  test("legacy whitelist route writes allowed path to agent config", async () => {
    const { app, db, configService } = createFixture();
    try {
      const session = createSession({ agentId: "default" }, db);
      appendMessage(session.id, "assistant", JSON.stringify([{
        type: "tool-write_file",
        toolCallId: "call_whitelist",
        toolName: "write_file",
        input: { path: "README.md", mode: "append" },
      }]), db);
      const response = await app.request("/whitelist", {
        method: "POST",
        body: JSON.stringify({ sessionId: session.id, toolCallId: "call_whitelist" }),
      });
      const config = configService.getAgentConfig("default", { database: db });

      expect(response.status).toBe(200);
      expect(config.tools.allowedPaths.some((path) => path.endsWith("README.md"))).toBe(true);
    } finally {
      db.close();
    }
  });
});
