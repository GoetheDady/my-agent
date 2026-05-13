import type { Database } from "bun:sqlite";
import { getDb } from "../core/database";
import { appendEvent } from "../events/event-log";
import { defaultChannelService, type ChannelService } from "./service";
import { runExternalChannelTask } from "./external-runner";
import type { FeishuInboundMessage } from "./feishu-events";
import type { ChannelReceiveResult } from "./types";
import { maybeHandleFeishuApprovalCommand } from "./feishu-approval";
import { defaultApprovalService, type ApprovalService } from "../tools/approval-service";

export type ExternalChannelRunner = (input: {
  received: ChannelReceiveResult;
  userText: string;
  deliverMetadata?: Record<string, unknown>;
  database?: Database;
}) => Promise<void>;

/**
 * 把已经解析好的飞书文本消息派发到内部 ChannelService。
 *
 * Webhook 和 WebSocket 都复用这里，避免两个入口各自拼 conversation/task/event。
 */
export async function dispatchFeishuMessage(
  message: FeishuInboundMessage,
  options: {
    database?: Database;
  channelService?: ChannelService;
  externalChannelRunner?: ExternalChannelRunner;
  approvalService?: ApprovalService;
  } = {},
): Promise<ChannelReceiveResult | null> {
  const database = options.database ?? getDb();
  const channelService = options.channelService ?? defaultChannelService;
  const externalChannelRunner = options.externalChannelRunner ?? runExternalChannelTask;
  const approvalService = options.approvalService ?? defaultApprovalService;
  const externalConversationId = `${message.appId}:${message.chatId}`;

  const handledApprovalCommand = await maybeHandleFeishuApprovalCommand(message, {
    database,
    approvalService,
    channelService,
  }).catch((error) => {
    appendEvent({
      agent_id: message.binding.agentId,
      type: "tool.approval.failed",
      payload: {
        channel: "feishu",
        appId: message.appId,
        chatId: message.chatId,
        messageId: message.messageId,
        error: error instanceof Error ? error.message : String(error),
      },
    }, database);
    return true;
  });
  if (handledApprovalCommand) {
    return null;
  }

  const received = channelService.receiveMessage({
    channel: "feishu",
    externalConversationId,
    externalUserId: message.senderId,
    text: message.text,
    agentId: message.binding.agentId,
    metadata: {
      appId: message.appId,
      chatId: message.chatId,
      messageId: message.messageId,
      chatType: message.chatType,
      rawEventType: message.rawEventType,
    },
  }, database);
  appendEvent({
    agent_id: received.agentId,
    task_id: received.task.id,
    conversation_id: received.conversationId,
    type: "channel.inbound.received",
    payload: {
      channel: "feishu",
      appId: message.appId,
      chatId: message.chatId,
      messageId: message.messageId,
      chatType: message.chatType,
      rawEventType: message.rawEventType,
      externalConversationId,
      externalUserId: message.senderId,
    },
  }, database);

  void externalChannelRunner({
    received,
    userText: message.text,
    database,
    deliverMetadata: {
      appId: message.appId,
      chatId: message.chatId,
      messageId: message.messageId,
    },
  });
  return received;
}
