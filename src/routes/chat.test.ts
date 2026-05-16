import { readFileSync } from "fs";
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { ensureDefaultAgent } from "../agents/agent-registry";
import { initializeDatabaseSchema } from "../core/database";
import { DEFAULT_AGENT_SYSTEM_PROMPT } from "../prompts/agent-prompt";
import { createTask, getTask } from "../tasks/task-store";
import { handleBusyWebTask } from "./chat-busy";

const chatRouteSource = readFileSync(new URL("./chat.ts", import.meta.url), "utf8");

describe("chat route memory behavior", () => {
  test("does not fetch or inject prefetched memories before model execution", () => {
    expect(chatRouteSource).not.toContain("getPrefetchedMemories");
    expect(chatRouteSource).not.toContain("queuePrefetch");
    expect(chatRouteSource).not.toContain("<relevant-memories>");
  });

  test("agent prompt documents memory tools without embedding memory content", () => {
    expect(DEFAULT_AGENT_SYSTEM_PROMPT).toContain("记忆工具");
    expect(DEFAULT_AGENT_SYSTEM_PROMPT).not.toContain("<relevant-memories>");
  });

  test("emits lifecycle hook after assistant message is persisted", () => {
    expect(chatRouteSource).toContain("assistant.message.persisted");
    expect(chatRouteSource).toContain("assistantMessageId");
  });

  test("passes optional agentId to ChannelService", () => {
    expect(chatRouteSource).toContain("agentId");
    expect(chatRouteSource).toContain("targetAgentId");
  });

  test("rejects agentId that differs from the session binding", () => {
    expect(chatRouteSource).toContain("agentId 与 session 绑定的 Agent 不一致");
    expect(chatRouteSource).toContain("session.agent_id");
  });

  test("cancels a web task when the stream cannot run because the agent is busy", async () => {
    const db = new Database(":memory:");
    db.run("PRAGMA foreign_keys = ON");
    initializeDatabaseSchema(db);
    ensureDefaultAgent(db);
    const task = createTask({ id: "busy-web-task", source_channel: "web", input: "hello" }, db);

    const response = handleBusyWebTask(task, db);
    const body = await response.json() as { error?: string; taskId?: string };

    expect(response.status).toBe(409);
    expect(body).toMatchObject({
      error: "当前 Agent 正在处理其他任务，请稍后再试。",
      taskId: "busy-web-task",
    });
    expect(getTask("busy-web-task", db)).toMatchObject({
      status: "canceled",
      failure_type: "system_canceled",
      failure_stage: "cancel",
      retriable: false,
    });
    db.close();
  });
});
