import { generateText, stepCountIs, type GenerateTextResult, type ModelMessage, type ToolSet } from "ai";
import { createDeepSeek, deepseek } from "@ai-sdk/deepseek";
import type { Database } from "bun:sqlite";
import { defaultAgentConfigService } from "../agents/config-service";
import { getConfig } from "../core/config";
import { getDb } from "../core/database";
import { appendEvent } from "../events/event-log";
import { finalizeEpisodeForTask } from "../memory/episode-store";
import { buildAgentSystemPrompt } from "../prompts/agent-prompt";
import { defaultSkillService } from "../skills";
import { claimTask } from "../tasks/task-queue";
import {
  classifyTaskFailure,
  getTask,
  markTaskCompleted,
  markTaskFailed,
  renewTaskLease,
  TASK_LEASE_RENEW_INTERVAL_MS,
  updateTaskProgress,
} from "../tasks/task-store";
import type { TaskRecord } from "../tasks/task-types";
import { buildAgentTools } from "../tools/service";
import { AgentBusyError } from "./agent-runtime";

export interface InternalAgentTaskResult {
  task: TaskRecord;
  text: string;
}

export interface RunInternalAgentTaskInput {
  task: TaskRecord;
  messages: ModelMessage[];
  database?: Database;
  generateTextRunner?: typeof generateText;
  emptyResultMessage?: string;
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

function normalizeInternalResultText(
  result: GenerateTextResult<ToolSet, never>,
  fallbackMessage: string,
): string {
  const text = result.text.trim();
  if (text) return result.text;

  const toolSummary = summarizeToolOutputs(result);
  if (toolSummary) return toolSummary;
  return fallbackMessage;
}

function getModel(agentId: string) {
  const config = getConfig();
  const agentConfig = defaultAgentConfigService.getAgentConfig(agentId);
  const provider = config.provider.baseURL
    ? createDeepSeek({ baseURL: config.provider.baseURL })
    : deepseek;
  return provider(agentConfig.model.model);
}

/**
 * 执行后台 Agent task。
 *
 * 内部 runner 表示“没有浏览器 HTTP stream 的后台执行器”。它用于 delegation
 * 子任务和 callback task，完整跑完模型后返回最终文本。
 */
export async function runInternalAgentTask(input: RunInternalAgentTaskInput): Promise<InternalAgentTaskResult> {
  const database = input.database ?? getDb();
  const claimed = ensureClaimed(input.task, database);
  updateTaskProgress(claimed.id, { status: "preparing", message: "正在准备后台任务" }, database);
  const stopLeaseHeartbeat = startTaskLeaseHeartbeat(claimed.id, database);
  appendEvent({
    agent_id: claimed.agent_id,
    task_id: claimed.id,
    conversation_id: claimed.conversation_id,
    type: "task.started",
    payload: { input: claimed.input, source_channel: claimed.source_channel },
  }, database);

  try {
    const runner = input.generateTextRunner ?? generateText;
    updateTaskProgress(claimed.id, { status: "building_prompt", message: "正在构建提示词" }, database);
    const systemPrompt = buildAgentSystemPrompt(claimed, database, { skillService: defaultSkillService });
    updateTaskProgress(claimed.id, { status: "calling_model", message: "正在调用模型" }, database);
    const result = await runner({
      model: getModel(claimed.agent_id),
      system: systemPrompt,
      messages: input.messages,
      tools: buildAgentTools({
        agentId: claimed.agent_id,
        taskId: claimed.id,
        conversationId: claimed.conversation_id,
        sourceChannel: claimed.source_channel,
        sourceUserId: claimed.source_user_id,
        database,
      }),
      stopWhen: stepCountIs(5),
    }) as GenerateTextResult<ToolSet, never>;

    const text = normalizeInternalResultText(
      result,
      input.emptyResultMessage ?? "模型没有返回可用文本结果。",
    );

    if (result.steps.flatMap((step) => step.toolResults).length > 0) {
      updateTaskProgress(claimed.id, { status: "using_tool", message: "已完成工具调用" }, database);
    }
    updateTaskProgress(claimed.id, { status: "persisting_result", message: "正在保存最终结果" }, database);
    markTaskCompleted(claimed.id, text, database);
    appendEvent({
      agent_id: claimed.agent_id,
      task_id: claimed.id,
      conversation_id: claimed.conversation_id,
      type: "assistant.message",
      payload: { text },
    }, database);
    appendEvent({
      agent_id: claimed.agent_id,
      task_id: claimed.id,
      conversation_id: claimed.conversation_id,
      type: "task.completed",
      payload: { result: text },
    }, database);
    finalizeEpisodeForTask(claimed.id, database);

    const completed = getTask(claimed.id, database) ?? claimed;
    return { task: completed, text };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const classification = classifyTaskFailure(message, { stage: "model_call" });
    markTaskFailed(claimed.id, message, classification, database);
    appendEvent({
      agent_id: claimed.agent_id,
      task_id: claimed.id,
      conversation_id: claimed.conversation_id,
      type: "task.failed",
      payload: {
        error: message,
        failureType: classification.failure_type,
        failureStage: classification.failure_stage,
        retriable: classification.retriable,
      },
    }, database);
    finalizeEpisodeForTask(claimed.id, database);
    throw error;
  } finally {
    stopLeaseHeartbeat();
  }
}

function startTaskLeaseHeartbeat(taskId: string, database: Database): () => void {
  const interval = setInterval(() => {
    renewTaskLease(taskId, database);
  }, TASK_LEASE_RENEW_INTERVAL_MS);
  (interval as { unref?: () => void }).unref?.();
  return () => clearInterval(interval);
}

function ensureClaimed(task: TaskRecord, database: Database): TaskRecord {
  const stored = getTask(task.id, database);
  if (!stored) throw new Error(`Task not found: ${task.id}`);
  if (stored.status === "running") return stored;
  if (stored.status !== "queued") throw new Error(`Task is not runnable: ${task.id}`);
  const claimed = claimTask(task.id, database);
  if (!claimed) throw new AgentBusyError(task.agent_id);
  return claimed;
}
