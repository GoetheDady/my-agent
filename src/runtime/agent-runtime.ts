import {
  type ModelMessage,
  consumeStream,
  convertToModelMessages,
  streamText,
  stepCountIs,
} from "ai";
import { createDeepSeek, deepseek } from "@ai-sdk/deepseek";
import type { Database } from "bun:sqlite";
import { defaultAgentConfigService } from "../agents/config-service";
import { appendEvent } from "../events/event-log";
import { buildAgentSystemPrompt } from "../prompts/agent-prompt";
import { defaultSkillService } from "../skills";
import { buildAgentTools, tools } from "../tools/service";
import { getConfig } from "../core/config";
import { getDb } from "../core/database";
import { upsertEpisodeForTask } from "../memory/episode-store";
import {
  classifyTaskFailure,
  getTask,
  markTaskCanceled,
  markTaskCompleted,
  markTaskFailed,
  renewTaskLease,
  TASK_LEASE_RENEW_INTERVAL_MS,
  updateTaskProgress,
} from "../tasks/task-store";
import { claimTask } from "../tasks/task-queue";
import type { TaskRecord } from "../tasks/task-types";

type StreamTextRunner = typeof streamText;
type StreamTextRunResult = ReturnType<typeof streamText<typeof tools, never>>;
const MODEL_RUN_TIMEOUT_MS = 45_000;

export interface AgentRunInput {
  task: TaskRecord;
  messages: ModelMessage[];
  sessionId?: string | null;
  sourceMetadata?: Record<string, unknown>;
  thinkingEnabled?: boolean;
  abortSignal?: AbortSignal;
  streamTextRunner?: StreamTextRunner;
  database?: Database;
}

export interface AgentRunResult {
  result: StreamTextRunResult;
  taskId: string;
}

/**
 * Agent 忙碌错误。
 *
 * 当同一个 Agent 已经有 running task 时，新的任务不能立即执行，会抛出该错误。
 */
export class AgentBusyError extends Error {
  /**
   * 创建 Agent 忙碌错误。
   *
   * @param agentId 正在执行其他任务的 Agent 标识。
   */
  constructor(agentId: string) {
    super(`Agent is busy: ${agentId}`);
    this.name = "AgentBusyError";
  }
}

/**
 * 将前端/数据库里的消息结构转换成 AI SDK 可消费的模型消息。
 *
 * @param uiMessages 前端 UI 消息或数据库恢复出的消息。
 * @returns AI SDK `ModelMessage` 数组。
 */
