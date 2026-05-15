import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { ensureDefaultAgent } from "../agents/agent-registry";
import { initializeDatabaseSchema } from "../core/database";
import { appendMessage, createSession, getSession, getSessionMessage, replaceAssistantMessageContent } from "./service";

function withSessionDb<T>(run: (db: Database) => T): T {
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

describe("session service", () => {
  test("creates a default session when no agent is provided", () => {
    withSessionDb((db) => {
      const session = createSession(undefined, db);

      expect(session.agent_id).toBe("default");
      expect(getSession(session.id, db)?.agent_id).toBe("default");
    });
  });

  test("persists the target agent on the session", () => {
    withSessionDb((db) => {
      const session = createSession({ agentId: "researcher", title: "研究会话" }, db);

      expect(session).toMatchObject({
        agent_id: "researcher",
        title: "研究会话",
      });
      expect(getSession(session.id, db)?.agent_id).toBe("researcher");
    });
  });

  test("replaces an existing assistant message without appending a duplicate", () => {
    withSessionDb((db) => {
      const session = createSession(undefined, db);
      const assistantMessage = appendMessage(session.id, "assistant", JSON.stringify([{ type: "text", text: "pending" }]), db);

      const updated = replaceAssistantMessageContent(
        assistantMessage.id,
        JSON.stringify([{ type: "text", text: "done" }]),
        db,
      );

      expect(updated?.id).toBe(assistantMessage.id);
      expect(getSessionMessage(assistantMessage.id, db)?.content).toBe(JSON.stringify([{ type: "text", text: "done" }]));
    });
  });
});
