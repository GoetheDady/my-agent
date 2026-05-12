import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { AgentConfigService } from "../agents/config-service";
import { FeishuBindingService } from "./feishu-binding-service";

function createTempRoot(): string {
  return mkdtempSync(join(tmpdir(), "my-agent-feishu-binding-"));
}

describe("FeishuBindingService", () => {
  test("stores feishu bindings in agent config", () => {
    const rootDir = createTempRoot();
    try {
      const configService = new AgentConfigService({ rootDir });
      const service = new FeishuBindingService(configService, join(rootDir, "channels", "feishu-bindings.json"));

      service.upsertBinding({
        appId: "cli_test",
        appSecret: "secret",
        agentId: "researcher",
      });

      const agentConfig = JSON.parse(readFileSync(join(rootDir, "agents", "researcher", "agent.json"), "utf8"));
      expect(agentConfig.channels.feishu.bindings.cli_test.appSecret).toBe("secret");
      expect(service.getEnabledBinding("cli_test")).toMatchObject({
        appId: "cli_test",
        agentId: "researcher",
      });
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });

  test("migrates legacy feishu bindings file into agent config", () => {
    const rootDir = createTempRoot();
    try {
      const legacyPath = join(rootDir, "channels", "feishu-bindings.json");
      mkdirSync(dirname(legacyPath), { recursive: true });
      writeFileSync(legacyPath, JSON.stringify({
        bindings: [{
          appId: "cli_legacy",
          appSecret: "secret",
          agentId: "default",
          domain: "feishu",
          enabled: true,
          createdAt: 1,
          updatedAt: 2,
        }],
      }), "utf8");
      const configService = new AgentConfigService({ rootDir });
      const service = new FeishuBindingService(configService, legacyPath);

      expect(service.listBindings()).toHaveLength(1);
      expect(existsSync(legacyPath)).toBe(false);
      expect(configService.getAgentConfig("default").channels.feishu.bindings.cli_legacy.appSecret).toBe("secret");
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });

  test("moves a binding when app is rebound to another agent", () => {
    const rootDir = createTempRoot();
    try {
      const configService = new AgentConfigService({ rootDir });
      const service = new FeishuBindingService(configService, join(rootDir, "channels", "feishu-bindings.json"));

      service.upsertBinding({ appId: "cli_test", appSecret: "secret", agentId: "default" });
      service.upsertBinding({ appId: "cli_test", appSecret: "secret", agentId: "researcher" });

      expect(configService.getAgentConfig("default").channels.feishu.bindings.cli_test).toBeUndefined();
      expect(configService.getAgentConfig("researcher").channels.feishu.bindings.cli_test.appSecret).toBe("secret");
      expect(service.getBinding("cli_test")?.agentId).toBe("researcher");
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });

  test("updates and deletes bindings from agent config", () => {
    const rootDir = createTempRoot();
    try {
      const configService = new AgentConfigService({ rootDir });
      const service = new FeishuBindingService(configService, join(rootDir, "channels", "feishu-bindings.json"));

      service.upsertBinding({ appId: "cli_test", appSecret: "secret", agentId: "default" });
      const disabled = service.updateBinding("cli_test", { enabled: false });
      expect(disabled.enabled).toBe(false);
      expect(configService.getAgentConfig("default").channels.feishu.bindings.cli_test.enabled).toBe(false);

      const deleted = service.deleteBinding("cli_test");
      expect(deleted.appId).toBe("cli_test");
      expect(service.getBinding("cli_test")).toBeNull();
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });
});
