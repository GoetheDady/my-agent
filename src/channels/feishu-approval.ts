import { appendEvent } from "../events/event-log";
import { defaultApprovalService, type ApprovalService } from "../tools/approval-service";
import { normalizePath } from "../tools/executor";
import { defaultChannelService, type ChannelService } from "./service";
import type { FeishuCardAction, FeishuInboundMessage } from "./feishu-events";
import type { Database } from "bun:sqlite";
import { getDb } from "../core/database";

export type FeishuApprovalDecision = "approve" | "deny";

export interface ParsedFeishuApprovalCommand {
  approvalId: string;
  decision: FeishuApprovalDecision;
  rememberChoice: boolean;
}

function truncate(value: string, max = 280): string {
  return value.length > max ? `${value.slice(0, max - 3)}...` : value;
}

function summarizeArgs(args: Record<string, unknown>): string {
  const entries = Object.entries(args).filter(([key]) => !/(secret|token|password|key)/i.test(key));
  if (entries.length === 0) return "无参数";
  return entries
    .slice(0, 6)
    .map(([key, value]) => `${key}: ${truncate(String(value), 120)}`)
    .join("\n");
}

function canRememberPath(toolName: string, args: Record<string, unknown>): boolean {
  return toolName === "write_file" && typeof args.path === "string" && args.path.trim().length > 0;
}

export function parseFeishuApprovalCommand(text: string): ParsedFeishuApprovalCommand | null {
  const normalized = text.trim().replace(/\s+/g, " ");
  const match = /^(批准并记住|批准|拒绝)\s+([0-9a-fA-F-]{20,})$/.exec(normalized);
  if (!match) return null;
  return {
    approvalId: match[2],
    decision: match[1] === "拒绝" ? "deny" : "approve",
    rememberChoice: match[1] === "批准并记住",
  };
}

export function buildFeishuApprovalCard(input: {
  approvalId: string;
  toolName: string;
  args: Record<string, unknown>;
  riskLevel: string;
  reason: string;
}): Record<string, unknown> {
  const actionButtons: Array<Record<string, unknown>> = [
    {
      tag: "button",
      text: { tag: "plain_text", content: "批准" },
      type: "primary",
      value: { approvalId: input.approvalId, decision: "approve" },
    },
    {
      tag: "button",
      text: { tag: "plain_text", content: "拒绝" },
      type: "danger",
      value: { approvalId: input.approvalId, decision: "deny" },
    },
  ];
  if (canRememberPath(input.toolName, input.args)) {
    actionButtons.push({
      tag: "button",
      text: { tag: "plain_text", content: "批准并记住此路径" },
      type: "default",
      value: { approvalId: input.approvalId, decision: "approve", rememberChoice: true },
    });
  }

  return {
    config: { wide_screen_mode: true },
    header: {
      template: input.riskLevel === "high" ? "red" : input.riskLevel === "medium" ? "orange" : "blue",
      title: { tag: "plain_text", content: "工具调用需要确认" },
    },
    elements: [
      {
        tag: "div",
        text: {
          tag: "lark_md",
          content: `**工具名**：${input.toolName}\n**风险**：${input.riskLevel}\n**原因**：${input.reason || "需要用户确认"}`,
        },
      },
      {
        tag: "div",
        text: {
          tag: "lark_md",
          content: `**参数摘要**：\n\`\`\`\n${summarizeArgs(input.args)}\n\`\`\``,
        },
      },
      { tag: "hr" },
      {
        tag: "action",
        actions: actionButtons,
      },
    ],
  };
}

export function buildFeishuApprovalFallbackText(input: {
  approvalId: string;
  toolName: string;
  args: Record<string, unknown>;
  riskLevel: string;
  reason: string;
}): string {
  const lines = [
    "工具调用需要确认",
    `工具名：${input.toolName}`,
    `风险：${input.riskLevel}`,
    `原因：${input.reason || "需要用户确认"}`,
    "参数摘要：",
    summarizeArgs(input.args),
    "",
    `批准：批准 ${input.approvalId}`,
    `拒绝：拒绝 ${input.approvalId}`,
  ];
  if (canRememberPath(input.toolName, input.args)) {
    const path = normalizePath(String(input.args.path));
    lines.push(`批准并记住此路径：批准并记住 ${input.approvalId}`);
    lines.push(`将加入白名单路径：${path}`);
  }
  return lines.join("\n");
}

export function buildFeishuApprovalResolvedCard(input: {
  toolName: string;
  riskLevel: string;
  status: "approved" | "denied" | "failed";
  message?: string;
}): Record<string, unknown> {
  const statusText = input.status === "approved"
    ? "已批准，工具正在执行"
    : input.status === "denied"
      ? "已拒绝，本次工具调用不会执行"
      : "处理失败";
  return {
    config: { wide_screen_mode: true },
    header: {
      template: input.status === "approved" ? "green" : "red",
      title: { tag: "plain_text", content: "工具审批已处理" },
    },
    elements: [
      {
        tag: "div",
        text: {
          tag: "lark_md",
          content: `**状态**：${statusText}\n**工具名**：${input.toolName}\n**风险**：${input.riskLevel}`,
        },
      },
      ...(input.message
        ? [{
            tag: "div",
            text: { tag: "lark_md", content: `**说明**：${input.message}` },
          }]
        : []),
    ],
  };
}

