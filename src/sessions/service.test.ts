import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { ensureDefaultAgent } from "../agents/agent-registry";
import { initializeDatabaseSchema } from "../core/database";
import { createSession, getSession } from "./service";

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
});
