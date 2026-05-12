import type { Database } from "bun:sqlite";
import type { Context } from "hono";
import { Hono } from "hono";
import { defaultAgentService, type AgentService } from "../agents/service";
import { dispatchFeishuMessage, type ExternalChannelRunner } from "../channels/feishu-dispatch";
import { defaultFeishuBindingService, type FeishuBindingService } from "../channels/feishu-binding-service";
import { parseFeishuEvent } from "../channels/feishu-events";
import { defaultFeishuOnboardingService, type FeishuOnboardingService } from "../channels/feishu-onboarding-service";
import { defaultFeishuWebSocketService, type FeishuWebSocketService } from "../channels/feishu-websocket-service";
import { runExternalChannelTask } from "../channels/external-runner";
import { defaultChannelService, type ChannelService } from "../channels/service";
import { getDb } from "../core/database";
import { appendEvent } from "../events/event-log";

type FeishuWebSocketManager = Pick<FeishuWebSocketService, "startBinding" | "stopBinding" | "getBindingStatus">;

function isFeishuDomain(value: unknown): value is "feishu" | "lark" {
  return value === "feishu" || value === "lark";
}

function sanitizeBody(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function jsonError(c: Context, error: unknown, fallback: string, status: 400 | 404 = 400) {
  return c.json({ error: error instanceof Error ? error.message : fallback }, status);
}

export function createChannelRoutes(
  options: {
    database?: Database;
    feishuBindingService?: FeishuBindingService;
    feishuOnboardingService?: FeishuOnboardingService;
    agentService?: AgentService;
    channelService?: ChannelService;
    externalChannelRunner?: ExternalChannelRunner;
    feishuWebSocketService?: FeishuWebSocketManager;
  } = {},
): Hono {
  const app = new Hono();
  const database = options.database ?? getDb();
  const feishuBindingService = options.feishuBindingService ?? defaultFeishuBindingService;
  const feishuOnboardingService = options.feishuOnboardingService ?? defaultFeishuOnboardingService;
  const agentService = options.agentService ?? defaultAgentService;
  const channelService = options.channelService ?? defaultChannelService;
  const externalChannelRunner = options.externalChannelRunner ?? runExternalChannelTask;
  const feishuWebSocketService = options.feishuWebSocketService ?? defaultFeishuWebSocketService;

  app.get("/", (c) => {
    const bindings = feishuBindingService.listPublicBindings();
    const enabledBindings = bindings.filter((binding) => binding.enabled);
    const runningBindings = bindings.filter((binding) => feishuWebSocketService.getBindingStatus(binding.appId) === "running");
    return c.json({
      channels: [
        {
          id: "web",
          name: "Web",
          status: "enabled",
          bindingCount: 1,
          enabledCount: 1,
          runningCount: 1,
        },
        {
          id: "feishu",
          name: "Feishu",
          status: bindings.length > 0 ? "enabled" : "not_configured",
          bindingCount: bindings.length,
          enabledCount: enabledBindings.length,
          runningCount: runningBindings.length,
          transport: "websocket",
        },
        {
          id: "wechat",
          name: "WeChat",
          status: "reserved",
          bindingCount: 0,
          enabledCount: 0,
          runningCount: 0,
        },
      ],
    });
  });

  app.get("/feishu/bindings", (c) => {
    const bindings = feishuBindingService.listPublicBindings().map((binding) => ({
      ...binding,
      websocketStatus: feishuWebSocketService.getBindingStatus(binding.appId),
    }));
    return c.json({ bindings });
  });

  app.post("/feishu/bindings", async (c) => {
    const body = sanitizeBody(await c.req.json().catch(() => ({})));
    const appId = String(body.appId ?? "").trim();
    const appSecret = String(body.appSecret ?? "").trim();
    if (!appId || !appSecret) {
      return c.json({ error: "缺少 appId 或 appSecret" }, 400);
    }
    const agentId = String(body.agentId ?? "default").trim() || "default";
    if (!agentService.getAgent(agentId, { database })) {
      return c.json({ error: `Agent not found: ${agentId}` }, 404);
    }

    const binding = feishuBindingService.upsertBinding({
      appId,
      appSecret,
      agentId,
      domain: isFeishuDomain(body.domain) ? body.domain : undefined,
      verificationToken: typeof body.verificationToken === "string" ? body.verificationToken : undefined,
      encryptKey: typeof body.encryptKey === "string" ? body.encryptKey : undefined,
      enabled: true,
    }, { agentId, database });
    appendEvent({
      agent_id: binding.agentId,
      type: "channel.binding.updated",
      payload: {
        channel: "feishu",
        appId: binding.appId,
        agentId: binding.agentId,
        domain: binding.domain,
        action: "manual_bind",
        hasAppSecret: true,
      },
    }, database);
    void feishuWebSocketService.startBinding(binding).catch((error) => {
      appendEvent({
        agent_id: binding.agentId,
        type: "channel.delivery.failed",
        payload: {
          channel: "feishu",
          transport: "websocket",
          appId: binding.appId,
          error: error instanceof Error ? error.message : String(error),
        },
      }, database);
    });
    return c.json({
      binding: {
        ...feishuBindingService.toPublicBinding(binding),
        websocketStatus: feishuWebSocketService.getBindingStatus(binding.appId),
      },
      transport: "websocket",
      note: "飞书默认使用 WebSocket 长连接，不需要配置事件回调 URL；/api/channels/feishu/events 仅保留为调试入口。",
    }, 201);
  });

  app.patch("/feishu/bindings/:appId", async (c) => {
    const appId = c.req.param("appId");
    const body = sanitizeBody(await c.req.json().catch(() => ({})));
    const nextAgentId = typeof body.agentId === "string" && body.agentId.trim() ? body.agentId.trim() : undefined;
    if (nextAgentId && !agentService.getAgent(nextAgentId, { database })) {
      return c.json({ error: `Agent not found: ${nextAgentId}` }, 404);
    }
    try {
      const existing = feishuBindingService.getBinding(appId);
      if (!existing) return c.json({ error: `Feishu binding not found: ${appId}` }, 404);
      if (body.enabled === false) {
        feishuWebSocketService.stopBinding(existing.appId);
      }
      const binding = feishuBindingService.updateBinding(appId, {
        agentId: nextAgentId,
        enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
        domain: isFeishuDomain(body.domain) ? body.domain : undefined,
        verificationToken: typeof body.verificationToken === "string" ? body.verificationToken : undefined,
        encryptKey: typeof body.encryptKey === "string" ? body.encryptKey : undefined,
      }, { agentId: nextAgentId ?? existing.agentId, database });
      if (binding.enabled) {
        void feishuWebSocketService.startBinding(binding).catch((error) => {
          appendEvent({
            agent_id: binding.agentId,
            type: "channel.delivery.failed",
            payload: {
              channel: "feishu",
              transport: "websocket",
              appId: binding.appId,
              error: error instanceof Error ? error.message : String(error),
            },
          }, database);
        });
      }
      appendEvent({
        agent_id: binding.agentId,
        type: "channel.binding.updated",
        payload: {
          channel: "feishu",
          appId: binding.appId,
          action: "patch",
          enabled: binding.enabled,
          agentId: binding.agentId,
        },
      }, database);
      return c.json({
        binding: {
          ...feishuBindingService.toPublicBinding(binding),
          websocketStatus: feishuWebSocketService.getBindingStatus(binding.appId),
        },
      });
    } catch (error) {
      return jsonError(c, error, "飞书绑定更新失败");
    }
  });

  app.delete("/feishu/bindings/:appId", (c) => {
    const appId = c.req.param("appId");
    try {
      const deleted = feishuBindingService.deleteBinding(appId, { database });
      feishuWebSocketService.stopBinding(deleted.appId);
      appendEvent({
        agent_id: deleted.agentId,
        type: "channel.binding.deleted",
        payload: { channel: "feishu", appId: deleted.appId, agentId: deleted.agentId },
      }, database);
      return c.json({ ok: true, appId: deleted.appId });
    } catch (error) {
      const message = error instanceof Error ? error.message : "飞书绑定删除失败";
      return c.json({ error: message }, message.includes("not found") ? 404 : 400);
    }
  });

  app.post("/feishu/onboarding/start", async (c) => {
    const body = sanitizeBody(await c.req.json().catch(() => ({})));
    try {
      const result = await feishuOnboardingService.start({
        agentId: typeof body.agentId === "string" ? body.agentId : undefined,
        domain: isFeishuDomain(body.domain) ? body.domain : undefined,
      });
      return c.json(result, 201);
    } catch (error) {
      return jsonError(c, error, "飞书扫码创建失败");
    }
  });

  app.get("/feishu/onboarding/:id/status", async (c) => {
    try {
      return c.json(await feishuOnboardingService.getStatus(c.req.param("id")));
    } catch (error) {
      const message = error instanceof Error ? error.message : "飞书扫码状态读取失败";
      return c.json({ error: message }, message.includes("not found") ? 404 : 400);
    }
  });

  app.post("/feishu/onboarding/:id/cancel", (c) => {
    try {
      return c.json(feishuOnboardingService.cancel(c.req.param("id")));
    } catch (error) {
      const message = error instanceof Error ? error.message : "飞书扫码取消失败";
      return c.json({ error: message }, message.includes("not found") ? 404 : 400);
    }
  });

  app.post("/feishu/events", async (c) => {
    const payload = await c.req.json().catch(() => null);
    const parsed = parseFeishuEvent(payload, feishuBindingService);
    if (parsed.kind === "challenge") {
      return c.json({ challenge: parsed.challenge });
    }
    if (parsed.kind === "ignored") {
      appendEvent({
        agent_id: "default",
        type: "channel.inbound.ignored",
        payload: { channel: "feishu", reason: parsed.reason, appId: parsed.appId },
      }, database);
      return c.json({ code: 0, msg: "ignored" });
    }

    const received = dispatchFeishuMessage(parsed.message, { database, channelService, externalChannelRunner });
    return c.json({ code: 0, msg: "ok", taskId: received.task.id });
  });

  return app;
}

export default createChannelRoutes();
