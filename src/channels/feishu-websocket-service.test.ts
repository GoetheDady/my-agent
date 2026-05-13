import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { ensureDefaultAgent } from "../agents/agent-registry";
import { AgentConfigService } from "../agents/config-service";
import { initializeDatabaseSchema } from "../core/database";
import { getTask } from "../tasks/task-store";
import { FeishuBindingService } from "./feishu-binding-service";
import { FeishuChannelAdapter } from "./feishu-channel";
import { FeishuWebSocketService } from "./feishu-websocket-service";
import { ChannelService } from "./service";
import { WebChannelAdapter } from "./web-channel";
import { WeChatChannelAdapter } from "./wechat-channel";

function createDb(): Database {
  const db = new Database(":memory:");
  db.run("PRAGMA foreign_keys = ON");
  initializeDatabaseSchema(db);
  ensureDefaultAgent(db);
  return db;
}

describe("FeishuWebSocketService", () => {
  test("starts enabled bindings and dispatches websocket messages", async () => {
    const db = createDb();
    const configService = new AgentConfigService({ rootDir: `/tmp/my-agent-feishu-ws-${crypto.randomUUID()}` });
    const bindingService = new FeishuBindingService(configService);
    bindingService.upsertBinding({ appId: "cli_test", appSecret: "secret", agentId: "default" });
    let eventHandler: ((data: unknown) => Promise<void>) | undefined;
    const channelService = new ChannelService({
      database: db,
      adapters: [new WebChannelAdapter(), new FeishuChannelAdapter(bindingService), new WeChatChannelAdapter()],
    });
    const service = new FeishuWebSocketService({
      database: db,
      bindingService,
      channelService,
      externalChannelRunner: async () => undefined,
      clientFactory: () => ({
        async start(params: { eventDispatcher: { handles?: Record<string, (data: unknown) => Promise<void>> | Map<string, (data: unknown) => Promise<void>> } }) {
          const handles = params.eventDispatcher.handles;
          eventHandler = handles instanceof Map ? handles.get("im.message.receive_v1") : handles?.["im.message.receive_v1"];
        },
        close() {},
      }),
    });

    try {
      await service.startAll();
      await eventHandler?.({
        app_id: "cli_test",
        event_type: "im.message.receive_v1",
        sender: { sender_id: { open_id: "ou_user" }, sender_type: "user" },
        message: {
          message_id: "om_msg",
          chat_id: "oc_chat",
          chat_type: "p2p",
          message_type: "text",
          content: JSON.stringify({ text: "hello via ws" }),
        },
      });
      const task = db
        .query<{ id: string }, []>("SELECT id FROM tasks LIMIT 1")
        .get();

      expect(service.isRunning("cli_test")).toBe(true);
      expect(service.getBindingStatus("cli_test")).toBe("running");
      expect(service.stopBinding("cli_test")).toBe(true);
      expect(service.getBindingStatus("cli_test")).toBe("stopped");
      expect(task ? getTask(task.id, db) : null).toMatchObject({
        agent_id: "default",
        source_channel: "feishu",
        source_user_id: "ou_user",
        input: "hello via ws",
      });
    } finally {
      db.close();
    }
  });

  test("registers card action callback handler", async () => {
    const db = createDb();
    const configService = new AgentConfigService({ rootDir: `/tmp/my-agent-feishu-ws-card-${crypto.randomUUID()}` });
    const bindingService = new FeishuBindingService(configService);
    bindingService.upsertBinding({ appId: "cli_test", appSecret: "secret", agentId: "default" });
    let cardHandler: ((data: unknown) => Promise<void>) | undefined;
    const channelService = new ChannelService({
      database: db,
      adapters: [new WebChannelAdapter(), new FeishuChannelAdapter(bindingService), new WeChatChannelAdapter()],
    });
    const service = new FeishuWebSocketService({
      database: db,
      bindingService,
      channelService,
      externalChannelRunner: async () => undefined,
      clientFactory: () => ({
        async start(params: { eventDispatcher: { handles?: Record<string, (data: unknown) => Promise<void>> | Map<string, (data: unknown) => Promise<void>> } }) {
          const handles = params.eventDispatcher.handles;
          cardHandler = handles instanceof Map ? handles.get("card.action.trigger") : handles?.["card.action.trigger"];
        },
        close() {},
      }),
    });

    try {
      await service.startAll();
      expect(cardHandler).toBeTypeOf("function");
    } finally {
      db.close();
    }
  });
});
