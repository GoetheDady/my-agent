import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureDefaultAgent } from "../agents/agent-registry";
import { initializeDatabaseSchema } from "../core/database";
import { defaultSkillService, SkillService } from "./service";

function createTempRoot(): string {
  return mkdtempSync(join(tmpdir(), "my-agent-skills-"));
}

describe("SkillService", () => {
  test("creates, lists and toggles skills", () => {
    const rootDir = createTempRoot();
    const db = new Database(":memory:");
    db.run("PRAGMA foreign_keys = ON");
    initializeDatabaseSchema(db);
    ensureDefaultAgent(db);

    try {
      const service = new SkillService({ rootDir });
      const skill = service.createSkill({
        skillId: "web-debug",
        name: "Web Debug",
        description: "调试 Web 页面",
        content: "# Web Debug\n\nUse browser tools.",
      }, { agentId: "default", database: db });

      expect(skill.id).toBe("web-debug");
      expect(service.listSkills("default", "enabled").skills).toHaveLength(1);
      expect(service.buildSkillIndex("default")).toContain("web-debug");

      const view = service.viewSkill("web-debug", { agentId: "default", database: db });
      expect(view.content).toContain("Use browser tools");

      const disabled = service.disableSkill("web-debug", { agentId: "default", database: db });
      expect(disabled.skill?.status).toBe("disabled");
      expect(service.listSkills("default", "enabled").skills).toHaveLength(0);
    } finally {
      db.close();
      rmSync(rootDir, { recursive: true, force: true });
    }
  });

  test("writes skill files under the agent directory", () => {
    const rootDir = createTempRoot();
    try {
      const service = new SkillService({ rootDir });
      service.createSkill({
        skillId: "agent-skill",
        name: "Agent Skill",
        description: "测试",
        content: "# Title\n\nBody",
      });

      const filePath = join(rootDir, "agents", "default", "skills", "agent-skill", "SKILL.md");
      const content = readFileSync(filePath, "utf8");
      expect(content).toContain("Agent Skill");
      expect(content).toContain("Body");
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });

  test("buildSkillIndex from default service is stable", () => {
    expect(defaultSkillService.buildSkillIndex("default")).toBeTypeOf("string");
  });
});
