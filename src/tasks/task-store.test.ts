import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { ensureDefaultAgent } from "../agents/agent-registry";
import { initializeDatabaseSchema } from "../core/database";
import { listTaskEvents } from "../events/event-log";
import { updateTaskProgress, createTask } from "./task-store";

function withTaskDb<T>(run: (db: Database) => T | Promise<T>): Promise<T> {
  const db = new Database(":memory:");
  db.run("PRAGMA foreign_keys = ON");
  initializeDatabaseSchema(db);
  ensureDefaultAgent(db);

  return Promise.resolve(run(db)).finally(() => db.close());
}

describe("task store progress", () => {
  test("persists progress metadata in task progress events", async () => {
    await withTaskDb((db) => {
      const task = createTask({ id: "task-progress", source_channel: "web", input: "hello" }, db);

      updateTaskProgress(task.id, {
        status: "using_tool",
        message: "正在执行工具：read_file",
        metadata: {
          currentToolName: "read_file",
          currentToolCallId: "call-1",
        },
      }, db);

      const event = listTaskEvents(task.id, db).findLast((item) => item.type === "task.progress.updated");
      expect(event).not.toBeUndefined();
      expect(JSON.parse(event?.payload ?? "{}")).toMatchObject({
        progressStatus: "using_tool",
        progressMessage: "正在执行工具：read_file",
        currentToolName: "read_file",
        currentToolCallId: "call-1",
      });
    });
  });
});
