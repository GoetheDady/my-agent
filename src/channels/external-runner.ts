import { generateText, type ModelMessage, stepCountIs } from "ai";
import { createDeepSeek, deepseek } from "@ai-sdk/deepseek";
import type { Database } from "bun:sqlite";
import { defaultAgentConfigService } from "../agents/config-service";
import { getConfig } from "../core/config";
import { getDb } from "../core/database";
import { appendEvent } from "../events/event-log";
import { buildAgentSystemPrompt } from "../prompts/agent-prompt";
import { defaultSkillService } from "../skills";
import { markTaskCompleted, markTaskFailed } from "../tasks/task-store";
import { claimTask } from "../tasks/task-queue";
import { buildAgentTools } from "../tools/service";
import { defaultChannelService } from "./service";
import type { ChannelReceiveResult } from "./types";

export interface RunExternalChannelTaskInput {
  received: ChannelReceiveResult;
  userText: string;
  deliverMetadata?: Record<string, unknown>;
  database?: Database;
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
 * 运行非 Web 渠道 task，并在完成后通过 ChannelService 回发。
 *
 * Web 使用 HTTP stream，所以走 routes/chat 的流式路径。飞书/微信这类外部渠道
 * 没有前端连接可复用，需要后台完整跑完模型后再主动投递回复。
 */
export async function runExternalChannelTask(input: RunExternalChannelTaskInput): Promise<void> {
  const database = input.database ?? getDb();
  const task = input.received.task;
  const claimed = claimTask(task.id, database);
  if (!claimed) {
    appendEvent({
      agent_id: task.agent_id,
      task_id: task.id,
      conversation_id: task.conversation_id,
      type: "task.failed",
      payload: { error: "Agent is busy or task is not queued" },
    }, database);
    return;
  }

  appendEvent({
    agent_id: task.agent_id,
    task_id: task.id,
    conversation_id: task.conversation_id,
    type: "task.started",
    payload: { input: task.input, source_channel: task.source_channel },
  }, database);

  try {
    const messages: ModelMessage[] = [
      { role: "user", content: [{ type: "text", text: input.userText }] },
    ];
    const result = await generateText({
      model: getModel(task.agent_id),
      system: buildAgentSystemPrompt(task, database, { skillService: defaultSkillService }),
      messages,
      tools: buildAgentTools({
        agentId: task.agent_id,
        taskId: task.id,
        conversationId: task.conversation_id,
        database,
      }),
      stopWhen: stepCountIs(5),
    });

    markTaskCompleted(task.id, result.text, database);
    appendEvent({
      agent_id: task.agent_id,
      task_id: task.id,
      conversation_id: task.conversation_id,
      type: "assistant.message",
      payload: { text: result.text },
    }, database);
    appendEvent({
      agent_id: task.agent_id,
      task_id: task.id,
      conversation_id: task.conversation_id,
      type: "task.completed",
      payload: { result: result.text },
    }, database);
    await defaultChannelService.deliverMessage({
      channel: input.received.channel,
      conversationId: input.received.conversationId,
      taskId: task.id,
      text: result.text,
      metadata: input.deliverMetadata,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    markTaskFailed(task.id, message, database);
    appendEvent({
      agent_id: task.agent_id,
      task_id: task.id,
      conversation_id: task.conversation_id,
      type: "task.failed",
      payload: { error: message },
    }, database);
    try {
      await defaultChannelService.deliverMessage({
        channel: input.received.channel,
        conversationId: input.received.conversationId,
        taskId: task.id,
        text: `处理失败：${message}`,
        metadata: input.deliverMetadata,
      });
    } catch {
      // 如果失败回复也发不出去，task.failed 事件已经保留了根因。
    }
  }
}
