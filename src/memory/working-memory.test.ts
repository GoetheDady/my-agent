import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { ensureDefaultAgent } from "../agents/agent-registry";
import { initializeDatabaseSchema } from "../core/database";
import { createTask } from "../tasks/task-store";
import {
  clearWorkingMemory,
  getWorkingMemory,
  listWorkingMemory,
  setWorkingMemory,
} from "./working-memory";

function withWorkingMemoryDb<T>(run: (db: Database) => T): T {
  const db = new Database(":memory:");
  db.run("PRAGMA foreign_keys = ON");
  initializeDatabaseSchema(db);
  ensureDefaultAgent(db);
  createTask({ id: "task-1", source_channel: "web", input: "remember this" }, db);

  try {
    return run(db);
  } finally {
    db.close();
  }
}

describe("working memory", () => {
  test("setWorkingMemory stores a key", () => {
    withWorkingMemoryDb((db) => {
      setWorkingMemory("default", "task-1", "goal", "ship the MVP", db);

      expect(getWorkingMemory<string>("default", "task-1", "goal", db)).toBe("ship the MVP");
    });
  });

  test("setWorkingMemory overwrites an existing key", () => {
    withWorkingMemoryDb((db) => {
      setWorkingMemory("default", "task-1", "status", "drafting", db);
      setWorkingMemory("default", "task-1", "status", "reviewing", db);

      expect(getWorkingMemory<string>("default", "task-1", "status", db)).toBe("reviewing");
    });
  });

  test("getWorkingMemory returns null for missing key", () => {
    withWorkingMemoryDb((db) => {
      expect(getWorkingMemory("default", "task-1", "missing", db)).toBeNull();
    });
  });

  test("listWorkingMemory returns all keys for a task", () => {
    withWorkingMemoryDb((db) => {
      setWorkingMemory("default", "task-1", "goal", "ship", db);
      setWorkingMemory("default", "task-1", "progress", { step: 2, done: false }, db);

      expect(listWorkingMemory("default", "task-1", db)).toEqual({
        goal: "ship",
        progress: { step: 2, done: false },
      });
    });
  });

  test("clearWorkingMemory removes all keys for a task", () => {
    withWorkingMemoryDb((db) => {
      setWorkingMemory("default", "task-1", "goal", "ship", db);
      setWorkingMemory("default", "task-1", "status", "running", db);

      clearWorkingMemory("default", "task-1", db);

      expect(listWorkingMemory("default", "task-1", db)).toEqual({});
    });
  });
});
