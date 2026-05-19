import { generateText, type GenerateTextResult, type ModelMessage, stepCountIs, type ToolSet } from "ai";
import { createDeepSeek, deepseek } from "@ai-sdk/deepseek";
import type { Database } from "bun:sqlite";
import { defaultAgentConfigService } from "../agents/config-service";
import { getConfig } from "../core/config";
import { getDb } from "../core/database";
import { appendEvent, listTaskEvents } from "../events/event-log";
import { finalizeEpisodeForTask } from "../memory/episode-store";
import { buildAgentSystemPrompt, loadRelevantMemoriesForPrompt, type MemorySearcher } from "../prompts/agent-prompt";
import { defaultSkillService } from "../skills";
import {
  classifyTaskFailure,
  getQueuedTaskPosition,
  getTask,
  markTaskCompleted,
  markTaskFailed,
  renewTaskLease,
  TASK_LEASE_RENEW_INTERVAL_MS,
  updateTaskProgress,
} from "../tasks/task-store";
import { claimNextTaskForChannels, claimTask } from "../tasks/task-queue";
import type { TaskRecord } from "../tasks/task-types";
import { buildAgentTools } from "../tools/service";
import { defaultChannelService, type ChannelService } from "./service";
import type { ChannelReceiveResult } from "./types";
import { defaultApprovalService, type ApprovalService } from "../tools/approval-service";
import { sendFeishuApprovalPrompt } from "./feishu-approval";

export interface RunExternalChannelTaskInput {
  received: ChannelReceiveResult;
  userText: string;
  deliverMetadata?: Record<string, unknown>;
  database?: Database;
  approvalService?: ApprovalService;
  channelService?: ChannelService;
  generateTextRunner?: typeof generateText;
  skipDrain?: boolean;
  memorySearcher?: MemorySearcher;
}

export interface ResumeExternalChannelTaskInput {
  approvalId: string;
  database?: Database;
  approvalService?: ApprovalService;
  channelService?: typeof defaultChannelService;
  generateTextRunner?: typeof generateText;
  skipDrain?: boolean;
  memorySearcher?: MemorySearcher;
}

const EXTERNAL_QUEUE_CHANNELS = ["feishu"];
const drainingState = new Map<string, { pending: boolean }>();
const DEFAULT_PROVIDER_OPTIONS = {
  deepseek: { thinking: { type: "disabled" } },
} as const;

type DeliveryStage = "accepted" | "queued" | "failed";

interface TaskChannelMetadata {
  appId?: string;
  chatId?: string;
  messageId?: string;
  chatType?: string;
  rawEventType?: string;
  channel?: string;
}

function getModel(agentId: string) {
  const config = getConfig();
  const agentConfig = defaultAgentConfigService.getAgentConfig(agentId);
  const provider = config.provider.baseURL
    ? createDeepSeek({ baseURL: config.provider.baseURL })
    : deepseek;
  return provider(agentConfig.model.model);
}

function findApprovalRequest(result: GenerateTextResult<ToolSet, never>): {
  approvalId: string;
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
} | null {
  for (const part of result.content) {
    if (part.type !== "tool-approval-request") continue;
    const input = part.toolCall.input;
    return {
      approvalId: part.approvalId,
      toolCallId: part.toolCall.toolCallId,
      toolName: part.toolCall.toolName,
      args: input && typeof input === "object" && !Array.isArray(input)
        ? input as Record<string, unknown>
        : {},
    };
  }
  return null;
}

