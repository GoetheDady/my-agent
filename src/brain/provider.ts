/**
 * Provider 模块 — DeepSeek Anthropic API 适配
 *
 * 封装对 DeepSeek Anthropic 兼容 API 的调用，屏蔽认证、请求组装、SSE 解析细节。
 * 上层（Agent Loop）只需传入消息列表，通过 AsyncIterable 消费流式事件。
 *
 * 为什么选择 Anthropic 格式而非 OpenAI 格式？
 *   - Anthropic 的 tool schema 是业界事实标准，生态工具（MCP、Claude Code）天然兼容
 *   - 消息结构更严谨：content 是 blocks 数组，不依赖 OpenAI 的 tool_calls 混合机制
 *   - 后续如果切换 Anthropic/Claude，Provider 实现几乎不用改
 *
 * DeepSeek Anthropic API 兼容性限制（来自官方文档）：
 *   - thinking.budget_tokens 会被忽略（DeepSeek 自行控制思考长度）
 *   - image/document/search_result 等 content block 类型不支持
 *   - is_error 字段被忽略（所有 tool_result 都视为正常结果）
 */

import { getConfig } from "../core/config";

// ============================================================
// 消息类型定义（对齐 Anthropic Messages API）
// ============================================================

/** 文本内容块 */
export interface TextBlock {
  type: "text";
  text: string;
}

/** 工具调用内容块（LLM 返回） */
export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/** 工具调用结果内容块（发给 LLM） */
export interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
}

/** 思考内容块（LLM 返回，DeepSeek 支持） */
export interface ThinkingBlock {
  type: "thinking";
  thinking: string;
  signature: string;
}

/** 消息角色 */
export type MessageRole = "user" | "assistant";

/** 一条消息 */
export interface Message {
  role: MessageRole;
  content: string | (TextBlock | ToolUseBlock | ToolResultBlock | ThinkingBlock)[];
}

