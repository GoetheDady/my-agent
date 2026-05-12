import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ensureDefaultAgent } from "./agent-registry";
import { AgentConfigService } from "./config-service";
import { initializeDatabaseSchema } from "../core/database";
import { listAgentEvents } from "../events/event-log";

function createTempRoot(): string {
  return mkdtempSync(join(tmpdir(), "my-agent-config-"));
}

function createDb(): Database {
  const db = new Database(":memory:");
  db.run("PRAGMA foreign_keys = ON");
  initializeDatabaseSchema(db);
  ensureDefaultAgent(db);
  return db;
}

describe("AgentConfigService", () => {
  test("creates default agent config", () => {
    const rootDir = createTempRoot();
    try {
      const service = new AgentConfigService({ rootDir });
      const config = service.getAgentConfig("default");

      expect(config.agentId).toBe("default");
      expect(config.model).not.toHaveProperty("temperature");
      expect(config.tools.enabledToolsets).toContain("skill");
      expect(existsSync(join(rootDir, "agents", "default", "agent.json"))).toBe(true);
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });

  test("patches allowed fields and records event", () => {
    const rootDir = createTempRoot();
    const db = createDb();
    try {
      const service = new AgentConfigService({ rootDir });
      const config = service.patchAgentConfig("default", {
        name: "Personal Agent",
        tools: { enabledToolsets: ["memory", "skill"] },
      }, { agentId: "default", database: db });

      expect(config.name).toBe("Personal Agent");
      expect(config.tools.enabledToolsets).toEqual(["memory", "skill"]);
      expect(listAgentEvents("default", 10, db).map((event) => event.type)).toContain("agent.config.updated");
    } finally {
      db.close();
      rmSync(rootDir, { recursive: true, force: true });
    }
  });

  test("patches array fields with add and remove operations", () => {
    const rootDir = createTempRoot();
    try {
      const service = new AgentConfigService({ rootDir });
      const config = service.patchAgentConfig("default", {
        tools: {
          removeEnabledToolsets: ["file"],
          addEnabledToolsets: ["agent_config", "custom"],
          addRequiresApproval: ["custom_write"],
          removeRequiresApproval: ["skill_disable"],
          addAllowedPaths: ["/tmp/my-agent"],
          removeAllowedPaths: ["/tmp/old"],
        },
      });

      expect(config.tools.enabledToolsets).not.toContain("file");
      expect(config.tools.enabledToolsets).toContain("custom");
      expect(config.tools.enabledToolsets.filter((toolset) => toolset === "agent_config")).toHaveLength(1);
      expect(config.tools.requiresApproval).toContain("custom_write");
      expect(config.tools.requiresApproval).not.toContain("skill_disable");
      expect(config.tools.allowedPaths).toContain("/tmp/my-agent");
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });

  test("patches individual skill status and allowed tools", () => {
    const rootDir = createTempRoot();
    try {
      const service = new AgentConfigService({ rootDir });
      service.patchAgentConfig("default", {
        skills: {
          items: {
            "web-debug": {
              name: "Web Debug",
              description: "调试网页",
              category: "debug",
              allowedTools: ["read_file"],
              source: "test",
              status: "enabled",
            },
          },
        },
      });

      const config = service.patchAgentConfig("default", {
        skills: {
          disableSkillIds: ["web-debug"],
          items: {
            "web-debug": {
              addAllowedTools: ["write_file"],
              removeAllowedTools: ["read_file"],
            },
          },
        },
      });

      expect(config.skills.items["web-debug"].status).toBe("disabled");
      expect(config.skills.items["web-debug"].allowedTools).toEqual(["write_file"]);
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });

  test("rejects invalid config patch", () => {
    const rootDir = createTempRoot();
    try {
      const service = new AgentConfigService({ rootDir });
      expect(() => service.patchAgentConfig("default", { name: "" })).toThrow("name 不能为空");
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });

  test("reset restores defaults", () => {
    const rootDir = createTempRoot();
    try {
      const service = new AgentConfigService({ rootDir });
      service.patchAgentConfig("default", { name: "Changed" });
      const result = service.resetAgentConfig("default");

      expect(result.config.name).toBe("Default Agent");
      expect(service.getAgentConfig("default").name).toBe("Default Agent");
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });

  test("recovers from broken agent json", () => {
    const rootDir = createTempRoot();
    try {
      const service = new AgentConfigService({ rootDir });
      const configPath = service.getConfigPath("default");
      mkdirSync(dirname(configPath), { recursive: true });
      writeFileSync(configPath, "{ broken", "utf8");
      expect(service.getAgentConfig("default").name).toBe("Default Agent");
      expect(readFileSync(configPath, "utf8")).toContain("Default Agent");
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });
});
