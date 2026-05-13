import * as Lark from "@larksuiteoapi/node-sdk";
import type { Database } from "bun:sqlite";
import { getDb } from "../core/database";
import { appendEvent } from "../events/event-log";
import { dispatchFeishuMessage, type ExternalChannelRunner } from "./feishu-dispatch";
import { parseFeishuEvent } from "./feishu-events";
import { handleFeishuCardAction } from "./feishu-approval";
import { defaultFeishuBindingService, type FeishuBinding, type FeishuBindingService } from "./feishu-binding-service";
import { defaultChannelService, type ChannelService } from "./service";

interface FeishuWebSocketClientLike {
  start(params: { eventDispatcher: unknown }): Promise<void>;
  close(params?: { force?: boolean }): void;
}

type FeishuWebSocketClientFactory = (binding: FeishuBinding, handlers: {
  onReady: () => void;
  onError: (error: Error) => void;
  onReconnecting: () => void;
  onReconnected: () => void;
}) => FeishuWebSocketClientLike;

function getSdkDomain(domain: "feishu" | "lark"): typeof Lark.Domain.Feishu | typeof Lark.Domain.Lark {
  return domain === "lark" ? Lark.Domain.Lark : Lark.Domain.Feishu;
}

function createDefaultWebSocketClient(binding: FeishuBinding, handlers: {
  onReady: () => void;
  onError: (error: Error) => void;
  onReconnecting: () => void;
  onReconnected: () => void;
}): FeishuWebSocketClientLike {
  return new Lark.WSClient({
    appId: binding.appId,
    appSecret: binding.appSecret,
    domain: getSdkDomain(binding.domain),
    loggerLevel: Lark.LoggerLevel.warn,
    autoReconnect: true,
    source: "my-agent",
    onReady: handlers.onReady,
    onError: handlers.onError,
    onReconnecting: handlers.onReconnecting,
    onReconnected: handlers.onReconnected,
  });
}

/**
 * FeishuWebSocketService 管理飞书长连接。
 *
 * 飞书 WebSocket 是客户端主动连接飞书开放平台，所以不需要公网事件回调 URL。
 * 每个启用的 appId 启动一个 WSClient，事件进入后仍复用 ChannelService。
 */
export class FeishuWebSocketService {
  private readonly clients = new Map<string, FeishuWebSocketClientLike>();

  constructor(private readonly options: {
    bindingService?: FeishuBindingService;
    channelService?: ChannelService;
    database?: Database;
    externalChannelRunner?: ExternalChannelRunner;
    clientFactory?: FeishuWebSocketClientFactory;
  } = {}) {}

  async startAll(): Promise<void> {
    const bindings = this.bindingService.listBindings().filter((binding) => binding.enabled);
    for (const binding of bindings) {
      await this.startBinding(binding);
    }
  }

  async startBinding(binding: FeishuBinding): Promise<void> {
    if (!binding.enabled || this.clients.has(binding.appId)) return;
    const database = this.database;
    const client = this.clientFactory(binding, {
      onReady: () => this.emitStatus(binding, "channel.delivery.completed", { status: "ws.ready" }),
      onError: (error) => this.emitStatus(binding, "channel.delivery.failed", { status: "ws.error", error: error.message }),
      onReconnecting: () => this.emitStatus(binding, "channel.delivery.failed", { status: "ws.reconnecting" }),
      onReconnected: () => this.emitStatus(binding, "channel.delivery.completed", { status: "ws.reconnected" }),
    });
    const eventDispatcher = new Lark.EventDispatcher({
      verificationToken: binding.verificationToken,
      encryptKey: binding.encryptKey,
    }).register({
      "im.message.receive_v1": async (data: unknown) => {
        const parsed = parseFeishuEvent({ ...(data as Record<string, unknown>), app_id: binding.appId }, this.bindingService);
        if (parsed.kind !== "message") {
          appendEvent({
            agent_id: binding.agentId,
            type: "channel.inbound.ignored",
            payload: { channel: "feishu", transport: "websocket", reason: parsed.kind === "ignored" ? parsed.reason : parsed.kind },
          }, database);
          return;
        }
        await dispatchFeishuMessage(parsed.message, {
          database,
          channelService: this.channelService,
          externalChannelRunner: this.options.externalChannelRunner,
        });
      },
      "card.action.trigger": async (data: unknown) => {
        const parsed = parseFeishuEvent({ ...(data as Record<string, unknown>), app_id: binding.appId, event_type: "card.action.trigger" }, this.bindingService);
        if (parsed.kind !== "card_action") {
          appendEvent({
            agent_id: binding.agentId,
            type: "channel.inbound.ignored",
            payload: { channel: "feishu", transport: "websocket", reason: parsed.kind === "ignored" ? parsed.reason : parsed.kind },
          }, database);
          return;
        }
        try {
          return await handleFeishuCardAction(parsed.action, {
            database,
            channelService: this.channelService,
          });
        } catch (error) {
          appendEvent({
            agent_id: binding.agentId,
            type: "tool.approval.failed",
            payload: {
              channel: "feishu",
              transport: "websocket",
              appId: binding.appId,
              approvalId: parsed.action.approvalId,
              error: error instanceof Error ? error.message : String(error),
            },
          }, database);
        }
      },
    });

    this.clients.set(binding.appId, client);
    try {
      await client.start({ eventDispatcher });
      appendEvent({
        agent_id: binding.agentId,
        type: "channel.binding.updated",
        payload: { channel: "feishu", transport: "websocket", appId: binding.appId, status: "started" },
      }, database);
    } catch (error) {
      this.clients.delete(binding.appId);
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
      throw error;
    }
  }

  stopAll(): void {
    for (const client of this.clients.values()) {
      client.close({ force: true });
    }
    this.clients.clear();
  }

  stopBinding(appId: string): boolean {
    const client = this.clients.get(appId);
    if (!client) return false;
    client.close({ force: true });
    this.clients.delete(appId);
    appendEvent({
      agent_id: this.bindingService.getBinding(appId)?.agentId ?? "default",
      type: "channel.binding.updated",
      payload: { channel: "feishu", transport: "websocket", appId, status: "stopped" },
    }, this.database);
    return true;
  }

  isRunning(appId: string): boolean {
    return this.clients.has(appId);
  }

  getBindingStatus(appId: string): "running" | "stopped" {
    return this.isRunning(appId) ? "running" : "stopped";
  }

  private get bindingService(): FeishuBindingService {
    return this.options.bindingService ?? defaultFeishuBindingService;
  }

  private get channelService(): ChannelService {
    return this.options.channelService ?? defaultChannelService;
  }

  private get database(): Database {
    return this.options.database ?? getDb();
  }

  private get clientFactory(): FeishuWebSocketClientFactory {
    return this.options.clientFactory ?? createDefaultWebSocketClient;
  }

  private emitStatus(binding: FeishuBinding, type: "channel.delivery.completed" | "channel.delivery.failed", payload: Record<string, unknown>): void {
    appendEvent({
      agent_id: binding.agentId,
      type,
      payload: { channel: "feishu", transport: "websocket", appId: binding.appId, ...payload },
    }, this.database);
  }
}

export const defaultFeishuWebSocketService = new FeishuWebSocketService();

export async function startFeishuWebSocketService(
  service: FeishuWebSocketService = defaultFeishuWebSocketService,
): Promise<void> {
  if (process.env.FEISHU_WEBSOCKET_ENABLED === "false") return;
  try {
    await service.startAll();
  } catch (error) {
    console.warn("[feishu] websocket start failed:", error);
  }
}
