import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureDefaultAgent } from "./agent-registry";
import { AgentConfigService } from "./config-service";
import { AgentService } from "./service";
import { initializeDatabaseSchema } from "../core/database";
import { listAgentEvents } from "../events/event-log";

function createAgentDb(): Database {
  const db = new Database(":memory:");
  db.run("PRAGMA foreign_keys = ON");
  initializeDatabaseSchema(db);
  ensureDefaultAgent(db);
  return db;
}

function withAgentService<T>(run: (service: AgentService, db: Database, rootDir: string) => T): T {
  const rootDir = mkdtempSync(join(tmpdir(), "my-agent-service-"));
  const db = createAgentDb();
  const configService = new AgentConfigService({ rootDir });
  const service = new AgentService({
    configService,
    profileRootDir: rootDir,
  });

  try {
    return run(service, db, rootDir);
  } finally {
    db.close();
    rmSync(rootDir, { recursive: true, force: true });
  }
}

describe("AgentService", () => {
  test("creates agent row and initializes agent files", () => {
    withAgentService((service, db, rootDir) => {
      const created = service.createAgent({
        agentId: "Researcher",
        name: "Researcher",
        description: "资料研究 Agent",
        workspacePath: "/tmp/research",
        model: { provider: "deepseek", model: "deepseek-chat" },
      }, { database: db });

      expect(created.agent).toMatchObject({
        id: "researcher",
        name: "Researcher",
        status: "idle",
        workspace_path: "/tmp/research",
      });
      expect(created.config.description).toBe("资料研究 Agent");
      expect(existsSync(join(rootDir, "agents", "researcher", "agent.json"))).toBe(true);
      expect(existsSync(join(rootDir, "agents", "researcher", "skills"))).toBe(true);
      expect(existsSync(join(rootDir, "agents", "researcher", "soul.md"))).toBe(true);
      expect(existsSync(join(rootDir, "agents", "researcher", "user.md"))).toBe(true);
      expect(listAgentEvents("researcher", 10, db).map((event) => event.type)).toContain("agent.created");
      expect(listAgentEvents("researcher", 10, db).map((event) => event.type)).toContain("agent.initialized");
    });
  });

  test("rejects duplicate agent creation", () => {
    withAgentService((service, db) => {
      service.createAgent({ agentId: "researcher", name: "Researcher" }, { database: db });

      expect(() => service.createAgent({ agentId: "researcher", name: "Researcher 2" }, { database: db }))
        .toThrow("Agent already exists");
      expect(listAgentEvents("researcher", 10, db).map((event) => event.type)).toContain("agent.create.failed");
    });
  });

  test("listAgents returns default and created agents", () => {
    withAgentService((service, db) => {
      service.createAgent({ agentId: "researcher", name: "Researcher" }, { database: db });

      expect(service.listAgents({ database: db }).map((item) => item.agent.id)).toEqual(["default", "researcher"]);
    });
  });

  test("updates one agent without changing another agent config", () => {
    withAgentService((service, db, rootDir) => {
      service.createAgent({ agentId: "researcher", name: "Researcher" }, { database: db });
      service.createAgent({ agentId: "writer", name: "Writer" }, { database: db });

      const updated = service.updateAgent("researcher", {
        name: "Research Agent",
        description: "更新后的描述",
        workspacePath: "/tmp/new-research",
      }, { database: db });

      expect(updated.agent.name).toBe("Research Agent");
      expect(updated.agent.workspace_path).toBe("/tmp/new-research");
      expect(updated.config.description).toBe("更新后的描述");
      const writerConfig = JSON.parse(readFileSync(join(rootDir, "agents", "writer", "agent.json"), "utf8"));
      expect(writerConfig.name).toBe("Writer");
    });
  });
});
