import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { ensureDefaultAgent } from "../agents/agent-registry";
import { DelegationService } from "../delegations/service";
import { initializeDatabaseSchema } from "../core/database";
import { addTaskDependency, listTaskDependencies, listTaskSteps, setTaskPlan } from "./task-plan-store";
import { createTask, getTask } from "./task-store";
import { createTaskTools } from "./task-tools";

function createDb(): Database {
  const db = new Database(":memory:");
  db.run("PRAGMA foreign_keys = ON");
  initializeDatabaseSchema(db);
  ensureDefaultAgent(db);
  insertAgent(db, "researcher", "Researcher");
  return db;
}

function insertAgent(db: Database, agentId: string, name: string): void {
  const now = Date.now();
  db
    .query(
      `INSERT INTO agents (id, name, status, current_task_id, workspace_path, created_at, updated_at)
       VALUES (?, ?, 'idle', NULL, '', ?, ?)`,
    )
    .run(agentId, name, now, now);
}

function withTaskTools<T>(run: (input: {
  db: Database;
  taskId: string;
  tools: ReturnType<typeof createTaskTools>;
}) => Promise<T> | T): Promise<T> {
  const db = createDb();
  const parent = createTask({
    id: "parent",
    agent_id: "default",
    conversation_id: "conversation-1",
    source_channel: "web",
    source_user_id: "default",
    input: "parent task",
  }, db);
  const delegationService = new DelegationService({
    database: db,
    autoStart: false,
    internalRunner: async ({ task }) => ({ task, text: "unused" }),
  });
  const tools = createTaskTools({
    database: db,
    agentId: "default",
    taskId: parent.id,
    conversationId: parent.conversation_id,
    sessionId: "session-1",
    sourceChannel: parent.source_channel,
    sourceUserId: parent.source_user_id,
    delegationService,
  });

  return Promise.resolve()
    .then(() => run({ db, taskId: parent.id, tools }))
    .finally(() => db.close());
}

const toolContext = { toolCallId: "tool-call", messages: [] };

