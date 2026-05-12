import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureDefaultAgent } from "./agent-registry";
import { AgentConfigService } from "./config-service";
import { createAgentTools } from "./tools";
import { AgentService } from "./service";
import { initializeDatabaseSchema } from "../core/database";

function withAgentTools<T>(run: (tools: ReturnType<typeof createAgentTools>, db: Database) => Promise<T> | T): Promise<T> {
  const rootDir = mkdtempSync(join(tmpdir(), "my-agent-tools-"));
  const db = new Database(":memory:");
  db.run("PRAGMA foreign_keys = ON");
  initializeDatabaseSchema(db);
  ensureDefaultAgent(db);
  const configService = new AgentConfigService({ rootDir });
  const agentService = new AgentService({
    configService,
    profileRootDir: rootDir,
  });
  const tools = createAgentTools({ database: db, agentService });

  return Promise.resolve()
    .then(() => run(tools, db))
    .finally(() => {
      db.close();
      rmSync(rootDir, { recursive: true, force: true });
    });
}

describe("agent tools", () => {
  test("agent_create creates an agent and agent_list can see it", async () => {
    await withAgentTools(async (tools) => {
      const createResult = await tools.agent_create.execute?.({
        agentId: "researcher",
        name: "Researcher",
        description: "资料研究 Agent",
      }, { toolCallId: "tool-call", messages: [] });
      const listResult = await tools.agent_list.execute?.({}, { toolCallId: "tool-call", messages: [] });

      expect(createResult).toMatchObject({
        success: true,
        agent: {
          id: "researcher",
          configSummary: { description: "资料研究 Agent" },
        },
      });
      expect((listResult as { agents: Array<{ id: string }> }).agents.map((agent) => agent.id)).toEqual([
        "default",
        "researcher",
      ]);
    });
  });

  test("agent_get returns not found for missing agent", async () => {
    await withAgentTools(async (tools) => {
      const result = await tools.agent_get.execute?.({
        agentId: "missing",
      }, { toolCallId: "tool-call", messages: [] });

      expect(result).toMatchObject({
        success: false,
        error: "agent_not_found",
        agentId: "missing",
      });
    });
  });
});
