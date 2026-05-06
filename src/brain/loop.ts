/**
 * Agent Loop — 大脑系统的核心引擎
 *
 * 职责：协调一轮或多轮 LLM 调用，直到获得最终回复或达到最大轮次。
 *
 * 执行流程：
 *   1. 组合消息（system prompt + 对话历史 + 新消息）
 *   2. 调用 Provider，流式产出事件
 *   3. 如果没有工具调用 → 结束
 *   4. 如果有工具调用 → 执行工具 → 将结果追加到消息历史 → 回到步骤 2
 *
 * MVP 阶段：暂不支持工具调用，Agent Loop 退化为单次 LLM 调用的薄封装。
 *
 * 为什么用生成器函数（AsyncIterable）？
 *   上层（信道层）需要实时拿到每个 text_delta 来推给前端做打字机效果。
 *   如果用 Promise<Response> 返回完整结果，前端只能等所有回复完成后一次性展示。
 */

import {
  streamChat,
  type Message,
  type ChatEvent,
  type ToolDef,
} from "./provider";

/**
 * Agent Loop 的输入参数
 */
export interface LoopInput {
  /** 系统提示词 */
  systemPrompt: string;
  /** 消息历史（包含用户最新消息） */
  messages: Message[];
  /** 可用工具列表（MVP 阶段为空） */
  tools?: ToolDef[];
  /** 最大工具调用轮次，防止无限循环（默认 5） */
  maxRounds?: number;
  /** 客户端断开时取消 API 调用 */
  signal?: AbortSignal;
}

/**
 * Agent Loop 的输出结果
 */
export interface LoopOutput {
  /** 完整消息历史（含本轮的 assistant 回复和工具调用结果），用于持久化 */
  messages: Message[];
  /** 结束原因 */
  stopReason: string;
  /** token 用量 */
  usage: { inputTokens: number; outputTokens: number };
}

/** 最终结果事件的类型标识 */
export interface LoopDoneEvent {
  type: "loop_done";
  output: LoopOutput;
}

/**
 * 执行 Agent Loop
 *
 * 通过 AsyncIterable 流式返回 ChatEvent，最后 yield 一个 LoopDoneEvent 携带
 * 完整的消息历史（供信道层持久化）。
 */
export async function* runLoop(
  input: LoopInput,
): AsyncIterable<ChatEvent | LoopDoneEvent> {
  const { systemPrompt, messages, tools, maxRounds = 5, signal } = input;

  // 工作副本，每次工具调用后追加新消息
  const workingMessages: Message[] = [...messages];

  // 记录本轮 assistant 消息的 content blocks
  const assistantBlocks: Message["content"] = [];

  let stopReason = "end_turn";
  let inputTokens = 0;
  let outputTokens = 0;

  for (let round = 0; round < maxRounds; round++) {
    // 客户端已断开，立即停止
    if (signal?.aborted) {
      stopReason = "cancelled";
      break;
    }

    assistantBlocks.length = 0;

    const toolUseEvents: {
      id: string;
      name: string;
      input: Record<string, unknown>;
    }[] = [];
    let hasToolUse = false;

    // 调用 Provider，流式产出事件
    for await (const event of streamChat({
      system: systemPrompt,
      messages: workingMessages,
      tools,
      signal,
    })) {
      yield event;

      switch (event.type) {
        case "text_delta": {
          const last = assistantBlocks.at(-1);
          if (last && last.type === "text") {
            last.text += event.content;
          } else {
            assistantBlocks.push({ type: "text", text: event.content });
          }
          break;
        }

        case "thinking_delta": {
          const last = assistantBlocks.at(-1);
          if (last && last.type === "thinking") {
            last.thinking += event.content;
          } else {
            assistantBlocks.push({
              type: "thinking",
              thinking: event.content,
              signature: "",
            });
          }
          break;
        }

        case "thinking_done": {
          const lastThink = assistantBlocks.findLast(
            (b) => b.type === "thinking",
          ) as
            | { type: "thinking"; thinking: string; signature: string }
            | undefined;
          if (lastThink) {
            lastThink.signature = event.signature;
          }
          break;
        }

        case "tool_use_done":
          hasToolUse = true;
          toolUseEvents.push(event);
          assistantBlocks.push({
            type: "tool_use",
            id: event.id,
            name: event.name,
            input: event.input,
          });
          break;

        case "tool_use_start":
        case "tool_use_delta":
          break;

        case "message_done":
          stopReason = event.stopReason;
          inputTokens = event.inputTokens;
          outputTokens = event.outputTokens;
          break;
      }
    }

    if (!hasToolUse) {
      if (assistantBlocks.length > 0) {
        workingMessages.push({
          role: "assistant",
          content: assistantBlocks,
        });
      }
      break;
    }

    // 工具调用路径——MVP 阶段暂不执行工具，直接 break
    workingMessages.push({
      role: "assistant",
      content: [...assistantBlocks],
    });
    break;
  }

  // 最终事件：携带完整消息历史供上层持久化
  yield {
    type: "loop_done",
    output: {
      messages: workingMessages,
      stopReason,
      usage: { inputTokens, outputTokens },
    },
  };
}
