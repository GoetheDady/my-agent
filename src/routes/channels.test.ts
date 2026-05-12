import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { ensureDefaultAgent } from "../agents/agent-registry";
import { AgentService } from "../agents/service";
import { AgentConfigService } from "../agents/config-service";
import { ChannelService } from "../channels/service";
import { FeishuBindingService } from "../channels/feishu-binding-service";
import { FeishuChannelAdapter } from "../channels/feishu-channel";
import { FeishuOnboardingService } from "../channels/feishu-onboarding-service";
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
  const stoppedBindings: string[] = [];
  const startedBindings: string[] = [];
  const feishuWebSocketService = {
    startBinding: async (binding: { appId: string }) => {
      startedBindings.push(binding.appId);
    },
    stopBinding: (appId: string) => {
      stoppedBindings.push(appId);
      return true;
    },
    getBindingStatus: (appId: string) => startedBindings.includes(appId) && !stoppedBindings.includes(appId) ? "running" as const : "stopped" as const,
  };
  const feishuOnboardingService = new FeishuOnboardingService({
    database: db,
    bindingService: feishuBindingService,
    agentService,
    websocketService: feishuWebSocketService,
    idFactory: () => "onboard_route",
    fetchImpl: async (_url, init) => {
      const body = String(init?.body ?? "");
      if (body.includes("action=init")) return Response.json({ supported_auth_methods: ["client_secret"] });
      if (body.includes("action=begin")) {
        return Response.json({
          device_code: "device_route",
          verification_uri_complete: "https://example.test/scan",
          user_code: "ROUTE",
          interval: 1,
          expire_in: 60,
        });
      }
      if (body.includes("action=poll")) {
        return Response.json({
          client_id: "cli_route",
          client_secret: "secret_route",
          user_info: { open_id: "ou_route" },
        });
      }
      return Response.json({ code: 0, bot: { app_name: "Route Bot" } });
    },
  });
  const app = createChannelRoutes({
    database: db,
    feishuBindingService,
    feishuOnboardingService,
    agentService,
    channelService,
    externalChannelRunner: async () => undefined,
    feishuWebSocketService,
  });
  return { app, db, feishuBindingService, startedBindings, stoppedBindings };
}

describe("channel routes", () => {
  test("creates feishu binding without exposing secret", async () => {
    const { app, db, startedBindings } = createRouteFixture();
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
      expect(startedBindings).toEqual(["cli_test"]);
    } finally {
      db.close();
    }
  });

  test("lists channels and manages feishu binding lifecycle", async () => {
    const { app, db, stoppedBindings } = createRouteFixture();
    try {
      await app.request("/feishu/bindings", {
        method: "POST",
        body: JSON.stringify({ appId: "cli_test", appSecret: "secret", agentId: "default" }),
      });

      const listResponse = await app.request("/");
      const listBody = await listResponse.json();
      expect(listBody.channels.find((channel: { id: string }) => channel.id === "feishu")).toMatchObject({
        bindingCount: 1,
        enabledCount: 1,
      });

      const patchResponse = await app.request("/feishu/bindings/cli_test", {
        method: "PATCH",
        body: JSON.stringify({ enabled: false }),
      });
      const patchBody = await patchResponse.json();
      expect(patchResponse.status).toBe(200);
      expect(patchBody.binding.enabled).toBe(false);
      expect(stoppedBindings).toContain("cli_test");

      const deleteResponse = await app.request("/feishu/bindings/cli_test", { method: "DELETE" });
      expect(deleteResponse.status).toBe(200);
      const bindingsResponse = await app.request("/feishu/bindings");
      const bindingsBody = await bindingsResponse.json();
      expect(bindingsBody.bindings).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  test("feishu onboarding creates binding without exposing secret", async () => {
    const { app, db, feishuBindingService, startedBindings } = createRouteFixture();
    try {
      const startResponse = await app.request("/feishu/onboarding/start", {
        method: "POST",
        body: JSON.stringify({ agentId: "default", domain: "feishu" }),
      });
      const startBody = await startResponse.json();
      expect(startResponse.status).toBe(201);
      expect(startBody).toMatchObject({
        onboardingId: "onboard_route",
        status: "pending",
        userCode: "ROUTE",
      });

      const statusResponse = await app.request("/feishu/onboarding/onboard_route/status");
      const statusBody = await statusResponse.json();
      expect(statusResponse.status).toBe(200);
      expect(statusBody).toMatchObject({
        status: "succeeded",
        binding: { appId: "cli_route", hasAppSecret: true },
      });
      expect(JSON.stringify(statusBody)).not.toContain("secret_route");
      expect(feishuBindingService.getBinding("cli_route")?.appSecret).toBe("secret_route");
      expect(startedBindings).toContain("cli_route");
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