function stringifyCompact(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function summarizeToolOutputs(result: GenerateTextResult<ToolSet, never>): string {
  const toolResults = result.steps.flatMap((step) => step.toolResults);
  if (toolResults.length === 0) return "";

  const lines = toolResults.slice(-3).map((toolResult) => {
    const output = toolResult.output as { success?: boolean; error?: { message?: string; suggestion?: string } } | unknown;
    const outputObject = output && typeof output === "object" && !Array.isArray(output)
      ? output as { success?: boolean; error?: { message?: string; suggestion?: string } }
      : null;
    if (outputObject?.success === false && outputObject.error) {
      const suggestion = outputObject.error.suggestion ? `；建议：${outputObject.error.suggestion}` : "";
      return `- ${toolResult.toolName}: ${outputObject.error.message ?? "工具执行失败"}${suggestion}`;
    }
    return `- ${toolResult.toolName}: ${stringifyCompact(toolResult.output).slice(0, 500)}`;
  });

  return [
    "模型执行了工具，但没有生成最终文本回复。最近工具结果：",
    ...lines,
  ].join("\n");
}

function normalizeExternalResultText(result: GenerateTextResult<ToolSet, never>): string {
  const text = result.text.trim();
  if (text) return result.text;

  const toolSummary = summarizeToolOutputs(result);
  if (toolSummary) return toolSummary;
  return "模型没有返回可用文本结果，请换一种问法或稍后重试。";
}

function buildResumeMessages(input: {
  userText: string;
  responseMessages: unknown[];
  approvalId: string;
  approved: boolean;
  reason?: string;
}): ModelMessage[] {
  return [
    { role: "user", content: [{ type: "text", text: input.userText }] },
    ...(input.responseMessages as ModelMessage[]),
    {
      role: "tool",
      content: [{
        type: "tool-approval-response",
        approvalId: input.approvalId,
        approved: input.approved,
        ...(input.reason ? { reason: input.reason } : {}),
      }],
    },
  ];
}

function safeParsePayload(payload: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(payload) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

export function getTaskChannelMetadata(taskId: string, database: Database = getDb()): TaskChannelMetadata {
  const inboundEvent = listTaskEvents(taskId, database)
    .filter((event) => event.type === "channel.inbound.received")
    .at(-1);
  if (!inboundEvent) return {};
  const payload = safeParsePayload(inboundEvent.payload);
  return {
    channel: typeof payload.channel === "string" ? payload.channel : undefined,
    appId: typeof payload.appId === "string" ? payload.appId : undefined,
    chatId: typeof payload.chatId === "string" ? payload.chatId : undefined,
    messageId: typeof payload.messageId === "string" ? payload.messageId : undefined,
    chatType: typeof payload.chatType === "string" ? payload.chatType : undefined,
    rawEventType: typeof payload.rawEventType === "string" ? payload.rawEventType : undefined,
  };
}

function getDeliverMetadata(input: {
  taskId: string;
  deliverMetadata?: Record<string, unknown>;
  database: Database;
}): Record<string, unknown> {
  const stored = getTaskChannelMetadata(input.taskId, input.database);
  return {
    ...stored,
    ...(input.deliverMetadata ?? {}),
  };
}

async function deliverStatus(input: {
  channelService: ChannelService;
  task: TaskRecord;
  channel: string;
  conversationId: string;
  text: string;
  metadata: Record<string, unknown>;
  type: "task.processing.notified" | "task.queued.notified";
  stage: DeliveryStage;
  database: Database;
}): Promise<void> {
  try {
    await input.channelService.deliverMessage({
      channel: input.channel,
      conversationId: input.conversationId,
      taskId: input.task.id,
      text: input.text,
      metadata: {
        ...input.metadata,
        messageType: "text",
      },
    });
    appendEvent({
      agent_id: input.task.agent_id,
      task_id: input.task.id,
      conversation_id: input.task.conversation_id,
      type: input.type,
      payload: { channel: input.channel, stage: input.stage, text: input.text },
    }, input.database);
  } catch (error) {
    appendEvent({
      agent_id: input.task.agent_id,
      task_id: input.task.id,
      conversation_id: input.task.conversation_id,
      type: "channel.delivery.failed",
      payload: {
        channel: input.channel,
        stage: input.stage,
        error: error instanceof Error ? error.message : String(error),
      },
    }, input.database);
  }
}

async function deliverFailure(input: {
  channelService: ChannelService;
  task: TaskRecord;
  channel: string;
  conversationId: string;
  message: string;
  metadata: Record<string, unknown>;
  database: Database;
}): Promise<void> {
  try {
    await input.channelService.deliverMessage({
      channel: input.channel,
      conversationId: input.conversationId,
      taskId: input.task.id,
      text: `处理失败：${input.message}\n\n请稍后重试；如果持续失败，请联系管理员检查 Agent 配置或飞书连接状态。`,
      metadata: input.metadata,
    });
  } catch {
    // 如果失败回复也发不出去，task.failed 和 channel.delivery.failed 事件已经保留根因。
  }
}

function toReceiveResult(task: TaskRecord): ChannelReceiveResult {
  return {
    channel: task.source_channel,
    agentId: task.agent_id,
    userId: task.source_user_id,
    conversationId: task.conversation_id ?? "",
    task,
  };
}

async function runClaimedExternalChannelTask(input: {
  received: ChannelReceiveResult;
  claimed: TaskRecord;
  userText: string;
  deliverMetadata?: Record<string, unknown>;
  database: Database;
  approvalService: ApprovalService;
  channelService: ChannelService;
  generateTextRunner: typeof generateText;
  skipDrain?: boolean;
  memorySearcher?: MemorySearcher;
}): Promise<void> {
  const task = input.claimed;
  const deliverMetadata = getDeliverMetadata({
    taskId: task.id,
    deliverMetadata: input.deliverMetadata,
    database: input.database,
  });

  appendEvent({
    agent_id: task.agent_id,
    task_id: task.id,
    conversation_id: task.conversation_id,
    type: "task.started",
    payload: { input: task.input, source_channel: task.source_channel },
  }, input.database);
  updateTaskProgress(task.id, { status: "preparing", message: "正在准备渠道任务" }, input.database);

  await deliverStatus({
    channelService: input.channelService,
    task,
    channel: input.received.channel,
    conversationId: input.received.conversationId,
    text: "已收到，正在处理。",
    metadata: deliverMetadata,
    type: "task.processing.notified",
    stage: "accepted",
    database: input.database,
  });

  const stopLeaseHeartbeat = startTaskLeaseHeartbeat(task.id, input.database);
  try {
    const messages: ModelMessage[] = [
      { role: "user", content: [{ type: "text", text: input.userText }] },
    ];
    updateTaskProgress(task.id, { status: "building_prompt", message: "正在构建提示词" }, input.database);
    const relevantMemories = await loadRelevantMemoriesForPrompt(task.input, {
      memoryTopK: 5,
      memorySearcher: input.memorySearcher,
    });
    const systemPrompt = await buildAgentSystemPrompt(task, input.database, {
      skillService: defaultSkillService,
      relevantMemories,
    });
    updateTaskProgress(task.id, { status: "calling_model", message: "正在调用模型" }, input.database);
    const result = await input.generateTextRunner({
      model: getModel(task.agent_id),
      system: systemPrompt,
      messages,
      tools: buildAgentTools({
        agentId: task.agent_id,
        taskId: task.id,
        conversationId: task.conversation_id,
        sourceChannel: task.source_channel,
        sourceUserId: task.source_user_id,
        sourceMetadata: deliverMetadata,
        database: input.database,
      }),
      stopWhen: stepCountIs(5),
      experimental_context: {},
      providerOptions: DEFAULT_PROVIDER_OPTIONS,
    });

    const approvalRequest = findApprovalRequest(result as GenerateTextResult<ToolSet, never>);
    if (approvalRequest) {
      const approval = input.approvalService.createChannelApproval({
        agentId: task.agent_id,
        taskId: task.id,
        channel: input.received.channel,
        conversationId: input.received.conversationId,
        externalConversationId: input.received.channel === "feishu"
          ? String(deliverMetadata.appId ?? "") + ":" + String(deliverMetadata.chatId ?? "")
          : input.received.conversationId,
        externalUserId: task.source_user_id,
        toolCallId: approvalRequest.approvalId,
        toolName: approvalRequest.toolName,
        args: approvalRequest.args,
        resumePayload: {
          userText: input.userText,
          messages: result.response.messages,
          deliverMetadata,
        },
      });
      await sendFeishuApprovalPrompt({
        channelService: input.channelService,
        channel: input.received.channel,
        conversationId: input.received.conversationId,
        taskId: task.id,
        deliverMetadata,
        approvalId: approval.id,
        toolName: approval.toolName,
        args: approval.args,
        riskLevel: approval.riskLevel,
        reason: approval.reason,
      });
      appendEvent({
        agent_id: task.agent_id,
        task_id: task.id,
        conversation_id: task.conversation_id,
        type: "task.completed",
        payload: { result: "等待工具审批" },
      }, input.database);
      updateTaskProgress(task.id, { status: "persisting_result", message: "正在等待工具审批" }, input.database);
      markTaskCompleted(task.id, "等待工具审批", input.database);
      finalizeEpisodeForTask(task.id, input.database);
      return;
    }

    const responseText = normalizeExternalResultText(result as GenerateTextResult<ToolSet, never>);

    try {
      await input.channelService.deliverMessage({
        channel: input.received.channel,
        conversationId: input.received.conversationId,
        taskId: task.id,
        text: responseText,
        metadata: deliverMetadata,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendEvent({
        agent_id: task.agent_id,
        task_id: task.id,
        conversation_id: task.conversation_id,
        type: "channel.delivery.failed",
        payload: { channel: input.received.channel, stage: "final", error: message },
      }, input.database);
      throw error;
    }

    updateTaskProgress(task.id, { status: "persisting_result", message: "正在发送渠道回复" }, input.database);
    markTaskCompleted(task.id, responseText, input.database);
    appendEvent({
      agent_id: task.agent_id,
      task_id: task.id,
      conversation_id: task.conversation_id,
      type: "assistant.message",
      payload: { text: responseText },
    }, input.database);
    appendEvent({
      agent_id: task.agent_id,
      task_id: task.id,
      conversation_id: task.conversation_id,
      type: "task.completed",
      payload: { result: responseText },
    }, input.database);
    finalizeEpisodeForTask(task.id, input.database);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const classification = classifyTaskFailure(message, { stage: "delivery" });
    markTaskFailed(task.id, message, classification, input.database);
    appendEvent({
      agent_id: task.agent_id,
      task_id: task.id,
      conversation_id: task.conversation_id,
      type: "task.failed",
      payload: {
        error: message,
        failureType: classification.failure_type,
        failureStage: classification.failure_stage,
        retriable: classification.retriable,
      },
    }, input.database);
    finalizeEpisodeForTask(task.id, input.database);
    await deliverFailure({
      channelService: input.channelService,
      task,
      channel: input.received.channel,
      conversationId: input.received.conversationId,
      message,
      metadata: deliverMetadata,
      database: input.database,
    });
  } finally {
    stopLeaseHeartbeat();
    if (!input.skipDrain) {
      await drainExternalChannelQueue(task.agent_id, {
        database: input.database,
        approvalService: input.approvalService,
        channelService: input.channelService,
        generateTextRunner: input.generateTextRunner,
        memorySearcher: input.memorySearcher,
      });
    }
  }
}

function startTaskLeaseHeartbeat(taskId: string, database: Database): () => void {
  const interval = setInterval(() => {
    renewTaskLease(taskId, database);
  }, TASK_LEASE_RENEW_INTERVAL_MS);
  (interval as { unref?: () => void }).unref?.();
  return () => clearInterval(interval);
}

/**
 * 运行非 Web 渠道 task，并在完成后通过 ChannelService 回发。
 *
 * Web 使用 HTTP stream，所以走 routes/chat 的流式路径。飞书/微信这类外部渠道
 * 没有前端连接可复用，需要后台完整跑完模型后再主动投递回复。
 */
export async function runExternalChannelTask(input: RunExternalChannelTaskInput): Promise<void> {
  const database = input.database ?? getDb();
  const approvalService = input.approvalService ?? defaultApprovalService;
  const channelService = input.channelService ?? defaultChannelService;
  const generateTextRunner = input.generateTextRunner ?? generateText;
  const task = input.received.task;
  const claimed = claimTask(task.id, database);
  if (!claimed) {
    const position = getQueuedTaskPosition(task.agent_id, task.id, EXTERNAL_QUEUE_CHANNELS, database);
    if (position !== null) {
      await deliverStatus({
        channelService,
        task,
        channel: input.received.channel,
        conversationId: input.received.conversationId,
        text: `已收到，当前 Agent 正在处理其他任务，本条消息已排队，前面还有 ${position} 条。`,
        metadata: getDeliverMetadata({
          taskId: task.id,
          deliverMetadata: input.deliverMetadata,
          database,
        }),
        type: "task.queued.notified",
        stage: "queued",
        database,
      });
      void drainExternalChannelQueue(task.agent_id, {
        database,
        approvalService,
        channelService,
        generateTextRunner,
        memorySearcher: input.memorySearcher,
      });
      return;
    }

    const message = "任务当前不可执行，可能已被处理、取消或目标 Agent 状态异常。";
    const classification = {
      failure_type: "unknown",
      failure_stage: "claim",
      retriable: false,
    } as const;
    markTaskFailed(task.id, message, classification, database);
    appendEvent({
      agent_id: task.agent_id,
      task_id: task.id,
      conversation_id: task.conversation_id,
      type: "task.failed",
      payload: {
        error: message,
        failureType: classification.failure_type,
        failureStage: classification.failure_stage,
        retriable: classification.retriable,
      },
    }, database);
    finalizeEpisodeForTask(task.id, database);

    await deliverFailure({
      channelService,
      task,
      channel: input.received.channel,
      conversationId: input.received.conversationId,
      message,
      metadata: getDeliverMetadata({
        taskId: task.id,
        deliverMetadata: input.deliverMetadata,
        database,
      }),
      database,
    });
    return;
  }

  await runClaimedExternalChannelTask({
    received: input.received,
    claimed,
    userText: input.userText,
    deliverMetadata: input.deliverMetadata,
    database,
    approvalService,
    channelService,
    generateTextRunner,
    skipDrain: input.skipDrain,
    memorySearcher: input.memorySearcher,
  });
}

export async function drainExternalChannelQueue(agentId: string, options: {
  database?: Database;
  approvalService?: ApprovalService;
  channelService?: ChannelService;
  generateTextRunner?: typeof generateText;
  memorySearcher?: MemorySearcher;
} = {}): Promise<void> {
  const existingState = drainingState.get(agentId);
  if (existingState) {
    existingState.pending = true;
    return;
  }

  const state = { pending: false };
  drainingState.set(agentId, state);
  const database = options.database ?? getDb();
  const approvalService = options.approvalService ?? defaultApprovalService;
  const channelService = options.channelService ?? defaultChannelService;
  const generateTextRunner = options.generateTextRunner ?? generateText;

  while (true) {
    let shouldContinue = false;
    let caughtError: unknown;
    try {
      while (true) {
        const claimed = claimNextTaskForChannels(agentId, EXTERNAL_QUEUE_CHANNELS, database);
        if (!claimed) break;
        const deliverMetadata = getDeliverMetadata({ taskId: claimed.id, database });
        const received = toReceiveResult(claimed);
        await runClaimedExternalChannelTask({
          received,
          claimed,
          userText: claimed.input,
          deliverMetadata,
          database,
          approvalService,
          channelService,
          generateTextRunner,
          skipDrain: true,
          memorySearcher: options.memorySearcher,
        });
      }
    } catch (error) {
      caughtError = error;
    } finally {
      if (caughtError) {
        drainingState.delete(agentId);
      } else if (state.pending) {
        state.pending = false;
        shouldContinue = true;
      } else {
        drainingState.delete(agentId);
      }
    }

    if (caughtError) {
      throw caughtError;
    }

    if (!shouldContinue) {
      return;
    }
  }
}

export async function resumeApprovedExternalChannelTask(input: ResumeExternalChannelTaskInput): Promise<void> {
  const database = input.database ?? getDb();
  const approvalService = input.approvalService ?? defaultApprovalService;
  const channelService = input.channelService ?? defaultChannelService;
  const generateTextRunner = input.generateTextRunner ?? generateText;
  const approval = approvalService.getApproval(input.approvalId);
  if (approval.status !== "approved") {
    throw new Error(`Approval is not approved: ${input.approvalId}`);
  }
  const resumePayload = approvalService.getResumePayload(input.approvalId);
  if (!resumePayload) {
    throw new Error(`Approval resume payload not found: ${input.approvalId}`);
  }
  if (!approval.taskId) {
    throw new Error(`Approval taskId not found: ${input.approvalId}`);
  }

  const task = getTask(approval.taskId, database);
  if (!task) {
    throw new Error(`Task not found: ${approval.taskId}`);
  }

  try {
    const messages = buildResumeMessages({
      userText: resumePayload.userText,
      responseMessages: resumePayload.messages,
      approvalId: approval.toolCallId,
      approved: true,
    });
    const result = await generateTextRunner({
      model: getModel(task.agent_id),
      system: await buildAgentSystemPrompt(task, database, {
        skillService: defaultSkillService,
        relevantMemories: await loadRelevantMemoriesForPrompt(task.input, {
          memoryTopK: 5,
          memorySearcher: input.memorySearcher,
        }),
      }),
      messages,
      tools: buildAgentTools({
        agentId: task.agent_id,
        taskId: task.id,
        conversationId: task.conversation_id,
        sourceChannel: task.source_channel,
        sourceUserId: task.source_user_id,
        sourceMetadata: resumePayload.deliverMetadata,
        database,
      }),
      stopWhen: stepCountIs(5),
      experimental_context: {
        approvedWritePaths: approval.toolName === "write_file" && typeof approval.args.path === "string"
          ? [approval.args.path]
          : [],
      },
      providerOptions: DEFAULT_PROVIDER_OPTIONS,
    });
    const responseText = normalizeExternalResultText(result as GenerateTextResult<ToolSet, never>);
    updateTaskProgress(task.id, { status: "persisting_result", message: "正在保存恢复结果" }, database);
    markTaskCompleted(task.id, responseText, database);
    appendEvent({
      agent_id: task.agent_id,
      task_id: task.id,
      conversation_id: task.conversation_id,
      type: "assistant.message",
      payload: { text: responseText, resumedFromApprovalId: input.approvalId },
    }, database);
    appendEvent({
      agent_id: task.agent_id,
      task_id: task.id,
      conversation_id: task.conversation_id,
      type: "task.completed",
      payload: { result: responseText, resumedFromApprovalId: input.approvalId },
    }, database);
    finalizeEpisodeForTask(task.id, database);
    await channelService.deliverMessage({
      channel: approval.channel ?? task.source_channel,
      conversationId: approval.conversationId ?? task.conversation_id ?? "",
      taskId: task.id,
      text: responseText,
      metadata: resumePayload.deliverMetadata,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const classification = classifyTaskFailure(message, { stage: "delivery" });
    markTaskFailed(task.id, message, classification, database);
    appendEvent({
      agent_id: task.agent_id,
      task_id: task.id,
      conversation_id: task.conversation_id,
      type: "task.failed",
      payload: {
        error: message,
        resumedFromApprovalId: input.approvalId,
        failureType: classification.failure_type,
        failureStage: classification.failure_stage,
        retriable: classification.retriable,
      },
    }, database);
    finalizeEpisodeForTask(task.id, database);
    try {
      await channelService.deliverMessage({
        channel: approval.channel ?? task.source_channel,
        conversationId: approval.conversationId ?? task.conversation_id ?? "",
        taskId: task.id,
        text: `处理失败：${message}\n\n请稍后重试；如果持续失败，请联系管理员检查 Agent 配置或飞书连接状态。`,
        metadata: resumePayload.deliverMetadata,
      });
    } catch {
      // 审批恢复失败且飞书也无法回发时，task.failed 已经保留根因。
    }
  } finally {
    if (!input.skipDrain) {
      await drainExternalChannelQueue(task.agent_id, {
        database,
        approvalService,
        channelService,
        generateTextRunner,
      });
    }
  }
}
