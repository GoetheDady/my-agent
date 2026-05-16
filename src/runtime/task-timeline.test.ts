import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { ensureDefaultAgent } from "../agents/agent-registry";
import { initializeDatabaseSchema } from "../core/database";
import { appendEvent } from "../events/event-log";
import { finalizeEpisodeForTask } from "../memory/episode-store";
import { createTask, markTaskRunning, markTaskCompleted, updateTaskProgress } from "../tasks/task-store";
import { getTaskTimeline } from "./task-timeline";

function withTimelineDb<T>(run: (db: Database) => T | Promise<T>): Promise<T> {
  const db = new Database(":memory:");
  db.run("PRAGMA foreign_keys = ON");
  initializeDatabaseSchema(db);
  ensureDefaultAgent(db);

  return Promise.resolve(run(db)).finally(() => db.close());
}

describe("task timeline", () => {
  test("builds a task timeline from task, events, and episode", async () => {
    await withTimelineDb((db) => {
      const task = createTask({
        id: "task-timeline",
        conversation_id: "conversation-1",
        source_channel: "web",
        input: "检查任务时间线",
        created_at: 100,
      }, db);
      markTaskRunning(task.id, db);
      updateTaskProgress(task.id, {
        status: "calling_model",
        message: "正在调用模型",
        metadata: { currentToolName: "read_file" },
      }, db);
      appendEvent({
        agent_id: "default",
        task_id: task.id,
        conversation_id: task.conversation_id,
        type: "tool.call",
        payload: { toolName: "read_file", toolCallId: "call-1", args: { path: "src/runtime/task-timeline.ts" } },
        created_at: 120,
      }, db);
      appendEvent({
        agent_id: "default",
        task_id: task.id,
        conversation_id: task.conversation_id,
        type: "tool.result",
        payload: {
          toolName: "read_file",
          toolCallId: "call-1",
          success: true,
          durationMs: 12,
          outputPreview: "ok",
        },
        created_at: 121,
      }, db);
      markTaskCompleted(task.id, "done", db);
      const episode = finalizeEpisodeForTask(task.id, db);

      const timeline = getTaskTimeline(task.id, db);

      expect(episode).not.toBeNull();
      expect(timeline).not.toBeNull();
      expect(timeline?.task.id).toBe(task.id);
      expect(timeline?.episode?.task_id).toBe(task.id);
      expect(timeline?.current).toMatchObject({
        progressStatus: "completed",
        progressMessage: "任务已完成",
      });
      expect(timeline?.timeline.map((item) => item.kind)).toContain("tool");
      expect(timeline?.timeline.map((item) => item.title)).toContain("工具调用");
      expect(timeline?.timeline.map((item) => item.title)).toContain("工具结果");
      expect(timeline?.timeline.map((item) => item.kind)).toContain("episode");
    });
  });

  test("returns null for a missing task", async () => {
    await withTimelineDb((db) => {
      expect(getTaskTimeline("missing-task", db)).toBeNull();
    });
  });
});