describe("task planning tools", () => {
  test("task_plan_set writes plan steps for the current task", async () => {
    await withTaskTools(async ({ db, taskId, tools }) => {
      const result = await tools.task_plan_set.execute?.({
        steps: [
          { title: "读取上下文", detail: "检查相关源码" },
          { title: "实现改动" },
        ],
      }, toolContext);

      expect(result).toMatchObject({ success: true });
      expect(listTaskSteps(taskId, db).map((step) => ({
        title: step.title,
        detail: step.detail,
        status: step.status,
      }))).toEqual([
        { title: "读取上下文", detail: "检查相关源码", status: "pending" },
        { title: "实现改动", detail: "", status: "pending" },
      ]);
    });
  });

  test("task_plan_get returns current task plan, dependencies, and children", async () => {
    await withTaskTools(async ({ db, taskId, tools }) => {
      const [step] = setTaskPlan(taskId, [{ title: "子任务", detail: "交给 researcher" }], db);
      const child = createTask({
        id: "child",
        agent_id: "researcher",
        parent_task_id: taskId,
        plan_step_id: step.id,
        source_channel: "delegation",
        source_user_id: "default",
        input: "child work",
      }, db);
      const blocker = createTask({
        id: "blocker",
        agent_id: "researcher",
        parent_task_id: taskId,
        source_channel: "web",
        source_user_id: "default",
        input: "blocker",
      }, db);
      addTaskDependency(child.id, blocker.id, "等待 blocker", db);

      const result = await tools.task_plan_get.execute?.({}, toolContext);

      expect(result).toMatchObject({
        success: true,
        task: { id: taskId },
      });
      expect((result as { plan: { steps: Array<{ id: string }> } }).plan.steps.map((item) => item.id)).toEqual([
        step.id,
      ]);
      expect((result as { children: Array<{ id: string }> }).children.map((item) => item.id)).toEqual([
        "child",
        "blocker",
      ]);
      expect((result as { dependencies: Array<{ depends_on_task_id: string }> }).dependencies).toMatchObject([
        { depends_on_task_id: "blocker" },
      ]);
    });
  });

  test("task_step_update rejects steps outside the current task", async () => {
    await withTaskTools(async ({ db, tools }) => {
      createTask({ id: "other", source_channel: "web", input: "other" }, db);
      const [otherStep] = setTaskPlan("other", [{ title: "other step" }], db);

      const result = await tools.task_step_update.execute?.({
        stepId: otherStep.id,
        status: "running",
      }, toolContext);

      expect(result).toEqual({
        success: false,
        error: "只能更新当前任务的步骤。",
      });
    });
  });

  test("task_child_create delegates a step as a linked child task", async () => {
    await withTaskTools(async ({ db, taskId, tools }) => {
      const [step] = setTaskPlan(taskId, [{ title: "研究实现", detail: "交给 researcher" }], db);

      const result = await tools.task_child_create.execute?.({
        stepId: step.id,
        targetAgentId: "researcher",
        instruction: "研究实现方案",
        reason: "并行研究",
      }, toolContext);

      const childTaskId = (result as { childTaskId: string }).childTaskId;
      expect(result).toMatchObject({
        success: true,
        childTaskId: expect.any(String),
        status: "queued",
      });
      expect(getTask(childTaskId, db)).toMatchObject({
        agent_id: "researcher",
        parent_task_id: taskId,
        plan_step_id: step.id,
        source_channel: "delegation",
        input: "研究实现方案",
      });
      expect(listTaskSteps(taskId, db)[0].child_task_id).toBe(childTaskId);
    });
  });

  test("task_child_create rejects self delegation and occupied steps", async () => {
    await withTaskTools(async ({ db, taskId, tools }) => {
      const [selfStep, occupiedStep] = setTaskPlan(taskId, [
        { title: "self" },
        { title: "occupied" },
      ], db);
      createTask({
        id: "existing-child",
        agent_id: "researcher",
        parent_task_id: taskId,
        plan_step_id: occupiedStep.id,
        source_channel: "delegation",
        source_user_id: "default",
        input: "existing",
      }, db);

      await expect(tools.task_child_create.execute?.({
        stepId: selfStep.id,
        targetAgentId: "default",
        instruction: "自己做",
      }, toolContext)).resolves.toMatchObject({
        success: false,
        error: "不能把任务委派给自己",
      });
      await expect(tools.task_child_create.execute?.({
        stepId: occupiedStep.id,
        targetAgentId: "researcher",
        instruction: "重复创建",
      }, toolContext)).resolves.toEqual({
        success: false,
        error: "该步骤已经关联子任务。",
      });
    });
  });

  test("task_child_create writes dependencies for new child tasks", async () => {
    await withTaskTools(async ({ db, taskId, tools }) => {
      const [blockerStep, blockedStep] = setTaskPlan(taskId, [
        { title: "先做" },
        { title: "后做" },
      ], db);
      const blocker = createTask({
        id: "blocker",
        agent_id: "researcher",
        parent_task_id: taskId,
        plan_step_id: blockerStep.id,
        source_channel: "delegation",
        source_user_id: "default",
        input: "先做",
      }, db);

      const result = await tools.task_child_create.execute?.({
        stepId: blockedStep.id,
        targetAgentId: "researcher",
        instruction: "后做",
        dependsOnTaskIds: [blocker.id],
      }, toolContext);

      const childTaskId = (result as { childTaskId: string }).childTaskId;
      expect(result).toMatchObject({ success: true });
      expect(listTaskDependencies(childTaskId, db)).toMatchObject([
        { task_id: childTaskId, depends_on_task_id: blocker.id },
      ]);
    });
  });

  test("task_child_create can use the default delegation service with the current database", async () => {
    const db = createDb();
    try {
      const parent = createTask({
        id: "parent-no-injection",
        agent_id: "default",
        source_channel: "web",
        source_user_id: "default",
        input: "parent",
      }, db);
      const [blockerStep, blockedStep] = setTaskPlan(parent.id, [
        { title: "blocker" },
        { title: "blocked" },
      ], db);
      const blocker = createTask({
        id: "blocker-no-injection",
        agent_id: "researcher",
        parent_task_id: parent.id,
        plan_step_id: blockerStep.id,
        source_channel: "web",
        source_user_id: "default",
        input: "blocker",
      }, db);
      const tools = createTaskTools({
        database: db,
        agentId: "default",
        taskId: parent.id,
        sourceChannel: "web",
        sourceUserId: "default",
      });

      const result = await tools.task_child_create.execute?.({
        stepId: blockedStep.id,
        targetAgentId: "researcher",
        instruction: "blocked child",
        dependsOnTaskIds: [blocker.id],
      }, toolContext);

      const childTaskId = (result as { childTaskId: string }).childTaskId;
      expect(result).toMatchObject({
        success: true,
        childTaskId: expect.any(String),
      });
      expect(getTask(childTaskId, db)).toMatchObject({
        parent_task_id: parent.id,
        plan_step_id: blockedStep.id,
      });
    } finally {
      db.close();
    }
  });

  test("task_dependency_add and remove are scoped to current child tasks", async () => {
    await withTaskTools(async ({ db, taskId, tools }) => {
      const first = createTask({
        id: "first-child",
        agent_id: "researcher",
        parent_task_id: taskId,
        source_channel: "delegation",
        source_user_id: "default",
        input: "first",
      }, db);
      const second = createTask({
        id: "second-child",
        agent_id: "researcher",
        parent_task_id: taskId,
        source_channel: "delegation",
        source_user_id: "default",
        input: "second",
      }, db);
      createTask({ id: "outside", source_channel: "web", input: "outside" }, db);

      await expect(tools.task_dependency_add.execute?.({
        taskId: second.id,
        dependsOnTaskId: first.id,
        reason: "等待 first",
      }, toolContext)).resolves.toMatchObject({
        success: true,
        dependency: { depends_on_task_id: first.id },
      });
      await expect(tools.task_dependency_remove.execute?.({
        taskId: second.id,
        dependsOnTaskId: first.id,
      }, toolContext)).resolves.toEqual({
        success: true,
        removed: true,
      });
      await expect(tools.task_dependency_add.execute?.({
        taskId: second.id,
        dependsOnTaskId: "outside",
        reason: "越权",
      }, toolContext)).resolves.toEqual({
        success: false,
        error: "只能维护当前任务直接子任务之间的依赖。",
      });
    });
  });

  test("write tools fail without a current task context", async () => {
    const db = createDb();
    try {
      const tools = createTaskTools({ database: db, agentId: "default" });

      await expect(tools.task_plan_set.execute?.({ steps: [] }, toolContext)).resolves.toMatchObject({
        success: false,
        error: "当前运行上下文缺少 taskId。",
      });
      await expect(tools.task_step_update.execute?.({
        stepId: "missing",
        status: "running",
      }, toolContext)).resolves.toMatchObject({ success: false });
      await expect(tools.task_child_create.execute?.({
        stepId: "missing",
        targetAgentId: "researcher",
        instruction: "work",
      }, toolContext)).resolves.toMatchObject({ success: false });
      await expect(tools.task_dependency_add.execute?.({
        taskId: "a",
        dependsOnTaskId: "b",
      }, toolContext)).resolves.toMatchObject({ success: false });
      await expect(tools.task_dependency_remove.execute?.({
        taskId: "a",
        dependsOnTaskId: "b",
      }, toolContext)).resolves.toMatchObject({ success: false });
    } finally {
      db.close();
    }
  });
});
