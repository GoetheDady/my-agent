import { beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { ensureDefaultAgent } from "../agents/agent-registry";
import { defaultAgentService } from "../agents/service";
import { initializeDatabaseSchema } from "../core/database";
import { getUnmetTaskDependencies, listTaskDependencies, setTaskPlan } from "../tasks/task-plan-store";
import { createTask, getTask } from "../tasks/task-store";
import { DelegationService } from "./service";

function createDb(): Database {
  const db = new Database(":memory:");
  db.run("PRAGMA foreign_keys = ON");
  initializeDatabaseSchema(db);
  ensureDefaultAgent(db);
  defaultAgentService.createAgent({
    agentId: "researcher",
    name: "Researcher",
  }, { database: db });
  return db;
}

describe("DelegationService", () => {
  let db: Database;

  beforeEach(() => {
    db = createDb();
  });

  test("delegateTask creates delegation and child task without waiting for child completion", () => {
    const parentTask = createTask({
      agent_id: "default",
      source_channel: "web",
      source_user_id: "default",
      input: "让 researcher 总结项目",
    }, db);
    const service = new DelegationService({
      database: db,
      internalRunner: async ({ task }) => ({ task, text: "unused" }),
      autoStart: false,
    });

    const delegation = service.delegateTask({
      parentAgentId: "default",
      parentTaskId: parentTask.id,
      parentSessionId: "session-1",
      parentConversationId: "conversation-1",
      sourceChannel: "web",
      sourceUserId: "default",
      targetAgentId: "researcher",
      instruction: "总结项目架构",
    });

    expect(delegation.status).toBe("queued");
    expect(delegation.childAgentId).toBe("researcher");
    expect(getTask(delegation.childTaskId, db)?.status).toBe("queued");
  });

  test("delegateTask can bind a child task to a plan step", () => {
    const parentTask = createTask({
      agent_id: "default",
      source_channel: "web",
      source_user_id: "default",
      input: "委派",
    }, db);
    const [step] = setTaskPlan(parentTask.id, [{ title: "研究", detail: "交给 researcher" }], db);
    const service = new DelegationService({ database: db, autoStart: false });

    const delegation = service.delegateTask({
      parentAgentId: "default",
      parentTaskId: parentTask.id,
      sourceChannel: "web",
      sourceUserId: "default",
      targetAgentId: "researcher",
      instruction: "研究实现",
      planStepId: step.id,
    });

    expect(getTask(delegation.childTaskId, db)).toMatchObject({
      parent_task_id: parentTask.id,
      plan_step_id: step.id,
      source_channel: "delegation",
    });
  });

  test("delegateTask writes dependencies before auto-start can claim the child", async () => {
    const parentTask = createTask({
      agent_id: "default",
      source_channel: "web",
      source_user_id: "default",
      input: "委派",
    }, db);
    const blocker = createTask({
      id: "blocker",
      agent_id: "researcher",
      parent_task_id: parentTask.id,
      source_channel: "web",
      source_user_id: "default",
      input: "blocker",
    }, db);
    const calls: string[] = [];
    const service = new DelegationService({
      database: db,
      autoStart: true,
      internalRunner: async ({ task }) => {
        calls.push(task.id);
        return { task, text: "ran" };
      },
    });

    const delegation = service.delegateTask({
      parentAgentId: "default",
      parentTaskId: parentTask.id,
      sourceChannel: "web",
      sourceUserId: "default",
      targetAgentId: "researcher",
      instruction: "blocked child",
      dependsOnTaskIds: [blocker.id],
    });
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(listTaskDependencies(delegation.childTaskId, db)).toMatchObject([
      { task_id: delegation.childTaskId, depends_on_task_id: blocker.id },
    ]);
    expect(getUnmetTaskDependencies(delegation.childTaskId, db)).toHaveLength(1);
    expect(calls).toEqual([]);
    expect(getTask(delegation.childTaskId, db)?.status).toBe("queued");
  });

  test("rejects self delegation and missing target agent", () => {
    const parentTask = createTask({
      agent_id: "default",
      source_channel: "web",
      source_user_id: "default",
      input: "委派",
    }, db);
    const service = new DelegationService({ database: db, autoStart: false });

    expect(() => service.delegateTask({
      parentAgentId: "default",
      parentTaskId: parentTask.id,
      sourceChannel: "web",
      sourceUserId: "default",
      targetAgentId: "default",
      instruction: "自己做",
    })).toThrow("不能把任务委派给自己");

    expect(() => service.delegateTask({
      parentAgentId: "default",
      parentTaskId: parentTask.id,
      sourceChannel: "web",
      sourceUserId: "default",
      targetAgentId: "missing",
      instruction: "不存在",
    })).toThrow("Target agent not found");
  });

  test("child completion creates callback task and appends final web message", async () => {
    const parentTask = createTask({
      agent_id: "default",
      source_channel: "web",
      source_user_id: "default",
      input: "委派",
    }, db);
    db.run("INSERT INTO sessions (id, agent_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)", [
      "session-1",
      "default",
      "测试",
      1,
      1,
    ]);
    const service = new DelegationService({
      database: db,
      autoStart: false,
      internalRunner: async ({ task }) => {
        if (task.source_channel === "delegation") return { task, text: "子 Agent 结果" };
        return { task, text: "父 Agent 整理后的回复" };
      },
    });
    const delegation = service.delegateTask({
      parentAgentId: "default",
      parentTaskId: parentTask.id,
      parentSessionId: "session-1",
      parentConversationId: "conversation-1",
      sourceChannel: "web",
      sourceUserId: "default",
      targetAgentId: "researcher",
      instruction: "总结",
    });

    await service.drainAgent("researcher");
    await service.drainAgent("default");

    const updated = service.getDelegation(delegation.id);
    expect(updated?.status).toBe("completed");
    expect(updated?.callbackTaskId).toBeTruthy();
    const message = db.query<{ content: string }, []>("SELECT content FROM messages WHERE session_id = 'session-1'").get();
    expect(message?.content).toContain("父 Agent 整理后的回复");
  });

  test("child completion still creates callback task when child returns empty text", async () => {
    const parentTask = createTask({
      agent_id: "default",
      source_channel: "web",
      source_user_id: "default",
      input: "委派",
    }, db);
    db.run("INSERT INTO sessions (id, agent_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)", [
      "session-empty",
      "default",
      "测试",
      1,
      1,
    ]);
    const service = new DelegationService({
      database: db,
      autoStart: false,
      internalRunner: async ({ task }) => {
        if (task.source_channel === "delegation") return { task, text: "" };
        return { task, text: "子 Agent 没有返回可用文本结果。" };
      },
    });
    const delegation = service.delegateTask({
      parentAgentId: "default",
      parentTaskId: parentTask.id,
      parentSessionId: "session-empty",
      parentConversationId: "conversation-empty",
      sourceChannel: "web",
      sourceUserId: "default",
      targetAgentId: "researcher",
      instruction: "总结",
    });

    await service.drainAgent("researcher");
    await service.drainAgent("default");

    const updated = service.getDelegation(delegation.id);
    expect(updated?.callbackTaskId).toBeTruthy();
    const message = db.query<{ content: string }, []>("SELECT content FROM messages WHERE session_id = 'session-empty'").get();
    expect(message?.content).toContain("没有返回可用文本结果");
  });
});
