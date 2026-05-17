import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { ensureDefaultAgent } from "../agents/agent-registry";
import { initializeDatabaseSchema } from "../core/database";
import { listTaskEvents } from "../events/event-log";
import { createTask } from "./task-store";
import {
  addTaskDependency,
  getUnmetTaskDependencies,
  listTaskDependencies,
  listTaskSteps,
  removeTaskDependency,
  setTaskPlan,
  updateTaskStepStatus,
} from "./task-plan-store";

function withPlanDb<T>(run: (db: Database) => T): T {
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

describe("task plan store", () => {
  test("sets and reads task plan steps in order", () => {
    withPlanDb((db) => {
      createTask({ id: "parent", source_channel: "web", input: "parent" }, db);

      const steps = setTaskPlan("parent", [
        { title: "读取上下文", detail: "检查相关文档" },
        { title: "实现改动", detail: "" },
      ], db);

      expect(steps.map((step) => ({
        task_id: step.task_id,
        step_index: step.step_index,
        title: step.title,
        detail: step.detail,
        status: step.status,
        child_task_id: step.child_task_id,
      }))).toEqual([
        {
          task_id: "parent",
          step_index: 0,
          title: "读取上下文",
          detail: "检查相关文档",
          status: "pending",
          child_task_id: null,
        },
        {
          task_id: "parent",
          step_index: 1,
          title: "实现改动",
          detail: "",
          status: "pending",
          child_task_id: null,
        },
      ]);
      expect(listTaskSteps("parent", db).map((step) => step.title)).toEqual(["读取上下文", "实现改动"]);
      expect(listTaskEvents("parent", db).map((event) => event.type)).toContain("task.plan.updated");
    });
  });

  test("updates a task step status and writes an event", () => {
    withPlanDb((db) => {
      createTask({ id: "parent", source_channel: "web", input: "parent" }, db);
      const [step] = setTaskPlan("parent", [{ title: "执行", detail: "run" }], db);

      const updated = updateTaskStepStatus(step.id, "running", db);

      expect(updated).toMatchObject({
        id: step.id,
        status: "running",
      });
      const stepEvent = listTaskEvents("parent", db).findLast((event) => event.type === "task.step.updated");
      expect(JSON.parse(stepEvent?.payload ?? "{}")).toMatchObject({
        stepId: step.id,
        status: "running",
      });
    });
  });

  test("adds and removes task dependencies", () => {
    withPlanDb((db) => {
      createTask({ id: "blocked", source_channel: "web", input: "blocked" }, db);
      createTask({ id: "blocker", source_channel: "web", input: "blocker" }, db);

      const dependency = addTaskDependency("blocked", "blocker", "等待前置任务", db);

      expect(dependency).toMatchObject({
        task_id: "blocked",
        depends_on_task_id: "blocker",
        reason: "等待前置任务",
        depends_on_status: "queued",
      });
      expect(getUnmetTaskDependencies("blocked", db).map((item) => item.depends_on_task_id)).toEqual(["blocker"]);
      expect(removeTaskDependency("blocked", "blocker", db)).toBe(true);
      expect(listTaskDependencies("blocked", db)).toEqual([]);
      expect(listTaskEvents("blocked", db).map((event) => event.type)).toEqual([
        "task.dependency.added",
        "task.dependency.removed",
      ]);
    });
  });

  test("rejects missing, self, and circular dependencies", () => {
    withPlanDb((db) => {
      createTask({ id: "a", source_channel: "web", input: "a" }, db);
      createTask({ id: "b", source_channel: "web", input: "b" }, db);
      createTask({ id: "c", source_channel: "web", input: "c" }, db);

      expect(() => addTaskDependency("a", "missing", "", db)).toThrow("依赖任务不存在。");
      expect(() => addTaskDependency("a", "a", "", db)).toThrow("任务不能依赖自己。");

      addTaskDependency("a", "b", "", db);
      addTaskDependency("b", "c", "", db);
      expect(() => addTaskDependency("c", "a", "", db)).toThrow("任务依赖不能形成循环。");
    });
  });
});