export async function sendFeishuApprovalPrompt(input: {
  channelService?: ChannelService;
  channel: string;
  conversationId: string;
  taskId: string;
  deliverMetadata: Record<string, unknown>;
  approvalId: string;
  toolName: string;
  args: Record<string, unknown>;
  riskLevel: string;
  reason: string;
}): Promise<void> {
  const channelService = input.channelService ?? defaultChannelService;
  const text = buildFeishuApprovalFallbackText(input);
  const card = buildFeishuApprovalCard(input);
  try {
    await channelService.deliverMessage({
      channel: input.channel,
      conversationId: input.conversationId,
      taskId: input.taskId,
      text,
      metadata: {
        ...input.deliverMetadata,
        messageType: "interactive",
        card,
      },
    });
  } catch {
    await channelService.deliverMessage({
      channel: input.channel,
      conversationId: input.conversationId,
      taskId: input.taskId,
      text,
      metadata: input.deliverMetadata,
    });
  }
}

export async function handleFeishuApprovalDecision(input: {
  approvalId: string;
  decision: FeishuApprovalDecision;
  rememberChoice?: boolean;
  channel: "feishu";
  externalConversationId: string;
  externalUserId: string;
  conversationId: string;
  deliverMetadata: Record<string, unknown>;
  database?: Database;
  approvalService?: ApprovalService;
  channelService?: ChannelService;
}): Promise<ReturnType<typeof buildFeishuApprovalResolvedCard>> {
  const database = input.database ?? getDb();
  const approvalService = input.approvalService ?? defaultApprovalService;
  const channelService = input.channelService ?? defaultChannelService;
  const approval = approvalService.resolveChannelApproval({
    approvalId: input.approvalId,
    channel: input.channel,
    externalConversationId: input.externalConversationId,
    externalUserId: input.externalUserId,
    decision: input.decision,
    rememberChoice: input.rememberChoice === true,
  });

  if (approval.status === "denied") {
    await channelService.deliverMessage({
      channel: input.channel,
      conversationId: input.conversationId,
      taskId: approval.taskId ?? undefined,
      text: "已拒绝，本次工具调用不会执行。",
      metadata: input.deliverMetadata,
    });
    return buildFeishuApprovalResolvedCard({
      toolName: approval.toolName,
      riskLevel: approval.riskLevel,
      status: "denied",
    });
  }

  appendEvent({
    agent_id: approval.agentId,
    task_id: approval.taskId,
    conversation_id: input.conversationId,
    type: "tool.approval.approved",
    payload: {
      approvalId: approval.id,
      toolCallId: approval.toolCallId,
      toolName: approval.toolName,
      channel: input.channel,
      resume: true,
    },
  }, database);
  const { resumeApprovedExternalChannelTask } = await import("./external-runner");
  await resumeApprovedExternalChannelTask({
    approvalId: approval.id,
    database,
    approvalService,
    channelService,
  });
  return buildFeishuApprovalResolvedCard({
    toolName: approval.toolName,
    riskLevel: approval.riskLevel,
    status: "approved",
  });
}

export async function handleFeishuCardAction(
  action: FeishuCardAction,
  options: {
    database?: Database;
    approvalService?: ApprovalService;
    channelService?: ChannelService;
  } = {},
): Promise<Record<string, unknown>> {
  return await handleFeishuApprovalDecision({
    approvalId: action.approvalId,
    decision: action.decision,
    rememberChoice: action.rememberChoice,
    channel: "feishu",
    externalConversationId: `${action.appId}:${action.chatId}`,
    externalUserId: action.operatorId,
    conversationId: action.chatId,
    deliverMetadata: {
      appId: action.appId,
      chatId: action.chatId,
      messageId: action.messageId,
    },
    ...options,
  });
}

export async function maybeHandleFeishuApprovalCommand(
  message: FeishuInboundMessage,
  options: {
    database?: Database;
    approvalService?: ApprovalService;
    channelService?: ChannelService;
  } = {},
): Promise<boolean> {
  const command = parseFeishuApprovalCommand(message.text);
  if (!command) return false;
  await handleFeishuApprovalDecision({
    approvalId: command.approvalId,
    decision: command.decision,
    rememberChoice: command.rememberChoice,
    channel: "feishu",
    externalConversationId: `${message.appId}:${message.chatId}`,
    externalUserId: message.senderId,
    conversationId: message.chatId,
    deliverMetadata: {
      appId: message.appId,
      chatId: message.chatId,
      messageId: message.messageId,
    },
    ...options,
  });
  return true;
}
