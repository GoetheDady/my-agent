import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { ensureDefaultAgent } from "../agents/agent-registry";
import { initializeDatabaseSchema } from "../core/database";
import { appendEvent, listTaskEvents } from "../events/event-log";
import {
  createTask,
  markTaskCanceled,
  markTaskCompleted,
  markTaskFailed,
  markTaskRunning,
  retryTask,
} from "../tasks/task-store";
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
        type: "task.plan.updated",
        payload: { steps: [{ title: "读取源码", detail: "检查 memory store" }] },
        created_at: 110,
      }, db);
      appendEvent({
        agent_id: "default",
        task_id: task.id,
        conversation_id: task.conversation_id,
        type: "task.step.updated",
        payload: { title: "读取源码", status: "completed" },
        created_at: 111,
      }, db);
      appendEvent({
        agent_id: "default",
        task_id: task.id,
        conversation_id: task.conversation_id,
        type: "task.dependency.blocked",
        payload: { blockers: [{ taskId: "task-before", status: "queued", reason: "等待前置任务" }] },
        created_at: 112,
      }, db);
      appendEvent({
        agent_id: "default",
        task_id: task.id,
        conversation_id: task.conversation_id,
        type: "tool.call",
        payload: { toolName: "read_file", args: { path: "src/memory/store.ts" } },
        created_at: 120,
      }, db);
      appendEvent({
        agent_id: "default",
        task_id: task.id,
        conversation_id: task.conversation_id,
        type: "tool.result",
        payload: {
          toolName: "read_file",
          toolCallId: "tool-call-1",
          success: true,
          durationMs: 10,
          outputPreview: "ok",
        },
        created_at: 121,
      }, db);
      markTaskCompleted(task.id, "总结完成：缺少 episodic memory", db);

      const first = upsertEpisodeForTask(task.id, db);
      const second = upsertEpisodeForTask(task.id, db);

      expect(first).not.toBeNull();
      expect(second?.id).toBe(first?.id);
      expect(getEpisodeByTaskId(task.id, db)).toMatchObject({
        summary: expect.stringContaining("缺少 episodic memory"),
        outcome: expect.stringContaining("完成"),
        task_status: "completed",
        attempt_count: 1,
        files_touched: ["src/memory/store.ts"],
        key_steps: expect.arrayContaining([
          "计划步骤：读取源码",
          "步骤完成：读取源码",
          "等待依赖：task-before",
          "调用工具：read_file",
        ]),
        tools_used: expect.arrayContaining(["read_file"]),
      });
      expect(searchEpisodes({ query: "记忆系统", agentId: "default" }, db)).toHaveLength(1);
      expect(listTaskEvents(task.id, db).map((event) => event.type)).toContain("episode.updated");
    });
  });

  test("creates episodes for failed and canceled tasks with outcome fields", async () => {
    await withEpisodeDb((db) => {
      const failed = createTask({
        id: "task-failed",
        source_channel: "web",
        input: "调用模型完成分析",
      }, db);
      markTaskRunning(failed.id, db);
      markTaskFailed(failed.id, "model down", {
        failure_type: "model_error",
        failure_stage: "model_call",
        retriable: true,
      }, db);

      const canceled = createTask({
        id: "task-canceled",
        source_channel: "web",
        input: "稍后再做",
      }, db);
      markTaskCanceled(canceled.id, { failureType: "user_canceled", requestedBy: "runtime_api" }, db);

      const failedEpisode = upsertEpisodeForTask(failed.id, db);
      const canceledEpisode = upsertEpisodeForTask(canceled.id, db);

      expect(failedEpisode).toMatchObject({
        task_status: "failed",
        failure_type: "model_error",
        failure_stage: "model_call",
        retriable: true,
        problems: ["model down"],
      });
      expect(failedEpisode?.outcome).toContain("失败：model down");
      expect(canceledEpisode).toMatchObject({
        task_status: "canceled",
        failure_type: "user_canceled",
        failure_stage: "cancel",
        retriable: false,
      });
      expect(canceledEpisode?.outcome).toContain("用户取消");
      if (!failedEpisode || !canceledEpisode) {
        throw new Error("episode should exist");
      }
      expect(searchEpisodes({ agentId: "default", taskStatus: "failed" }, db).map((episode) => episode.id)).toEqual([
        failedEpisode.id,
      ]);
      expect(searchEpisodes({ agentId: "default", failureType: "user_canceled" }, db).map((episode) => episode.id)).toEqual([
        canceledEpisode.id,
      ]);
    });
  });

  test("updates the same episode after retry succeeds", async () => {
    await withEpisodeDb((db) => {
      const task = createTask({
        id: "task-retry",
        source_channel: "web",
        input: "先失败再成功",
      }, db);
      markTaskRunning(task.id, db);
      markTaskFailed(task.id, "first failure", db);

      const failedEpisode = upsertEpisodeForTask(task.id, db);
      retryTask(task.id, { force: true }, db);
      markTaskRunning(task.id, db);
      markTaskCompleted(task.id, "retry success", db);
      const completedEpisode = upsertEpisodeForTask(task.id, db);

      expect(completedEpisode?.id).toBe(failedEpisode?.id);
      expect(completedEpisode).toMatchObject({
        task_status: "completed",
        attempt_count: 2,
        failure_type: null,
        failure_stage: null,
        retriable: null,
        outcome: expect.stringContaining("retry success"),
      });
      expect(completedEpisode?.key_steps).toContain("任务重新排队等待重试");
    });
  });
});
