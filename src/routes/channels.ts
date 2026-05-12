import { Hono } from "hono";
import type { Database } from "bun:sqlite";
import { defaultAgentService, type AgentService } from "../agents/service";
import { getDb } from "../core/database";
import { appendEvent } from "../events/event-log";
import { defaultFeishuBindingService, type FeishuBindingService } from "../channels/feishu-binding-service";
import { parseFeishuEvent } from "../channels/feishu-events";
import { dispatchFeishuMessage, type ExternalChannelRunner } from "../channels/feishu-dispatch";
import { runExternalChannelTask } from "../channels/external-runner";
import { defaultFeishuWebSocketService, type FeishuWebSocketService } from "../channels/feishu-websocket-service";
import { defaultChannelService, type ChannelService } from "../channels/service";

type FeishuWebSocketStarter = Pick<FeishuWebSocketService, "startBinding">;

export function createChannelRoutes(
  options: {
    database?: Database;
    feishuBindingService?: FeishuBindingService;
    agentService?: AgentService;
    channelService?: ChannelService;
    externalChannelRunner?: ExternalChannelRunner;
    feishuWebSocketService?: FeishuWebSocketStarter;
  } = {},
): Hono {
  const app = new Hono();
  const database = options.database ?? getDb();
  const feishuBindingService = options.feishuBindingService ?? defaultFeishuBindingService;
  const agentService = options.agentService ?? defaultAgentService;
  const channelService = options.channelService ?? defaultChannelService;
  const externalChannelRunner = options.externalChannelRunner ?? runExternalChannelTask;
  const feishuWebSocketService = options.feishuWebSocketService ?? defaultFeishuWebSocketService;

  app.get("/feishu/bindings", (c) => {
    return c.json({ bindings: feishuBindingService.listPublicBindings() });
  });

  app.post("/feishu/bindings", async (c) => {
    const body = await c.req.json().catch(() => ({})) as {
      appId?: string;
      appSecret?: string;
      agentId?: string;
      domain?: "feishu" | "lark";
      verificationToken?: string;
      encryptKey?: string;
    };
    if (!body.appId || !body.appSecret) {
      return c.json({ error: "缺少 appId 或 appSecret" }, 400);
    }
    const agentId = body.agentId?.trim() || "default";
    if (!agentService.getAgent(agentId, { database })) {
      return c.json({ error: `Agent not found: ${agentId}` }, 404);
    }

    const binding = feishuBindingService.upsertBinding({
      appId: body.appId,
      appSecret: body.appSecret,
      agentId,
      domain: body.domain,
      verificationToken: body.verificationToken,
      encryptKey: body.encryptKey,
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
        appId: binding.appId,
        agentId: binding.agentId,
        domain: binding.domain,
        enabled: binding.enabled,
        hasAppSecret: true,
        hasVerificationToken: Boolean(binding.verificationToken),
        hasEncryptKey: Boolean(binding.encryptKey),
      },
      transport: "websocket",
      note: "飞书默认使用 WebSocket 长连接，不需要配置事件回调 URL；/api/channels/feishu/events 仅保留为调试入口。",
    }, 201);
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
