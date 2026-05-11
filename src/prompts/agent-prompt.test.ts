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
});
