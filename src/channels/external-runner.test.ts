import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { ensureDefaultAgent, updateAgentStatus } from "../agents/agent-registry";
import { AgentConfigService } from "../agents/config-service";
import { initializeDatabaseSchema } from "../core/database";
import { appendEvent, listTaskEvents } from "../events/event-log";
import { createTask, getTask } from "../tasks/task-store";
import { ApprovalService } from "../tools/approval-service";
import { drainExternalChannelQueue, getTaskChannelMetadata, runExternalChannelTask } from "./external-runner";
import type { ChannelMessageOutput, ChannelReceiveResult } from "./types";

function createRunnerDb(): Database {
  const db = new Database(":memory:");
  db.run("PRAGMA foreign_keys = ON");
  initializeDatabaseSchema(db);
  ensureDefaultAgent(db);
  return db;
}

function createReceived(taskId: string, db: Database): ChannelReceiveResult {
  const task = getTask(taskId, db);
  if (!task) throw new Error(`Task missing: ${taskId}`);
  return {
    channel: task.source_channel,
    agentId: task.agent_id,
    userId: task.source_user_id,
    conversationId: task.conversation_id ?? "conversation-1",
    task,
  };
}

function appendInboundEvent(taskId: string, db: Database, metadata: Record<string, unknown>): void {
  const task = getTask(taskId, db);
  if (!task) throw new Error(`Task missing: ${taskId}`);
  appendEvent({
    agent_id: task.agent_id,
    task_id: task.id,
    conversation_id: task.conversation_id,
    type: "channel.inbound.received",
    payload: {
      channel: task.source_channel,
      ...metadata,
    },
  }, db);
}

function createDeliveringChannelService(deliveries: ChannelMessageOutput[]) {
  return {
    async deliverMessage(output: ChannelMessageOutput): Promise<void> {
      deliveries.push(output);
    },
  };
}

function createTextGenerator(texts: string[]) {
  let index = 0;
  return (async () => {
    const text = texts[index] ?? texts.at(-1) ?? "done";
    index += 1;
    return {
      text,
      content: [{ type: "text", text }],
      response: { messages: [{ role: "assistant", content: [{ type: "text", text }] }] },
    };
  }) as never;
}

