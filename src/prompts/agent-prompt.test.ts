import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { ensureDefaultAgent } from "../agents/agent-registry";
import { initializeDatabaseSchema } from "../core/database";
import { createTask } from "../tasks/task-store";
import { buildAgentSystemPrompt } from "./agent-prompt";

function withPromptDb<T>(run: (db: Database) => T): T {
  const db = new Database(":memory:");
  db.run("PRAGMA foreign_keys = ON");
  initializeDatabaseSchema(db);
  ensureDefaultAgent(db);
  try {
    return run(db);
  } finally {
    db.close();
  }
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

describe("prompt builder", () => {
  test("injects soul.md and user.md as stable profile context without memory content", () => {
    withPromptDb((db) => {
      const task = createTask({
        id: "task-profile",
        source_channel: "web",
        source_user_id: "default",
        input: "hello",
      }, db);
      const prompt = buildAgentSystemPrompt(task, db, {
        profileContext: {
          soul: "# soul.md\nUse a direct voice.",
          user: "# user.md\nCall the user 戈德斯文.",
          files: [
            { kind: "soul", path: "/tmp/soul.md", content: "# soul.md\nUse a direct voice." },
            { kind: "user", path: "/tmp/user.md", content: "# user.md\nCall the user 戈德斯文." },
          ],
        },
      });

      expect(prompt).toContain("<profile-context>");
      expect(prompt).toContain("Use a direct voice.");
      expect(prompt).toContain("戈德斯文");
      expect(prompt).toContain("仍必须调用记忆工具");
      expect(prompt).not.toContain("<relevant-memories>");
    });
  });

  test("uses the task agent profile and skill index", () => {
    withPromptDb((db) => {
      insertAgent(db, "researcher", "Researcher");
      const task = createTask({
        id: "task-researcher",
        agent_id: "researcher",
        source_channel: "web",
        source_user_id: "default",
        input: "hello",
      }, db);
      const prompt = buildAgentSystemPrompt(task, db, {
        profileContext: {
          soul: "# soul.md\nResearcher soul only.",
          user: "# user.md\nShared user profile.",
          files: [
            { kind: "soul", path: "/tmp/researcher-soul.md", content: "# soul.md\nResearcher soul only." },
            { kind: "user", path: "/tmp/user.md", content: "# user.md\nShared user profile." },
          ],
        },
        skillService: {
          buildSkillIndex: (agentId: string) => `## Skills\n- agent-id: ${agentId}`,
        },
      });

      expect(prompt).toContain("id: researcher");
      expect(prompt).toContain("Researcher soul only.");
      expect(prompt).toContain("- agent-id: researcher");
    });
  });
});
