import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { ensureDefaultAgent } from "../agents/agent-registry";
import { AgentService } from "../agents/service";
import { AgentConfigService } from "../agents/config-service";
import { ChannelService } from "../channels/service";
import { FeishuBindingService } from "../channels/feishu-binding-service";
import { FeishuChannelAdapter } from "../channels/feishu-channel";
import { WebChannelAdapter } from "../channels/web-channel";
import { WeChatChannelAdapter } from "../channels/wechat-channel";
import { initializeDatabaseSchema } from "../core/database";
import { getTask } from "../tasks/task-store";
import { createChannelRoutes } from "./channels";

function createRouteFixture() {
  const db = new Database(":memory:");
  db.run("PRAGMA foreign_keys = ON");
  initializeDatabaseSchema(db);
  ensureDefaultAgent(db);
  const configService = new AgentConfigService({
    rootDir: `/tmp/my-agent-agent-config-${crypto.randomUUID()}`,
  });
  const agentService = new AgentService({ configService });
  const feishuBindingService = new FeishuBindingService(configService);
  const channelService = new ChannelService({
    database: db,
    adapters: [new WebChannelAdapter(), new FeishuChannelAdapter(feishuBindingService), new WeChatChannelAdapter()],
  });
  const app = createChannelRoutes({
    database: db,
    feishuBindingService,
    agentService,
    channelService,
    externalChannelRunner: async () => undefined,
    feishuWebSocketService: {
      startBinding: async () => undefined,
    },
  });
  return { app, db, feishuBindingService };
}

describe("channel routes", () => {
  test("creates feishu binding without exposing secret", async () => {
    const { app, db } = createRouteFixture();
    try {
      const response = await app.request("/feishu/bindings", {
        method: "POST",
        body: JSON.stringify({ appId: "cli_test", appSecret: "secret", agentId: "default" }),
      });
      const body = await response.json();

      expect(response.status).toBe(201);
      expect(body.binding).toMatchObject({
        appId: "cli_test",
        agentId: "default",
        hasAppSecret: true,
      });
      expect(JSON.stringify(body)).not.toContain("secret");
    } finally {
      db.close();
    }
  });

  test("feishu message creates a target agent task", async () => {
    const { app, db, feishuBindingService } = createRouteFixture();
    feishuBindingService.upsertBinding({
      appId: "cli_test",
      appSecret: "secret",
      agentId: "default",
    });
    try {
      const response = await app.request("/feishu/events", {
        method: "POST",
        body: JSON.stringify({
          header: { app_id: "cli_test", event_type: "im.message.receive_v1" },
          event: {
            sender: { sender_id: { open_id: "ou_user" } },
            message: {
              message_id: "om_msg",
              chat_id: "oc_chat",
              chat_type: "p2p",
              message_type: "text",
              content: JSON.stringify({ text: "hello" }),
            },
          },
        }),
      });
      const body = await response.json();
      const task = getTask(body.taskId, db);

      expect(response.status).toBe(200);
      expect(body).toMatchObject({ code: 0, msg: "ok" });
      expect(task).toMatchObject({
        agent_id: "default",
        source_channel: "feishu",
        source_user_id: "ou_user",
        input: "hello",
      });
    } finally {
      db.close();
    }
  });
});
