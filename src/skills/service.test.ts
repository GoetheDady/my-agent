import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureDefaultAgent } from "../agents/agent-registry";
import { initializeDatabaseSchema } from "../core/database";
import { listAgentEvents } from "../events/event-log";
import { defaultSkillService, SkillService, type RemoteSkillFetcher } from "./service";

function createTempRoot(): string {
  return mkdtempSync(join(tmpdir(), "my-agent-skills-"));
}

function insertAgent(db: Database, agentId: string, name: string): void {
  const now = Date.now();
  db
    .query(
      `INSERT INTO agents (id, name, status, current_task_id, workspace_path, created_at, updated_at)
       VALUES (?, ?, 'idle', NULL, '', ?, ?)`,
    )
    .run(agentId, name, now, now);
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
      expect(skill.origin.type).toBe("agent_created");
      expect(skill.readonly).toBe(false);
      expect(service.listSkills("default", "enabled").skills).toHaveLength(1);
      expect(service.buildSkillIndex("default")).toContain("web-debug");

      const view = service.viewSkill("web-debug", { agentId: "default", database: db });
      expect(view.content).toContain("Use browser tools");

      const disabled = service.disableSkill("web-debug", { agentId: "default", database: db });
      expect(disabled.skill?.status).toBe("disabled");
      expect(service.listSkills("default", "enabled").skills).toHaveLength(0);
      expect(existsSync(join(rootDir, "agents", "default", "skills", "skills.json"))).toBe(false);
      const agentConfig = JSON.parse(readFileSync(join(rootDir, "agents", "default", "agent.json"), "utf8"));
      expect(agentConfig.skills.items["web-debug"].status).toBe("disabled");
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

  test("keeps skill indexes isolated per agent", () => {
    const rootDir = createTempRoot();
    const db = new Database(":memory:");
    db.run("PRAGMA foreign_keys = ON");
    initializeDatabaseSchema(db);
    ensureDefaultAgent(db);
    insertAgent(db, "researcher", "Researcher");

    try {
      const service = new SkillService({ rootDir });
      service.createSkill({
        skillId: "research-notes",
        name: "Research Notes",
        description: "整理研究资料",
        content: "# Research Notes\n\nSummarize sources.",
      }, { agentId: "researcher", database: db });

      expect(service.listSkills("researcher", "enabled").skills.map((skill) => skill.id)).toEqual(["research-notes"]);
      expect(service.listSkills("default", "enabled").skills).toHaveLength(0);
      expect(service.buildSkillIndex("researcher")).toContain("research-notes");
      expect(service.buildSkillIndex("default")).not.toContain("research-notes");
    } finally {
      db.close();
      rmSync(rootDir, { recursive: true, force: true });
    }
  });

  test("migrates legacy skills registry into agent config", () => {
      const rootDir = createTempRoot();
    try {
      const registryDir = join(rootDir, "agents", "default", "skills");
      mkdirSync(registryDir, { recursive: true });
      writeFileSync(join(registryDir, "skills.json"), JSON.stringify({
        version: 1,
        agentId: "default",
        skills: {
          legacy: {
            name: "Legacy Skill",
            description: "旧索引",
            category: "general",
            allowedTools: [],
            source: "test",
            status: "enabled",
            createdAt: 1,
            updatedAt: 1,
          },
        },
      }, null, 2));

      const service = new SkillService({ rootDir });
      expect(service.listSkills("default", "enabled").skills.map((skill) => skill.id)).toEqual(["legacy"]);
      expect(service.listSkills("default", "enabled").skills[0].origin.type).toBe("agent_created");
      expect(existsSync(join(registryDir, "skills.json"))).toBe(false);
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });

  test("buildSkillIndex from default service is stable", () => {
    expect(defaultSkillService.buildSkillIndex("default")).toBeTypeOf("string");
  });

  test("lists builtin skills from project directory without copying them into data", () => {
    const rootDir = createTempRoot();
    const builtinRootDir = createTempRoot();
    try {
      const builtinDir = join(builtinRootDir, "browser-debug");
      mkdirSync(builtinDir, { recursive: true });
      writeFileSync(join(builtinDir, "SKILL.md"), [
        "---",
        'name: "Browser Debug"',
        'description: "调试浏览器"',
        'category: "debug"',
        "allowedTools:",
        '  - "read_file"',
        "---",
        "",
        "# Browser Debug",
        "",
        "Use browser tools.",
      ].join("\n"));

      const service = new SkillService({ rootDir, builtinRootDir });
      const [skill] = service.listSkills("default", "enabled").skills;

      expect(skill).toMatchObject({
        id: "browser-debug",
        readonly: true,
        source: "builtin",
        origin: { type: "builtin" },
      });
      expect(skill.filePath).toBe(join(builtinDir, "SKILL.md"));
      expect(existsSync(join(rootDir, "agents", "default", "skills", "browser-debug"))).toBe(false);
      expect(service.viewSkill("browser-debug").content).toContain("Use browser tools");
      expect(service.disableSkill("browser-debug").skill?.status).toBe("disabled");
      expect(service.listSkills("default", "enabled").skills).toHaveLength(0);
      expect(() => service.createSkill({
        skillId: "browser-debug",
        name: "Override",
        description: "覆盖",
        content: "# Override",
      })).toThrow("不能覆盖系统内置 skill");
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
      rmSync(builtinRootDir, { recursive: true, force: true });
    }
  });

  test("installs and updates remote skills using saved GitHub origin", async () => {
    const rootDir = createTempRoot();
    const firstRemote = createTempRoot();
    const secondRemote = createTempRoot();
    try {
      writeFileSync(join(firstRemote, "SKILL.md"), "# Remote Skill\n\nFirst version.");
      writeFileSync(join(secondRemote, "SKILL.md"), "# Remote Skill\n\nSecond version.");

      let commit = "commit-one";
      let directory = firstRemote;
      const fetcher: RemoteSkillFetcher = () => ({
        directory,
        commit,
        cleanup: () => undefined,
      });
      const service = new SkillService({ rootDir, remoteSkillFetcher: fetcher });

      const installed = await service.installSkill({
        url: "https://github.com/acme/remote-skill",
      });

      expect(installed.changed).toBe(true);
      expect(installed.skill).toMatchObject({
        id: "remote-skill",
        status: "disabled",
        source: "remote-installed",
        origin: {
          type: "remote_installed",
          provider: "github",
          url: "https://github.com/acme/remote-skill",
          repo: "acme/remote-skill",
          branch: "main",
          commit: "commit-one",
        },
      });
      expect(readFileSync(join(rootDir, "agents", "default", "skills", "remote-skill", "SKILL.md"), "utf8"))
        .toContain("First version");

      const skipped = await service.updateSkill("remote-skill");
      expect(skipped.changed).toBe(false);

      commit = "commit-two";
      directory = secondRemote;
      const updated = await service.updateSkill("remote-skill");

      expect(updated.changed).toBe(true);
      expect(updated.previousCommit).toBe("commit-one");
      expect(updated.skill.origin.type === "remote_installed" ? updated.skill.origin.commit : "").toBe("commit-two");
      expect(readFileSync(join(rootDir, "agents", "default", "skills", "remote-skill", "SKILL.md"), "utf8"))
        .toContain("Second version");
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
      rmSync(firstRemote, { recursive: true, force: true });
      rmSync(secondRemote, { recursive: true, force: true });
    }
  });

  test("remote install rejects duplicate skill ids", async () => {
    const rootDir = createTempRoot();
    const remoteDir = createTempRoot();
    try {
      writeFileSync(join(remoteDir, "SKILL.md"), "# Remote Skill\n\nBody.");
      const service = new SkillService({
        rootDir,
        remoteSkillFetcher: () => ({ directory: remoteDir, commit: "commit-one", cleanup: () => undefined }),
      });

      await service.installSkill({ url: "https://github.com/acme/remote-skill" });
      await expect(service.installSkill({ url: "https://github.com/acme/remote-skill" }))
        .rejects.toThrow("skill 已存在");
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
      rmSync(remoteDir, { recursive: true, force: true });
    }
  });

  test("remote install and update write audit events", async () => {
    const rootDir = createTempRoot();
    const remoteDir = createTempRoot();
    const db = new Database(":memory:");
    db.run("PRAGMA foreign_keys = ON");
    initializeDatabaseSchema(db);
    ensureDefaultAgent(db);
    try {
      writeFileSync(join(remoteDir, "SKILL.md"), "# Remote Skill\n\nBody.");
      let commit = "commit-one";
      const service = new SkillService({
        rootDir,
        remoteSkillFetcher: () => ({ directory: remoteDir, commit, cleanup: () => undefined }),
      });

      await service.installSkill({ url: "https://github.com/acme/remote-skill" }, { agentId: "default", database: db });
      await service.updateSkill("remote-skill", { agentId: "default", database: db });
      commit = "commit-two";
      await service.updateSkill("remote-skill", { agentId: "default", database: db });

      const eventTypes = listAgentEvents("default", 10, db).map((event) => event.type);
      expect(eventTypes).toContain("skill.installed");
      expect(eventTypes).toContain("skill.remote_update.skipped");
      expect(eventTypes).toContain("skill.remote_updated");
    } finally {
      db.close();
      rmSync(rootDir, { recursive: true, force: true });
      rmSync(remoteDir, { recursive: true, force: true });
    }
  });
});