describe("external channel runner", () => {
  test("notifies Feishu immediately when a task starts processing", async () => {
    const db = createRunnerDb();
    const deliveries: ChannelMessageOutput[] = [];
    const task = createTask({
      id: "feishu-task-1",
      conversation_id: "conversation-1",
      source_channel: "feishu",
      source_user_id: "ou_user",
      input: "hello",
    }, db);
    try {
      await runExternalChannelTask({
        received: createReceived(task.id, db),
        userText: "hello",
        deliverMetadata: { appId: "cli_test", chatId: "oc_chat", messageId: "om_1" },
        database: db,
        approvalService: new ApprovalService(db, new AgentConfigService({ rootDir: `/tmp/my-agent-runner-${crypto.randomUUID()}` })),
        channelService: createDeliveringChannelService(deliveries) as never,
        generateTextRunner: createTextGenerator(["final answer"]),
      });

      expect(deliveries[0]).toMatchObject({
        channel: "feishu",
        text: "已收到，正在处理。",
        metadata: { appId: "cli_test", chatId: "oc_chat", messageId: "om_1", messageType: "text" },
      });
      expect(deliveries.at(-1)).toMatchObject({
        channel: "feishu",
        text: "final answer",
      });
      expect(getTask(task.id, db)).toMatchObject({ status: "completed", result: "final answer" });
      expect(listTaskEvents(task.id, db).map((event) => event.type)).toContain("task.processing.notified");
    } finally {
      db.close();
    }
  });

  test("keeps task queued and notifies Feishu when agent is busy", async () => {
    const db = createRunnerDb();
    const deliveries: ChannelMessageOutput[] = [];
    const task = createTask({
      id: "feishu-task-queued",
      conversation_id: "conversation-1",
      source_channel: "feishu",
      source_user_id: "ou_user",
      input: "queued",
    }, db);
    updateAgentStatus("default", "running", "other-task", db);
    try {
      await runExternalChannelTask({
        received: createReceived(task.id, db),
        userText: "queued",
        deliverMetadata: { appId: "cli_test", chatId: "oc_chat", messageId: "om_queued" },
        database: db,
        approvalService: new ApprovalService(db, new AgentConfigService({ rootDir: `/tmp/my-agent-runner-${crypto.randomUUID()}` })),
        channelService: createDeliveringChannelService(deliveries) as never,
        generateTextRunner: createTextGenerator(["should not run"]),
      });

      expect(getTask(task.id, db)).toMatchObject({ status: "queued", error: null });
      expect(deliveries).toHaveLength(1);
      expect(deliveries[0].text).toContain("已排队");
      expect(deliveries[0].text).toContain("前面还有 0 条");
      expect(listTaskEvents(task.id, db).map((event) => event.type)).toContain("task.queued.notified");
      expect(listTaskEvents(task.id, db).map((event) => event.type)).not.toContain("task.failed");
    } finally {
      db.close();
    }
  });

  test("drains queued Feishu tasks after the running task completes", async () => {
    const db = createRunnerDb();
    const deliveries: ChannelMessageOutput[] = [];
    const first = createTask({
      id: "feishu-task-first",
      conversation_id: "conversation-1",
      source_channel: "feishu",
      source_user_id: "ou_user",
      input: "first",
      created_at: 1,
    }, db);
    const second = createTask({
      id: "feishu-task-second",
      conversation_id: "conversation-2",
      source_channel: "feishu",
      source_user_id: "ou_user",
      input: "second",
      created_at: 2,
    }, db);
    appendInboundEvent(second.id, db, { appId: "cli_test", chatId: "oc_second", messageId: "om_second" });
    try {
      await runExternalChannelTask({
        received: createReceived(first.id, db),
        userText: "first",
        deliverMetadata: { appId: "cli_test", chatId: "oc_first", messageId: "om_first" },
        database: db,
        approvalService: new ApprovalService(db, new AgentConfigService({ rootDir: `/tmp/my-agent-runner-${crypto.randomUUID()}` })),
        channelService: createDeliveringChannelService(deliveries) as never,
        generateTextRunner: createTextGenerator(["first done", "second done"]),
      });

      expect(getTask(first.id, db)).toMatchObject({ status: "completed", result: "first done" });
      expect(getTask(second.id, db)).toMatchObject({ status: "completed", result: "second done" });
      expect(deliveries.map((delivery) => delivery.text)).toEqual([
        "已收到，正在处理。",
        "first done",
        "已收到，正在处理。",
        "second done",
      ]);
      expect(deliveries.at(-1)?.metadata).toMatchObject({
        appId: "cli_test",
        chatId: "oc_second",
        messageId: "om_second",
      });
    } finally {
      db.close();
    }
  });

  test("restores Feishu delivery metadata from channel inbound event", async () => {
    const db = createRunnerDb();
    const task = createTask({
      id: "feishu-task-metadata",
      conversation_id: "conversation-1",
      source_channel: "feishu",
      source_user_id: "ou_user",
      input: "metadata",
    }, db);
    try {
      appendInboundEvent(task.id, db, {
        appId: "cli_test",
        chatId: "oc_chat",
        messageId: "om_1",
        chatType: "p2p",
      });

      expect(getTaskChannelMetadata(task.id, db)).toEqual({
        channel: "feishu",
        appId: "cli_test",
        chatId: "oc_chat",
        messageId: "om_1",
        chatType: "p2p",
        rawEventType: undefined,
      });
    } finally {
      db.close();
    }
  });

  test("drainExternalChannelQueue does not claim web tasks", async () => {
    const db = createRunnerDb();
    const deliveries: ChannelMessageOutput[] = [];
    const webTask = createTask({
      id: "web-task",
      conversation_id: "session-1",
      source_channel: "web",
      source_user_id: "user",
      input: "web",
    }, db);
    try {
      await drainExternalChannelQueue("default", {
        database: db,
        approvalService: new ApprovalService(db, new AgentConfigService({ rootDir: `/tmp/my-agent-runner-${crypto.randomUUID()}` })),
        channelService: createDeliveringChannelService(deliveries) as never,
        generateTextRunner: createTextGenerator(["should not run"]),
      });

      expect(getTask(webTask.id, db)).toMatchObject({ status: "queued" });
      expect(deliveries).toEqual([]);
    } finally {
      db.close();
    }
  });
});
