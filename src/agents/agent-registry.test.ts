import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { initializeDatabaseSchema } from "../core/database";
import { ensureDefaultAgent, getAgent, updateAgentStatus } from "./agent-registry";

function withRegistryDb<T>(run: (db: Database) => T): T {
  const db = new Database(":memory:");
  db.run("PRAGMA foreign_keys = ON");
  initializeDatabaseSchema(db);

  try {
    return run(db);
  } finally {
    db.close();
  }
}

describe("agent registry", () => {
  test("ensureDefaultAgent creates default if missing", () => {
    withRegistryDb((db) => {
      const agent = ensureDefaultAgent(db);

      expect(agent.id).toBe("default");
      expect(agent.name).toBe("Default Agent");
      expect(agent.status).toBe("idle");
      expect(agent.current_task_id).toBeNull();
      expect(agent.workspace_path).toBe("");
    });
  });

  test("ensureDefaultAgent is idempotent", () => {
    withRegistryDb((db) => {
      const first = ensureDefaultAgent(db);
      const second = ensureDefaultAgent(db);
      const count = db
        .query<{ count: number }, []>("SELECT COUNT(*) AS count FROM agents WHERE id = 'default'")
        .get();

      expect(second).toEqual(first);
      expect(count?.count).toBe(1);
    });
  });

  test("getAgent returns default agent with idle status", () => {
    withRegistryDb((db) => {
      ensureDefaultAgent(db);

      const agent = getAgent("default", db);

      expect(agent?.status).toBe("idle");
    });
  });

  test("updateAgentStatus updates status and current task", () => {
    withRegistryDb((db) => {
      ensureDefaultAgent(db);

      updateAgentStatus("default", "running", "task-1", db);
      expect(getAgent("default", db)).toMatchObject({
        status: "running",
        current_task_id: "task-1",
      });

      updateAgentStatus("default", "idle", null, db);
      expect(getAgent("default", db)).toMatchObject({
        status: "idle",
        current_task_id: null,
      });
    });
  });
});
