import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { ensureDefaultAgent } from "../agents/agent-registry";
import { AgentConfigService } from "../agents/config-service";
import { initializeDatabaseSchema } from "../core/database";
import { listAgentEvents } from "../events/event-log";
import { FeishuBindingService } from "./feishu-binding-service";
import { FeishuChannelAdapter } from "./feishu-channel";

function createFeishuAdapterFixture(options: {
  sdkCode?: number;
  sdkMsg?: string;
  throwError?: Error;
} = {}) {
  const db = new Database(":memory:");
  db.run("PRAGMA foreign_keys = ON");
  initializeDatabaseSchema(db);
  ensureDefaultAgent(db);
  const configService = new AgentConfigService({
    rootDir: `/tmp/my-agent-feishu-channel-${crypto.randomUUID()}`,
  });
  const bindingService = new FeishuBindingService(configService);
  bindingService.upsertBinding({
    appId: "cli_test",
    appSecret: "secret_test",
    agentId: "default",
    domain: "feishu",
    enabled: true,
  }, { database: db });
  const calls: Array<{ method: "create" | "reply"; payload: unknown }> = [];
  const adapter = new FeishuChannelAdapter(bindingService, () => ({
    im: {
      v1: {
        message: {
          create: async (payload) => {
            calls.push({ method: "create", payload });
            if (options.throwError) throw options.throwError;
            return { code: options.sdkCode ?? 0, msg: options.sdkMsg, data: { message_id: "om_created" } };
          },
          reply: async (payload) => {
            calls.push({ method: "reply", payload });
            if (options.throwError) throw options.throwError;
            return { code: options.sdkCode ?? 0, msg: options.sdkMsg, data: { message_id: "om_reply" } };
          },
        },
      },
    },
  }), db);
  return { adapter, calls, db };
}

describe("FeishuChannelAdapter", () => {
  test("uses SDK reply API with post content when messageId is present", async () => {
    const { adapter, calls, db } = createFeishuAdapterFixture();
    try {
      await adapter.deliver({
        channel: "feishu",
        conversationId: "oc_chat",
        text: "**hello**",
        metadata: { appId: "cli_test", chatId: "oc_chat", messageId: "om_inbound" },
      });

      expect(calls).toHaveLength(1);
      const expectedContent = JSON.stringify({
        zh_cn: {
          title: "",
          content: [[{ tag: "text", text: "hello", style: ["bold"] }]],
        },
      });
      expect(calls[0]).toEqual({
        method: "reply",
        payload: {
          path: { message_id: "om_inbound" },
          data: {
            msg_type: "post",
            content: expectedContent,
          },
        },
      });
    } finally {
      db.close();
    }
  });

  test("uses SDK create API for explicit text messages", async () => {
    const { adapter, calls, db } = createFeishuAdapterFixture();
    try {
      await adapter.deliver({
        channel: "feishu",
        conversationId: "oc_chat",
        text: "hello",
        metadata: { appId: "cli_test", chatId: "oc_chat", messageType: "text" },
      });

      expect(calls).toHaveLength(1);
      expect(calls[0]).toEqual({
        method: "create",
        payload: {
          params: { receive_id_type: "chat_id" },
          data: {
            receive_id: "oc_chat",
            msg_type: "text",
            content: JSON.stringify({ text: "hello" }),
          },
        },
      });
    } finally {
      db.close();
    }
  });

  test("sends interactive card content through SDK message API", async () => {
    const { adapter, calls, db } = createFeishuAdapterFixture();
    const card = {
      config: { update_multi: true },
      elements: [{ tag: "markdown", content: "确认工具调用" }],
    };
    try {
      await adapter.deliver({
        channel: "feishu",
        conversationId: "oc_chat",
        text: "fallback",
        metadata: {
          appId: "cli_test",
          chatId: "oc_chat",
          messageType: "interactive",
          card,
        },
      });

      expect(calls[0]).toEqual({
        method: "create",
        payload: {
          params: { receive_id_type: "chat_id" },
          data: {
            receive_id: "oc_chat",
            msg_type: "interactive",
            content: JSON.stringify(card),
          },
        },
      });
    } finally {
      db.close();
    }
  });

  test("writes completed event without exposing appSecret", async () => {
    const { adapter, db } = createFeishuAdapterFixture();
    try {
      await adapter.deliver({
        channel: "feishu",
        conversationId: "oc_chat",
        text: "hello",
        metadata: { appId: "cli_test", chatId: "oc_chat" },
      });

      const events = listAgentEvents("default", 10, db);
      const deliveryEvent = events.find((event) => event.type === "channel.delivery.completed");
      expect(deliveryEvent).toBeDefined();
      expect(JSON.parse(deliveryEvent?.payload ?? "{}")).toMatchObject({
        channel: "feishu",
        appId: "cli_test",
        chatId: "oc_chat",
        messageId: "om_created",
        messageType: "post",
      });
      expect(deliveryEvent?.payload).not.toContain("secret_test");
    } finally {
      db.close();
    }
  });

  test("writes failed event and throws clear error on SDK failure", async () => {
    const { adapter, db } = createFeishuAdapterFixture({ sdkCode: 999, sdkMsg: "bad request" });
    try {
      await expect(adapter.deliver({
        channel: "feishu",
        conversationId: "oc_chat",
        text: "hello",
        metadata: { appId: "cli_test", chatId: "oc_chat" },
      })).rejects.toThrow("Feishu delivery failed: bad request");

      const events = listAgentEvents("default", 10, db);
      const failedEvent = events.find((event) => event.type === "channel.delivery.failed");
      expect(failedEvent).toBeDefined();
      expect(JSON.parse(failedEvent?.payload ?? "{}")).toMatchObject({
        channel: "feishu",
        appId: "cli_test",
        chatId: "oc_chat",
        messageType: "post",
        error: "bad request",
      });
      expect(failedEvent?.payload).not.toContain("secret_test");
    } finally {
      db.close();
    }
  });

  test("converts thrown SDK errors to delivery failures", async () => {
    const { adapter, db } = createFeishuAdapterFixture({ throwError: new Error("network down") });
    try {
      await expect(adapter.deliver({
        channel: "feishu",
        conversationId: "oc_chat",
        text: "hello",
        metadata: { appId: "cli_test", chatId: "oc_chat" },
      })).rejects.toThrow("Feishu delivery failed: network down");
    } finally {
      db.close();
    }
  });
});
