import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { AgentConfigService } from "../agents/config-service";
import { AgentService } from "../agents/service";
import { initializeDatabaseSchema } from "../core/database";
import { FeishuBindingService } from "./feishu-binding-service";
import { FeishuOnboardingService } from "./feishu-onboarding-service";

function createFixture() {
  const db = new Database(":memory:");
  db.run("PRAGMA foreign_keys = ON");
  initializeDatabaseSchema(db);
  const rootDir = `/tmp/my-agent-feishu-onboarding-${crypto.randomUUID()}`;
  const configService = new AgentConfigService({ rootDir });
  const agentService = new AgentService({ configService });
  agentService.createAgent({ agentId: "default", name: "Default Agent" }, { database: db });
  const bindingService = new FeishuBindingService(configService, `${rootDir}/channels/feishu-bindings.json`);
  const startedBindings: string[] = [];
  let now = 1_000;
  const fetchCalls: Array<{ url: string; body?: string }> = [];
  const service = new FeishuOnboardingService({
    database: db,
    agentService,
    bindingService,
    websocketService: {
      startBinding: async (binding) => {
        startedBindings.push(binding.appId);
      },
    },
    idFactory: () => "onboard_1",
    now: () => now,
    fetchImpl: async (url, init) => {
      fetchCalls.push({ url: String(url), body: String(init?.body ?? "") });
      if (String(url).includes("/bot/v3/info")) {
        return Response.json({ code: 0, bot: { app_name: "测试机器人", open_id: "ou_bot" } });
      }
      if (String(url).includes("tenant_access_token")) {
        return Response.json({ tenant_access_token: "tenant_token" });
      }
      const body = String(init?.body ?? "");
      if (body.includes("action=init")) {
        return Response.json({ supported_auth_methods: ["client_secret"] });
      }
      if (body.includes("action=begin")) {
        return Response.json({
          device_code: "device_1",
          verification_uri_complete: "https://example.test/scan",
          user_code: "ABCD",
          interval: 1,
          expire_in: 60,
        });
      }
      if (body.includes("action=poll")) {
        return Response.json({
          client_id: "cli_created",
          client_secret: "secret_created",
          user_info: { open_id: "ou_user", tenant_brand: "feishu" },
        });
      }
      return Response.json({});
    },
  });
  return {
    db,
    service,
    bindingService,
    startedBindings,
    fetchCalls,
    advance(ms: number) {
      now += ms;
    },
  };
}

describe("FeishuOnboardingService", () => {
  test("starts onboarding without exposing secrets", async () => {
    const { db, service } = createFixture();
    try {
      const started = await service.start({ agentId: "default" });

      expect(started).toMatchObject({
        onboardingId: "onboard_1",
        status: "pending",
        qrUrl: "https://example.test/scan?from=my-agent&tp=my-agent",
        userCode: "ABCD",
      });
      expect(JSON.stringify(started)).not.toContain("secret");
    } finally {
      db.close();
    }
  });

  test("poll success stores binding and starts websocket", async () => {
    const { db, service, bindingService, startedBindings } = createFixture();
    try {
      await service.start({ agentId: "default" });
      const status = await service.getStatus("onboard_1");

      expect(status.status).toBe("succeeded");
      expect(status.binding).toMatchObject({
        appId: "cli_created",
        agentId: "default",
        hasAppSecret: true,
        botName: "测试机器人",
      });
      expect(JSON.stringify(status)).not.toContain("secret_created");
      expect(bindingService.getBinding("cli_created")).toMatchObject({
        appId: "cli_created",
        appSecret: "secret_created",
        botName: "测试机器人",
      });
      expect(startedBindings).toEqual(["cli_created"]);
    } finally {
      db.close();
    }
  });

  test("expired onboarding does not create binding", async () => {
    const { db, service, bindingService, advance } = createFixture();
    try {
      await service.start({ agentId: "default" });
      advance(61_000);
      const status = await service.getStatus("onboard_1");

      expect(status.status).toBe("expired");
      expect(bindingService.getBinding("cli_created")).toBeNull();
    } finally {
      db.close();
    }
  });
});
