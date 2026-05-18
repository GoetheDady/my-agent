import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { ensureDefaultAgent } from "../agents/agent-registry";
import { initializeDatabaseSchema } from "../core/database";
import { appendEvent } from "../events/event-log";
import { listReviewItems } from "../memory/review-store";
import { createTask, markTaskCompleted, markTaskFailed, markTaskRunning } from "../tasks/task-store";
import { upsertEpisodeForTask } from "../memory/episode-store";
import { createSkillCandidateFromEpisode } from "./candidates";

function withCandidateDb<T>(run: (db: Database) => T | Promise<T>): Promise<T> {
  const db = new Database(":memory:");
  db.run("PRAGMA foreign_keys = ON");
  initializeDatabaseSchema(db);
  ensureDefaultAgent(db);
  return Promise.resolve(run(db)).finally(() => db.close());
}

describe("skill candidates", () => {
  test("creates a review item from a high quality completed episode", async () => {
    await withCandidateDb((db) => {
      const task = createTask({
        id: "task-skill-candidate",
        source_channel: "web",
        input: "实现一个可复用调试流程",
      }, db);
      markTaskRunning(task.id, db);
      appendEvent({
        agent_id: "default",
        task_id: task.id,
        type: "task.plan.updated",
        payload: {
          steps: [
            { title: "复现问题", detail: "锁定输入" },
            { title: "补测试", detail: "先看失败" },
            { title: "修复并验证", detail: "运行测试" },
          ],
        },
      }, db);
      appendEvent({
        agent_id: "default",
        task_id: task.id,
        type: "task.step.updated",
        payload: { title: "补测试", status: "completed" },
      }, db);
      markTaskCompleted(task.id, "形成了可复用调试流程。", db);
      const episode = upsertEpisodeForTask(task.id, db);
      if (!episode) throw new Error("episode should exist");

      const candidate = createSkillCandidateFromEpisode({
        episodeId: episode.id,
        reason: "步骤清晰且任务成功",
      }, { database: db });

      expect(candidate).toMatchObject({
        type: "skill_candidate",
        status: "pending",
        reason: "步骤清晰且任务成功",
      });
      expect(candidate?.proposed_content).toContain("来源任务：task-skill-candidate");
      expect(candidate?.proposed_content).toContain("关键步骤");
      expect(candidate?.source_event_ids.length).toBeGreaterThan(0);
      expect(listReviewItems({ agentId: "default", status: "pending" }, db).map((item) => item.type)).toContain("skill_candidate");
    });
  });

  test("does not create skill candidates from failed noisy episodes", async () => {
    await withCandidateDb((db) => {
      const task = createTask({
        id: "task-failed-candidate",
        source_channel: "web",
        input: "失败流程不能直接沉淀",
      }, db);
      markTaskRunning(task.id, db);
      markTaskFailed(task.id, "没有稳定结论", db);
      const episode = upsertEpisodeForTask(task.id, db);
      if (!episode) throw new Error("episode should exist");

      const candidate = createSkillCandidateFromEpisode({ episodeId: episode.id }, { database: db });

      expect(candidate).toBeNull();
      expect(listReviewItems({ agentId: "default", status: "pending" }, db)).toHaveLength(0);
    });
  });
});