/** 工具定义（对齐 Anthropic tool schema） */
export interface ToolDef {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

// ============================================================
// 流式事件类型
// ============================================================

/** 流式事件：文本增量 */
export interface TextDeltaEvent {
  type: "text_delta";
  content: string;
}

/** 流式事件：思考增量 */
export interface ThinkingDeltaEvent {
  type: "thinking_delta";
  content: string;
}

/** 流式事件：思考结束（携带签名，下轮对话必须回传） */
export interface ThinkingDoneEvent {
  type: "thinking_done";
  signature: string;
}

/** 流式事件：工具调用开始 */
export interface ToolUseStartEvent {
  type: "tool_use_start";
  id: string;
  name: string;
}

/** 流式事件：工具调用参数增量（partial JSON） */
export interface ToolUseDeltaEvent {
  type: "tool_use_delta";
  id: string;
  partialJson: string;
}

/**
 * 流式事件：工具调用参数完整
 *
 * 为什么在 stop 事件里才提供完整 input？
 *   SSE delta 事件中的 partial_json 不完整，任何时刻 parse 都会失败。
 *   只有 content_block_stop 事件到达后，才能拼出完整的 JSON 并 parse。
 */
export interface ToolUseDoneEvent {
  type: "tool_use_done";
  id: string;
  name: string;
  input: Record<string, unknown>;
  /** JSON 解析失败时的错误信息（undefined 表示解析成功） */
  _parseError?: string;
}

/** 流式事件：消息结束（携带 stop_reason 和 usage 信息） */
export interface MessageDoneEvent {
  type: "message_done";
  stopReason: string;
  inputTokens: number;
  outputTokens: number;
}

/** 所有流式事件的联合类型 */
export type ChatEvent =
  | TextDeltaEvent
  | ThinkingDeltaEvent
  | ThinkingDoneEvent
  | ToolUseStartEvent
  | ToolUseDeltaEvent
  | ToolUseDoneEvent
  | MessageDoneEvent;

// ============================================================
// API 调用
// ============================================================

/**
 * 调用 DeepSeek Anthropic API 并流式返回事件
 *
 * 为什么不用 Anthropic SDK 而是手写 fetch？
 *   MVP 阶段减少依赖。Anthropic SDK 的依赖链较重，且 DeepSeek
 *   的兼容层有一些细微差异（如 budget_tokens 被忽略），SDK 行为不可控。
 *   直接 fetch + SSE 解析更透明，后续切换多厂商时也更容易统一适配。
 *
 * @param system 系统提示词（Anthropic 格式下独立传递，不在 messages 中）
 * @param messages 消息历史
 * @param tools 可用工具列表
 * @param maxTokens 最大输出 token 数
 * @returns 流式事件的异步可迭代对象
 */
export async function* streamChat(params: {
  system: string;
  messages: Message[];
  tools?: ToolDef[];
  maxTokens?: number;
  /** 客户端断开时取消请求，避免浪费 token */
  signal?: AbortSignal;
  /** 是否开启深度思考 */
  thinkingEnabled?: boolean;
}): AsyncIterable<ChatEvent> {
  const config = getConfig();
  const { system, messages, tools, maxTokens = 4096, signal, thinkingEnabled = false } = params;

  // 构建请求体（Anthropic Messages API 格式）
  const body: Record<string, unknown> = {
    model: config.provider.model,
    max_tokens: maxTokens,
    system, // 独立传递，不在 messages 数组中
    messages,
    stream: true,
  };

  if (thinkingEnabled) {
    body.thinking = { type: "enabled" };
  }

  // 只在有工具时才传 tools 字段
  // 为什么空数组也去掉？部分 provider 对 tools: [] 行为不一致（有的报错）
  if (tools && tools.length > 0) {
    body.tools = tools;
  }

  const response = await fetch(`${config.provider.baseUrl}/messages`, {
    method: "POST",
    headers: {
      "x-api-key": config.provider.apiKey,
      "content-type": "application/json",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
    // 传递 AbortSignal，客户端断开时 fetch 立即中止，不再等待 API 响应
    signal,
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `DeepSeek API 错误 (${response.status}): ${errorBody.slice(0, 200)}`,
    );
  }

  if (!response.body) {
    throw new Error("DeepSeek API 返回空响应体");
  }

  // 解析 SSE 流
  yield* parseSSEStream(response.body);
}

// ============================================================
// SSE 解析
// ============================================================

/**
 * SSE 事件中 content_block_start 的原始结构
 *
 * 为什么需要这个中间态？
 *   content_block_delta 和 content_block_stop 事件中不包含 block 类型和名称信息，
 *   必须在 start 时记住当前活跃 block 的元信息，delta 和 stop 时复用。
 */
interface ActiveBlock {
  type: string;           // "text" | "tool_use" | "thinking"
  name?: string;          // 工具名（仅 tool_use 有）
  id?: string;            // 工具调用 ID（仅 tool_use 有）
}

/**
 * 解析 SSE 流，逐个产出 ChatEvent
 *
 * SSE 事件类型对照表（DeepSeek Anthropic API）：
 *   message_start        → 消息开始（忽略，只用于确认）
 *   content_block_start  → 新的 content block 开始 → 记住 block 类型
 *   content_block_delta  → block 内容增量 → 根据类型产出 text/thinking/tool_use delta
 *   content_block_stop   → block 结束 → 产出 done 事件
 *   message_delta        → 消息元数据（stop_reason, usage）
 *   message_stop         → 消息结束
 *   ping                 → 保活，忽略
 *
 * 为什么不能用 EventSource API？
 *   EventSource 只支持 GET 请求，不支持 POST 的自定义 header。
 *   Anthropic API 创建 message 必须 POST，因此需要手动解析 SSE 流。
 */
async function* parseSSEStream(
  body: ReadableStream<Uint8Array>,
): AsyncIterable<ChatEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let activeBlock: ActiveBlock | null = null;

  // 工具调用增量缓冲：累积 partial_json，stop 时完整解析
  let toolUseJsonBuffer = "";

  // 思考签名缓冲：累积 signature_delta，stop 时拼接完整签名
  // 为什么需要签名？Anthropic API 要求下轮对话将 thinking 块原样回传，
  // signature 用于防止内容篡改。DeepSeek 的 Anthropic 兼容层也支持此字段。
  let thinkingSignature = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // 按行分割 SSE 事件
      // SSE 格式：每行以 "data: " 开头，空行表示事件结束
      const lines = buffer.split("\n");
      // 保留最后一行（不完整的行留在 buffer 中下次处理）
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();

        // ping 保活事件直接跳过
        if (data === "" || data === "[DONE]") continue;

        let event: unknown;
        try {
          event = JSON.parse(data);
        } catch {
          // JSON 解析失败时跳过该行
          // 可能是网络传输中被截断的 chunk，下一轮会重新拼接
          continue;
        }

        const ev = event as Record<string, unknown>;

        switch (ev.type) {
          case "content_block_start": {
            const block = ev.content_block as Record<string, unknown> | undefined;
            if (!block) break;

            activeBlock = {
              type: block.type as string,
              name: block.name as string | undefined,
              id: block.id as string | undefined,
            };

            // 工具调用开始时产出 start 事件
            if (block.type === "tool_use") {
              yield {
                type: "tool_use_start",
                id: block.id as string,
                name: block.name as string,
              };
              // 重置 JSON 缓冲区，准备接收参数
              toolUseJsonBuffer = "";
            }
            break;
          }

          case "content_block_delta": {
            const delta = ev.delta as Record<string, unknown> | undefined;
            if (!delta || !activeBlock) break;

            switch (activeBlock.type) {
              case "text": {
                // 文本增量直接透传
                const text = delta.text as string;
                if (text) {
                  yield { type: "text_delta", content: text };
                }
                break;
              }
              case "thinking": {
                // 思考内容增量
                const thinking = delta.thinking as string;
                if (thinking) {
                  yield { type: "thinking_delta", content: thinking };
                }
                // 签名增量：累积后用于下轮对话回传
                const sigDelta = delta.signature_delta as string;
                if (sigDelta) {
                  thinkingSignature += sigDelta;
                }
                break;
              }
              case "tool_use": {
                // 工具参数增量：累积 partial_json
                const partial = delta.partial_json as string;
                if (partial) {
                  toolUseJsonBuffer += partial;
                  yield {
                    type: "tool_use_delta",
                    id: activeBlock.id ?? "",
                    partialJson: partial,
                  };
                }
                break;
              }
            }
            break;
          }

          case "content_block_stop": {
            if (!activeBlock) break;

            switch (activeBlock.type) {
              case "thinking": {
                // 签名在下轮发送中必须回传给 API，否则报错 "thought signature required"
                yield {
                  type: "thinking_done",
                  signature: thinkingSignature,
                };
                thinkingSignature = "";
                break;
              }
              case "tool_use": {
                // 所有 partial_json 已收集完毕，完整 parse
                let input: Record<string, unknown> = {};
                let parseError = false;
                try {
                  input = JSON.parse(toolUseJsonBuffer);
                } catch {
                  // JSON 解析失败时返回空对象 + 错误标记
                  // 上层可据此决定是重试还是跳过该工具调用
                  parseError = true;
                }
                yield {
                  type: "tool_use_done",
                  id: activeBlock.id ?? "",
                  name: activeBlock.name ?? "",
                  input,
                  // 通过 _parseError 告知上层 JSON 解析状态
                  _parseError: parseError ? "工具参数 JSON 解析失败" : undefined,
                };
                toolUseJsonBuffer = "";
                break;
              }
            }
            activeBlock = null;
            break;
          }

          case "message_delta": {
            // 消息元数据：stop_reason 和 usage
            const delta = ev.delta as Record<string, unknown> | undefined;
            const usage = ev.usage as Record<string, number> | undefined;
            if (delta) {
              yield {
                type: "message_done",
                stopReason: (delta.stop_reason as string) ?? "end_turn",
                inputTokens: usage?.input_tokens ?? 0,
                outputTokens: usage?.output_tokens ?? 0,
              };
            }
            break;
          }

          // message_start 和 message_stop 无需处理
          // ping 事件已被上面的大 data 空值判断跳过
        }
      }
    }
  } finally {
    // 确保 reader 被释放
    // 不做 cancel——正常结束时 reader 已自动释放
    reader.releaseLock();
  }
}
