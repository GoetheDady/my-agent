import * as Lark from "@larksuiteoapi/node-sdk";
import type { Database } from "bun:sqlite";
import { getDb } from "../core/database";
import { appendEvent } from "../events/event-log";
import type { ChannelAdapter, ChannelMessageOutput } from "./types";
import { defaultFeishuBindingService, type FeishuBinding, type FeishuBindingService } from "./feishu-binding-service";
import { buildFeishuPostContent } from "./feishu-format";

type FeishuMessageType = "text" | "post" | "interactive";

interface FeishuSdkResponse {
  code?: number;
  msg?: string;
  data?: {
    message_id?: string;
  };
}

interface FeishuMessageClientLike {
  im: {
    v1: {
      message: {
        create(payload: {
          params: { receive_id_type: "chat_id" };
          data: {
            receive_id: string;
            msg_type: FeishuMessageType;
            content: string;
          };
        }): Promise<FeishuSdkResponse>;
        reply(payload: {
          path: { message_id: string };
          data: {
            msg_type: FeishuMessageType;
            content: string;
          };
        }): Promise<FeishuSdkResponse>;
      };
    };
  };
}

type FeishuMessageClientFactory = (binding: FeishuBinding) => FeishuMessageClientLike;

function getStringMetadata(metadata: Record<string, unknown> | undefined, key: string): string {
  const value = metadata?.[key];
  return typeof value === "string" ? value : "";
}

function getSdkDomain(domain: "feishu" | "lark"): typeof Lark.Domain.Feishu | typeof Lark.Domain.Lark {
  return domain === "lark" ? Lark.Domain.Lark : Lark.Domain.Feishu;
}

function createDefaultMessageClient(binding: FeishuBinding): FeishuMessageClientLike {
  return new Lark.Client({
    appId: binding.appId,
    appSecret: binding.appSecret,
    appType: Lark.AppType.SelfBuild,
    domain: getSdkDomain(binding.domain),
    loggerLevel: Lark.LoggerLevel.warn,
    source: "my-agent",
  });
}

function getMessagePayload(output: ChannelMessageOutput): { msgType: FeishuMessageType; content: string } {
  if (output.metadata?.messageType === "interactive" && output.metadata.card) {
    return {
      msgType: "interactive",
      content: JSON.stringify(output.metadata.card),
    };
  }
  if (output.metadata?.messageType !== "text") {
    return {
      msgType: "post",
      content: JSON.stringify(buildFeishuPostContent(output.text)),
    };
  }
  return {
    msgType: "text",
    content: JSON.stringify({ text: output.text }),
  };
}

/**
 * FeishuChannelAdapter 负责飞书出站消息。
 *
 * 入站事件由 WebSocket / routes 解析后交给 ChannelService；这里专注把 Agent
 * 的最终回复发回飞书会话。出站消息使用飞书 SDK，让 token 获取、刷新和
 * OpenAPI 细节由 SDK 管理。
 */
export class FeishuChannelAdapter implements ChannelAdapter {
  readonly channel = "feishu";

  constructor(
    private readonly bindingService: FeishuBindingService = defaultFeishuBindingService,
    private readonly clientFactory: FeishuMessageClientFactory = createDefaultMessageClient,
    private readonly database: Database = getDb(),
  ) {}

  async deliver(output: ChannelMessageOutput): Promise<void> {
    const appId = getStringMetadata(output.metadata, "appId");
    const chatId = getStringMetadata(output.metadata, "chatId") || output.conversationId;
    const replyToMessageId = getStringMetadata(output.metadata, "messageId");
    const binding = appId
      ? this.bindingService.getEnabledBinding(appId)
      : this.bindingService.getSingleEnabledBinding();
    if (!binding) {
      throw new Error(appId ? `Feishu binding not found: ${appId}` : "Feishu binding not found");
    }
    if (!chatId) {
      throw new Error("Feishu chatId 不能为空");
    }

    const messagePayload = getMessagePayload(output);
    const client = this.clientFactory(binding);
    let response: FeishuSdkResponse;

    try {
      response = replyToMessageId
        ? await client.im.v1.message.reply({
          path: { message_id: replyToMessageId },
          data: {
            msg_type: messagePayload.msgType,
            content: messagePayload.content,
          },
        })
        : await client.im.v1.message.create({
          params: { receive_id_type: "chat_id" },
          data: {
            receive_id: chatId,
            msg_type: messagePayload.msgType,
            content: messagePayload.content,
          },
        });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendEvent({
        agent_id: binding.agentId,
        task_id: output.taskId,
        conversation_id: output.conversationId,
        type: "channel.delivery.failed",
        payload: { channel: "feishu", appId: binding.appId, chatId, replyToMessageId, messageType: messagePayload.msgType, error: message },
      }, this.database);
      throw new Error(`Feishu delivery failed: ${message}`, { cause: error });
    }

    if (response.code !== undefined && response.code !== 0) {
      const message = response.msg || `SDK code ${response.code}`;
      appendEvent({
        agent_id: binding.agentId,
        task_id: output.taskId,
        conversation_id: output.conversationId,
        type: "channel.delivery.failed",
        payload: { channel: "feishu", appId: binding.appId, chatId, replyToMessageId, messageType: messagePayload.msgType, error: message },
      }, this.database);
      throw new Error(`Feishu delivery failed: ${message}`);
    }

    appendEvent({
      agent_id: binding.agentId,
      task_id: output.taskId,
      conversation_id: output.conversationId,
      type: "channel.delivery.completed",
      payload: {
        channel: "feishu",
        appId: binding.appId,
        chatId,
        replyToMessageId,
        messageId: response.data?.message_id,
        messageType: messagePayload.msgType,
      },
    }, this.database);
  }
}
