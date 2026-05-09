import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { ensureDefaultAgent } from "../agents/agent-registry";
import { initializeDatabaseSchema } from "../core/database";
import { appendEvent, listTaskEvents } from "../events/event-log";
import { createTask, markTaskCompleted, markTaskRunning } from "../tasks/task-store";
import {
  getEpisodeByTaskId,
  searchEpisodes,
  upsertEpisodeForTask,
} from "./episode-store";

function withEpisodeDb<T>(run: (db: Database) => T | Promise<T>): Promise<T> {
  const db = new Database(":memory:");
  db.run("PRAGMA foreign_keys = ON");
  initializeDatabaseSchema(db);
  ensureDefaultAgent(db);

  return Promise.resolve(run(db)).finally(() => db.close());
}

describe("episode store", () => {
  test("creates one episode from a completed task and updates idempotently", async () => {
    await withEpisodeDb((db) => {
      const task = createTask({
        id: "task-episode",
        conversation_id: "conversation-1",
        source_channel: "web",
        input: "帮我总结当前记忆系统还缺什么",
        created_at: 100,
      }, db);
      markTaskRunning(task.id, db);
      appendEvent({
        agent_id: "default",
        task_id: task.id,
        conversation_id: task.conversation_id,
        type: "tool.call",
        payload: { toolName: "read_file", args: { path: "src/memory/store.ts" } },
        created_at: 120,
      }, db);
      markTaskCompleted(task.id, "总结完成：缺少 episodic memory", db);

      const first = upsertEpisodeForTask(task.id, db);
      const second = upsertEpisodeForTask(task.id, db);

      expect(first).not.toBeNull();
      expect(second?.id).toBe(first?.id);
      expect(getEpisodeByTaskId(task.id, db)?.summary).toContain("缺少 episodic memory");
      expect(searchEpisodes({ query: "记忆系统", agentId: "default" }, db)).toHaveLength(1);
      expect(listTaskEvents(task.id, db).map((event) => event.type)).toContain("episode.updated");
    });
  });
});