export async function toModelMessages(uiMessages: Array<{
  role: string;
  parts?: unknown;
  content?: unknown;
}>): Promise<ModelMessage[]> {
  return convertToModelMessages(
    uiMessages.map((message) => {
      if (message.parts) {
        return {
          ...message,
          parts: filterModelVisibleParts(message.parts),
        };
      }
      if (typeof message.content === "string") {
        return { role: message.role, parts: [{ type: "text", text: message.content }] };
      }
      if (Array.isArray(message.content)) {
        return {
          role: message.role,
          parts: (message.content as Array<Record<string, unknown>>).map((block) => ({
            type: block.type ?? "text",
            text: (block.text ?? block.content ?? "") as string,
          })),
        };
      }
      return { role: message.role, parts: [] };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any,
  );
}

function filterModelVisibleParts(parts: unknown): unknown[] {
  if (!Array.isArray(parts)) return [];
  return parts.filter((part) => {
    if (!part || typeof part !== "object" || Array.isArray(part)) return true;
    const type = (part as { type?: unknown }).type;
    if (type === "tool-memory_extract" || type === "tool-memory_reconsolidate" || type === "tool-profile_sync") {
      return false;
    }
    return true;
  });
}

/**
 * 启动一次 Agent 任务执行，并返回可流式消费的模型结果。
 *
 * 这个方法会完成任务领取、prompt 构建、工具注册、流式事件写入和任务收尾。
 * 它不会阻塞到模型完全结束；调用方会拿到 `streamText` 的结果并继续消费流。
 *
 * @param input Agent 运行所需的 task、消息、思考模式和可选数据库/中断信号。
 * @returns 包含 AI SDK 流式结果和 taskId 的运行结果。
 * @throws 当 Agent 正忙、任务无法领取或模型启动失败时抛出错误。
 */
export function runAgentTask(input: AgentRunInput): AgentRunResult {
  const database = input.database ?? getDb();
  let eventTimestamp = Date.now();
  let settled = false;
  let toolProgressRecorded = false;
  let stopLeaseHeartbeat: (() => void) | null = null;
  const runAbortSignal = createRunAbortSignal(input.abortSignal, MODEL_RUN_TIMEOUT_MS);
  const nextEventTimestamp = (): number => {
    eventTimestamp += 1;
    return eventTimestamp;
  };

  const failTaskOnce = (message: string): void => {
    if (settled) return;
    settled = true;
    runAbortSignal.cleanup();
    stopLeaseHeartbeat?.();
    stopLeaseHeartbeat = null;
    const latest = getTask(input.task.id, database);
    if (!latest || latest.status !== "running") return;

    const classification = classifyTaskFailure(message, {
      isClientAbort: runAbortSignal.signal.aborted && message === "Client aborted stream",
      isTimeout: /timed out/i.test(message),
      stage: "model_call",
    });
    if (classification.failure_type === "user_canceled") {
      markTaskCanceled(input.task.id, { failureType: "user_canceled", requestedBy: "runtime" }, database);
    } else {
      markTaskFailed(input.task.id, message, classification, database);
      appendEvent({
        agent_id: input.task.agent_id,
        task_id: input.task.id,
        conversation_id: input.task.conversation_id,
        type: "task.failed",
        payload: {
          error: message,
          failureType: classification.failure_type,
          failureStage: classification.failure_stage,
          retriable: classification.retriable,
        },
        created_at: nextEventTimestamp(),
      }, database);
    }
  };

  /**
   * Agent 执行主流程：
   * 1. claim task，把 queued task 原子切换成 running，同时锁住对应 Agent。
   * 2. 构建 system prompt：只注入稳定 profile 和 working memory，不注入长期记忆全文。
   * 3. 使用 buildAgentTools 创建带 task/conversation 上下文的工具集合。
   * 4. streamText 流式返回模型输出，并把 delta、完成、失败等过程写入 events。
   * 5. 完成后生成/更新 episode，供之后的情景记忆和 Dream Worker 使用。
   */
  ensureTaskCanRun(input.task, database);
  updateTaskProgress(input.task.id, { status: "preparing", message: "正在准备任务执行" }, database);
  stopLeaseHeartbeat = startTaskLeaseHeartbeat(input.task.id, database);
  appendEvent({
    agent_id: input.task.agent_id,
    task_id: input.task.id,
    conversation_id: input.task.conversation_id,
    type: "task.started",
    payload: { input: input.task.input },
    created_at: nextEventTimestamp(),
  }, database);
  if (runAbortSignal.signal.aborted) {
    const message = runAbortSignal.reason();
    failTaskOnce(message);
    throw new Error(message);
  }
  runAbortSignal.signal.addEventListener("abort", () => failTaskOnce(runAbortSignal.reason()), {
    once: true,
  });

  try {
    const runner = input.streamTextRunner ?? streamText;
    const taskTools = buildAgentTools({
      agentId: input.task.agent_id,
      taskId: input.task.id,
      conversationId: input.task.conversation_id,
      sessionId: input.sessionId,
      sourceChannel: input.task.source_channel,
      sourceUserId: input.task.source_user_id,
      sourceMetadata: input.sourceMetadata,
      database,
    });
    updateTaskProgress(input.task.id, { status: "building_prompt", message: "正在构建提示词" }, database);
    const systemPrompt = buildAgentSystemPrompt(input.task, database, {
      skillService: defaultSkillService,
    });
    updateTaskProgress(input.task.id, { status: "calling_model", message: "正在调用模型" }, database);
    const result = runner({
      model: getModel(input.task.agent_id),
      system: systemPrompt,
      messages: input.messages,
      stopWhen: stepCountIs(5),
      tools: taskTools,
      abortSignal: runAbortSignal.signal,
      providerOptions: {
        deepseek: { thinking: input.thinkingEnabled ? { type: "enabled" } : { type: "disabled" } },
      },
      onChunk: ({ chunk }) => {
        if (!toolProgressRecorded && chunk.type.includes("tool")) {
          toolProgressRecorded = true;
          updateTaskProgress(input.task.id, { status: "using_tool", message: "正在执行工具" }, database);
        }
        if (chunk.type === "text-delta") {
          // delta 事件用于 Runtime 面板观察流式输出，不作为最终消息历史。
          appendEvent({
            agent_id: input.task.agent_id,
            task_id: input.task.id,
            conversation_id: input.task.conversation_id,
            type: "assistant.delta",
            payload: { text: chunk.text },
            created_at: nextEventTimestamp(),
          }, database);
        }
      },
      onFinish: ({ text }) => {
        if (settled) return;
        settled = true;
        runAbortSignal.cleanup();
        stopLeaseHeartbeat?.();
        stopLeaseHeartbeat = null;
        updateTaskProgress(input.task.id, { status: "persisting_result", message: "正在保存最终结果" }, database);
        appendEvent({
          agent_id: input.task.agent_id,
          task_id: input.task.id,
          conversation_id: input.task.conversation_id,
          type: "assistant.message",
          payload: { text },
          created_at: nextEventTimestamp(),
        }, database);
        markTaskCompleted(input.task.id, text, database);
        appendEvent({
          agent_id: input.task.agent_id,
          task_id: input.task.id,
          conversation_id: input.task.conversation_id,
          type: "task.completed",
          payload: { result: text },
          created_at: nextEventTimestamp(),
        }, database);
        try {
          // Episode 是“做过什么”的情景摘要。失败不能回滚聊天结果，只记录 episode.failed。
          upsertEpisodeForTask(input.task.id, database);
        } catch (error) {
          appendEvent({
            agent_id: input.task.agent_id,
            task_id: input.task.id,
            conversation_id: input.task.conversation_id,
            type: "episode.failed",
            payload: { error: error instanceof Error ? error.message : String(error) },
            created_at: nextEventTimestamp(),
          }, database);
        }
      },
      onError: ({ error }) => {
        const message = error instanceof Error ? error.message : String(error);
        failTaskOnce(message);
      },
    }) as unknown as StreamTextRunResult;

    return { result, taskId: input.task.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failTaskOnce(message);
    throw error;
  }
}

function startTaskLeaseHeartbeat(taskId: string, database: Database): () => void {
  const interval = setInterval(() => {
    renewTaskLease(taskId, database);
  }, TASK_LEASE_RENEW_INTERVAL_MS);
  (interval as { unref?: () => void }).unref?.();
  return () => clearInterval(interval);
}

function ensureTaskCanRun(task: TaskRecord, database: Database): void {
  const stored = getTask(task.id, database);
  if (!stored) {
    throw new Error(`Task not found: ${task.id}`);
  }

  if (stored.status === "running") {
    return;
  }

  if (stored.status !== "queued") {
    throw new Error(`Task is not runnable: ${task.id}`);
  }

  const claimed = claimTask(task.id, database);
  if (!claimed) {
    // 同一 Agent 保持单线程：如果已经有 running task，本轮请求返回 queued。
    throw new AgentBusyError(task.agent_id);
  }
}

function createRunAbortSignal(
  clientSignal: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal; reason: () => string; cleanup: () => void } {
  const controller = new AbortController();
  let reason = "";
  // 双重中断来源：客户端断开连接，或模型调用超过内部超时。
  const timeout = setTimeout(() => {
    reason = `Model run timed out after ${timeoutMs}ms`;
    controller.abort();
  }, timeoutMs);
  (timeout as { unref?: () => void }).unref?.();

  const abortFromClient = () => {
    reason = "Client aborted stream";
    clearTimeout(timeout);
    controller.abort();
  };

  if (clientSignal?.aborted) {
    abortFromClient();
  } else {
    clientSignal?.addEventListener("abort", abortFromClient, { once: true });
  }

  return {
    signal: controller.signal,
    reason: () => reason || "Model run aborted",
    cleanup: () => {
      clearTimeout(timeout);
      clientSignal?.removeEventListener("abort", abortFromClient);
    },
  };
}

/**
 * 把 Agent 运行结果转换成前端可直接读取的 UI message stream response。
 *
 * UI message stream response 是 AI SDK 给前端消费的 HTTP 流格式，
 * 里面包含文本增量、工具调用、工具结果等结构化片段。
 *
 * @param run `runAgentTask` 返回的运行结果。
 * @param onFinish 前端流结束时的回调，用于持久化最终 assistant message。
 * @returns 可作为路由响应返回给前端的流式 Response。
 */
export function toAgentUiMessageStreamResponse(
  run: AgentRunResult,
  onFinish: (event: { responseMessage: unknown }) => void,
): Response {
  // AI SDK 的 UI stream response 负责把模型文本、工具调用、工具结果按前端可识别格式输出。
  return run.result.toUIMessageStreamResponse({
    consumeSseStream: consumeStream,
    headers: {
      "access-control-allow-origin": "*",
      "cache-control": "no-cache",
      "connection": "keep-alive",
    },
    onFinish,
  });
}

function getModel(agentId = "default") {
  const config = getConfig();
  const agentConfig = defaultAgentConfigService.getAgentConfig(agentId);
  const provider = config.provider.baseURL
    ? createDeepSeek({ baseURL: config.provider.baseURL })
    : deepseek;
  return provider(agentConfig.model.model);
}
