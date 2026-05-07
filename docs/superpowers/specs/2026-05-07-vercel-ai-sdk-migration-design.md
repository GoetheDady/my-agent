# 全面采用 Vercel AI SDK 迁移设计

**日期**: 2026-05-07
**状态**: 待审核
**SDK 版本**: ai@6 (stable)

## 1. 背景与动机

当前系统手动实现 SSE 解析（后端 `provider.ts` 431 行 + 前端 `chatStore.ts` 手动 SSE 消费 ~80 行），且绑定 Anthropic 消息格式。

迁移到 Vercel AI SDK 的核心收益：

- **消除手动 SSE 解析** — 后端和前端各删除数百行手写代码
- **多 Provider 支持** — 统一接口，切换 OpenAI/Claude/Gemini 只改 provider 初始化
- **OpenAI 格式优先** — DeepSeek 使用原生 OpenAI 兼容格式，不再走 Anthropic 兼容层
- **工具调用循环** — AI SDK 内置多步工具执行，不需要手写 runLoop
- **Thinking/Reasoning** — AI SDK 原生支持 DeepSeek 的思考模式
- **前端状态管理简化** — `useChat` hook 接管消息列表、流式渲染、中断处理

## 2. 依赖变更

### 后端 (`package.json`)

```
新增: ai@^5, @ai-sdk/deepseek
预留: zod（工具定义需要，随 tools.ts 实际开发时添加）
删除: 无（lancedb 保持）
```

### 前端 (`web/package.json`)

```
新增: ai@^5, @ai-sdk/react
保持: zustand（非聊天状态）、react、tailwindcss 等
```

## 3. 后端架构变更

### 3.1 删除文件

| 文件 | 行数 | 原因 |
|------|------|------|
| `src/brain/provider.ts` | 431 | SSE 解析 + Anthropic 消息类型 + 手写 fetch 全部被 AI SDK 替代 |
| `src/brain/loop.ts` | 196 | 手动工具调用循环被 `streamText` + `stopWhen` 替代 |

### 3.2 修改 `src/core/config.ts`

```ts
// 变更 1: 默认模型
const DEFAULT_MODEL = "deepseek-v4-flash";  // 原为 deepseek-chat

// 变更 2: 默认 baseUrl
// @ai-sdk/deepseek 自带默认地址 https://api.deepseek.com
// 不再需要 /anthropic 后缀，也不需要 /v1（provider 内部处理）
const DEFAULT_BASE_URL = undefined;  // 使用 provider 默认值

// 变更 3: 配置接口适配
export interface ProviderConfig {
  apiKey: string;
  model: string;
  // baseUrl 改为可选，有值时传给 createDeepSeek({ baseURL })
  // 无值时用 provider 默认
}
```

注意：不再区分 Anthropic 格式和 OpenAI 格式。DeepSeek 统一走 OpenAI 兼容格式。

### 3.3 重写 `src/channels/http.ts` 聊天端点

#### 核心 API 调用

```ts
import { streamText, generateText, stepCountIs, consumeStream, convertToModelMessages } from 'ai';
import { createDeepSeek, deepseek } from '@ai-sdk/deepseek';
```

**关键：使用正确的 API 名称（ai@6 stable）**

- `deepseek` — 小写（模型工厂）。自定义 baseURL 用 `createDeepSeek({ baseURL })` 创建 provider
- `toUIMessageStreamResponse()` — 配合前端 `useChat` 使用（NOT `toDataStreamResponse()`）
- `stopWhen: stepCountIs(5)` — 替代已弃用的 `maxSteps`
- `consumeStream` — 用于 abort 持久化，传给 `consumeSseStream` 参数
- `convertToModelMessages` — 将 UIMessage 转为 ModelMessage（async，需要 await）

#### 聊天端点伪代码

```ts
async function handleChat(req: Request, defaultSystemPrompt: string): Promise<Response> {
  const body = await req.json();
  const { messages, sessionId, thinkingEnabled } = parseRequestBody(body);

  // 记忆增强系统提示
  const enhancedPrompt = await enhancePromptWithMemories(defaultSystemPrompt, messages);

  const provider = config.provider.baseURL
    ? createDeepSeek({ baseURL: config.provider.baseURL })
    : deepseek;
  const model = provider(config.provider.model);

  // 构建 AI SDK 消息格式
  // convertToModelMessages 是 async，将 UIMessage（parts 数组）转为 ModelMessage
  const modelMessages = await convertToModelMessages(body.messages);

  // 获取持久化相关的上下文
  const capturedSessionId = sessionId ?? createSession().id;
  let fullResponseText = "";

  const result = streamText({
    model,
    system: enhancedPrompt,
    messages: modelMessages,
    stopWhen: stepCountIs(5),     // 替代 maxSteps（已弃用）
    abortSignal: req.signal,       // 客户端断开时取消

    // thinking 模式：通过 providerOptions 开启
    providerOptions: thinkingEnabled
      ? { deepseek: { thinking: { type: 'enabled' } } }
      : undefined,

    // streamText 的 onFinish：正常完成时触发，abort 时不触发
    onFinish: async ({ response, steps, usage }) => {
      // 持久化用户消息
      const lastUserMsg = messages.filter((m: { role: string }) => m.role === "user").at(-1);
      if (lastUserMsg) {
        const text = typeof lastUserMsg.content === "string"
          ? lastUserMsg.content
          : JSON.stringify(lastUserMsg.content);
        appendMessage(capturedSessionId, "user", text);
      }

      // 持久化助手消息
      fullResponseText = extractTextFromResponse(response);
      if (fullResponseText) {
        appendMessage(capturedSessionId, "assistant", serializeForStorage(response));
      }
      // 记忆 prefetch
      queuePrefetch(fullResponseText.slice(0, 500));
      // 标题生成（异步，不阻塞响应）
      generateAndSaveTitle(capturedSessionId, messages, fullResponseText);
    },
  });

  // 使用 toUIMessageStreamResponse（NOT toDataStreamResponse）
  // 关键：consumeSseStream: consumeStream 确保流被消费，onFinish 在 abort 时也能触发
  const response = result.toUIMessageStreamResponse({
    // 合并 CORS headers
    headers: {
      "access-control-allow-origin": "*",
      "cache-control": "no-cache",
      "connection": "keep-alive",
    },
    // consumeStream 确保即使客户端断开，流也会被完整消费
    // 这样 onFinish 回调才能在 abort 时触发并持久化部分消息
    consumeSseStream: consumeStream,
    // onFinish 在正常完成和 abort 时都会触发（因为 consumeStream 保证了消费）
    onFinish: ({ isAborted, responseMessage }) => {
      if (isAborted) {
        // 中断时持久化已收到的部分内容
        const partialText = extractTextFromMessage(responseMessage);
        if (partialText) {
          // 持久化用户消息
          const lastUserMsg = messages.filter((m: { role: string }) => m.role === "user").at(-1);
          if (lastUserMsg) {
            const text = typeof lastUserMsg.content === "string"
              ? lastUserMsg.content
              : JSON.stringify(lastUserMsg.content);
            appendMessage(capturedSessionId, "user", text);
          }
          appendMessage(capturedSessionId, "assistant", partialText);
        }
      }
      // 正常完成的持久化由 streamText 的 onFinish 处理
    },
  });

  return response;
}
```

#### Abort 持久化处理（Critical）

**问题**：AI SDK 的 `streamText` 的 `onFinish` 回调**不会在中断时触发**。

**方案**：使用 `toUIMessageStreamResponse()` 的 `consumeSseStream: consumeStream` 参数。

关键原理：
- `consumeStream` 确保即使客户端断开连接，ReadableStream 也会被完整消费
- 这使得 `toUIMessageStreamResponse` 的 `onFinish` 回调在 abort 时也能触发
- `onFinish` 接收 `{ isAborted, responseMessage }` 参数，据此区分正常完成和中断

```ts
result.toUIMessageStreamResponse({
  consumeSseStream: consumeStream,  // 关键：确保流被消费
  onFinish: ({ isAborted, responseMessage }) => {
    if (isAborted) {
      persistPartialResult(capturedSessionId, responseMessage);
    }
  },
});
```

**注意**：这需要在 PoC 中验证 `consumeStream` 在 Bun.serve 下是否正常工作。
如果不行，备选方案是包装 ReadableStream，监听 `cancel` 事件。

两个 `onFinish` 回调的职责分离：
- **`streamText` 的 `onFinish`** — 正常完成时持久化完整消息 + 触发标题生成
- **`toUIMessageStreamResponse` 的 `onFinish`** — abort 时持久化部分消息

#### 消息格式转换

前端 `useChat` 发送 AI SDK 标准的 `UIMessage` 格式（`parts` 数组）。后端需要转换：

```ts
import { convertToModelMessages } from 'ai';

// 从 req.json() 解析出 messages
// useChat 发送的格式: { messages: UIMessage[], sessionId, thinkingEnabled }
const modelMessages = await convertToModelMessages(body.messages);
```

#### 消息持久化格式变更

从 Anthropic blocks 格式：
```json
[{"type": "text", "text": "..."}, {"type": "tool_use", "id": "...", "name": "...", "input": {}}]
```

改为 AI SDK parts 格式：
```json
[{"type": "text", "text": "..."}, {"type": "tool-invocation", "toolInvocation": {"toolName": "...", "args": {}}}]
```

需要更新 `parseDbContent()` 以兼容新旧格式（过渡期）。

#### 标题生成

```ts
async function generateAndSaveTitle(sessionId: string, messages, assistantText: string) {
  try {
    const { text: title } = await generateText({
      model: (config.provider.baseURL ? createDeepSeek({ baseURL: config.provider.baseURL }) : deepseek)(getConfig().provider.model),
      system: "你是标题生成器。只返回标题文本，不要任何额外内容。",
      prompt: `根据以下对话生成简短标题（不超过20字，不要引号句号）：\n用户：${userText}\n助手：${assistantText}`,
      maxTokens: 50,
      abortSignal: AbortSignal.timeout(8000),
    });
    const cleaned = title.trim().replace(/^["""']+|["""']+$/g, "").slice(0, 30);
    if (cleaned) updateSessionTitle(sessionId, cleaned);
  } catch { /* 标题生成失败不影响主流程 */ }
}
```

**标题更新通知**：前端通过 AI SDK 的自定义流数据或独立的轮询获取。见 4.3 节。

#### CORS 处理

`toUIMessageStreamResponse()` 创建自己的 `Response`，需要通过其 `headers` 参数合并 CORS 头：

```ts
result.toUIMessageStreamResponse({
  headers: {
    "access-control-allow-origin": "*",
    "cache-control": "no-cache",
    "connection": "keep-alive",
  },
});
```

### 3.4 新增 `src/brain/tools.ts`（预留）

未来工具定义使用 AI SDK tool schema：

```ts
import { tool } from 'ai';
import { z } from 'zod';

export const tools = {
  // 示例：搜索工具
  // search: tool({
  //   description: '搜索相关信息',
  //   parameters: z.object({ query: z.string() }),
  //   execute: async ({ query }) => { ... },
  // }),
};
```

## 4. 前端架构变更

### 4.1 `useChat` 集成方式

```tsx
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';

function ChatComponent() {
  const { sessionId, thinkingEnabled, setSessionId } = useChatStore();
  const fetchSessions = useSessionStore(s => s.fetchSessions);

  const {
    messages,
    sendMessage,
    status,          // 'submitted' | 'streaming' | 'ready' | 'error'
    stop,            // 中止流式请求
    setMessages,     // 手动设置消息（用于加载历史）
  } = useChat({
    transport: new DefaultChatTransport({
      api: '/api/chat',
    }),
    onFinish: (message) => {
      // 流正常结束时触发
      // 触发记忆提取
      const userText = extractLastUserText(messages);
      const assistantText = extractTextFromParts(message.parts);
      if (userText && sessionId) {
        triggerMemoryExtract(message.id, userText, assistantText, sessionId);
      }
      // 延迟刷新 session 列表以获取新标题
      setTimeout(() => fetchSessions(), 2000);
    },
    onError: (error) => {
      console.error('Chat error:', error);
    },
  });

  // 发送消息时传入动态 body
  // 注意：body 在 sendMessage 调用时传入（非 transport 配置）
  // 因为 sessionId/thinkingEnabled 可能变化，需要在请求时才确定
  const handleSend = (text: string) => {
    sendMessage(
      { text },
      {
        body: {
          sessionId,
          thinkingEnabled,
        },
      },
    );
  };

  // 渲染消息
  return messages.map(msg => (
    <div key={msg.id}>
      {msg.parts.map((part, i) => {
        switch (part.type) {
          case 'text':
            return <TextBlock key={i} text={part.text} />;
          case 'reasoning':
            return <ThinkingBlock key={i} text={part.text} />;
          case 'tool-invocation':
            return <ToolBlock key={i} invocation={part.toolInvocation} />;
        }
      })}
    </div>
  ));
}
```

### 4.2 Zustand Store 简化

`web/src/store/chatStore.ts` 大幅精简：

**删除：**
- `streamChat()` 函数 — 手动 SSE 解析（~80 行）
- `throttledTextBuffer` / `throttleTimer` / `flushTextBuffer` — 节流逻辑（~30 行）
- `isLoading` / `streamingMessageId` / `streamingBlocks` — `useChat` 接管
- `sendMessage` — 由 `useChat` 的 `sendMessage` 替代
- `abortRequest` — 由 `useChat` 的 `stop` 替代
- `messages` — 由 `useChat` 的 `messages` 替代
- `toApiMessages()` — `useChat` 自动序列化
- `parseDbContent()` — 保留但适配新格式

**保留：**
- `sessionId` / `setSessionId` — 会话管理
- `thinkingEnabled` / `setThinkingEnabled` — 思考模式开关
- `memoryStatusMap` — 记忆提取状态
- `loadSession()` — 加载历史消息后注入 `useChat` 的 `setMessages`
- `triggerMemoryExtract()` — 独立函数，在 `useChat` 的 `onFinish` 中调用

### 4.3 标题更新方案

**方案**：流结束后前端延迟刷新 session 列表。

- 后端在 `onFinish` 中异步生成标题并更新数据库
- 前端在 `useChat` 的 `onFinish` 回调中 `setTimeout(() => fetchSessions(), 2000)`
- 2 秒延迟确保后端标题生成（8 秒超时）在多数情况下已完成

相比当前的即时 `title_update` SSE 事件，有 2 秒延迟，但实现简单且不侵入 AI SDK 的流协议。如果后续需要即时更新，可改用 AI SDK 的自定义 data part。

### 4.4 历史消息加载

加载会话历史时，需要将数据库中的消息转为 AI SDK 的 `UIMessage` 格式：

```ts
loadSession: async (sessionId: string) => {
  const rawMessages = await fetchMessages(sessionId);
  // 转换为 useChat 的 messages 格式
  const uiMessages = rawMessages.map(m => ({
    id: m.id,
    role: m.role,
    parts: parseDbContentToParts(m.content, m.role),
  }));
  return uiMessages;
};

// 然后在组件中：
const loadedMessages = await useChatStore.getState().loadSession(id);
setMessages(loadedMessages);
```

### 4.5 前端类型适配

`web/src/types/index.ts` 中的类型需要适配：

```ts
// 删除旧的 SSE 类型: SSETextDelta, SSEThinking, SSEToolStart, SSEToolDone, SSEDone, SSEError
// 使用 AI SDK 的类型: UIMessage, UIPart

// DisplayBlock 保留用于 UI 渲染，但从 AI SDK parts 映射
export type DisplayBlock =
  | { type: "text"; content: string }
  | { type: "thinking"; content: string; collapsed: boolean }
  | { type: "tool_use"; toolName: string; toolUseId: string; toolInput?: Record<string, unknown>; content: string };
```

## 5. Bun 兼容性验证计划

AI SDK 使用标准 Web API（`ReadableStream`、`TransformStream`、`TextEncoder`），理论上与 Bun.serve 兼容。但需要验证的关键点：

### PoC 验证项

1. `streamText` + `toUIMessageStreamResponse()` 在 Bun.serve 下正常返回流式响应
2. 前端 `useChat` + `DefaultChatTransport` 能正确消费该流
3. `abortSignal` 在客户端断开时正确传播（Bun.serve 的 `req.signal` 是否正确触发）
4. thinking/reasoning parts 在流中正确传递
5. `consumeStream` + `toUIMessageStreamResponse` 的 `onFinish` 在 abort 时是否触发
6. `deepseek-v4-flash` 模型名是否被 `@ai-sdk/deepseek` provider 正确识别

### PoC 最小代码

后端：
```ts
import { streamText, stepCountIs, consumeStream } from 'ai';
import { deepseek } from '@ai-sdk/deepseek';

Bun.serve({
  port: 3000,
  fetch(req) {
    if (req.method === 'POST' && new URL(req.url).pathname === '/api/chat') {
      const result = streamText({
        model: deepseek('deepseek-v4-flash'),
        messages: [{ role: 'user', content: 'Hello' }],
        abortSignal: req.signal,
      });
      return result.toUIMessageStreamResponse({
        consumeSseStream: consumeStream,
        headers: { "access-control-allow-origin": "*" },
      });
    }
    return new Response('Not found', { status: 404 });
  },
});
```

前端：
```tsx
const { messages, sendMessage } = useChat({
  transport: new DefaultChatTransport({ api: '/api/chat' }),
});
// 发送：sendMessage({ text: 'Hello' })
```

**在正式迁移前，先跑通这个 PoC。**

## 6. 不变的部分

| 模块 | 原因 |
|------|------|
| `src/memory/*` | 记忆系统独立于 LLM 调用方式 |
| `src/channels/session-api.ts` | Session CRUD 不变 |
| `src/channels/memory-api.ts` | 记忆 API 端点不变 |
| `src/core/database.ts` | SQLite 基础设施不变 |
| `src/core/runtime.ts` | 运行时抽象不变 |
| 静态文件服务 | `serveStatic()` 不变 |
| CORS preflight 处理 | OPTIONS 请求处理不变 |

## 7. 迁移风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| Bun + AI SDK 流兼容性 | 高 | 先做 PoC 验证 |
| `consumeStream` 在 Bun.serve 下行为 | 高 | PoC 中验证，备选方案：包装 ReadableStream |
| Bun.serve 的 `req.signal` 在客户端断开时是否触发 | 高 | PoC 中验证 |
| 消息持久化格式不兼容 | 中 | `parseDbContent` 兼容新旧两种格式 |
| `deepseek-v4-flash` 模型名不被 provider 识别 | 中 | DeepSeek 官方文档已确认，PoC 验证 |
| 前端 `useChat` + Zustand 双状态管理复杂度 | 中 | 明确职责边界：useChat 管消息/流，zustand 管会话/设置 |
| 已有 config.json 中 `baseUrl` 带 `/anthropic` 后缀 | 中 | config 加载时检测并自动去除，或文档说明 |
| `idleTimeout: 60` 不够长 | 低 | 改为 120，列入 http.ts 具体变更项 |
| 标题生成使用 reasoner 模型时开销大 | 低 | 标题生成固定用轻量模型，不跟随用户配置 |

## 8. 错误处理

`streamText` 的错误分两种情况：

1. **同步错误**（API key 无效、网络不通）— `streamText()` 调用本身抛异常，需在 `handleChat` 的 try/catch 中捕获，返回 JSON 错误响应（流未开始，不用 SSE）
2. **流中错误**（token 超限、模型过载）— 错误在流内传播，AI SDK 会发送错误事件，前端 `useChat` 的 `onError` 回调接收

```ts
async function handleChat(req: Request, defaultSystemPrompt: string): Promise<Response> {
  // ... 解析请求 ...
  try {
    const result = streamText({ ... });
    return result.toUIMessageStreamResponse({ ... });
  } catch (err) {
    // 同步错误：返回 JSON
    return jsonError(err instanceof Error ? err.message : "内部错误", 500);
  }
}
```

## 9. 测试策略

- **PoC 验证**（实施前）：跑通最小 Bun + streamText + useChat 循环
- **消息格式测试**：`parseDbContent` 单元测试，验证新旧两种格式都能正确解析
- **集成测试**：完整聊天流程（发送 → 流式接收 → 持久化 → 加载历史 → 继续对话）
- **abort 测试**：发送消息后中断，验证部分消息被正确持久化

## 10. 回滚计划

- `parseDbContent` 兼容新旧消息格式，回滚后旧代码能读新格式数据
- 保留 git 分支，可快速切回旧版本
- 数据库中无 schema 变更，无需数据迁移

## 11. 文件变更清单

| 文件 | 操作 | 预估行数变化 |
|------|------|-------------|
| `src/brain/provider.ts` | 删除 | -431 |
| `src/brain/loop.ts` | 删除 | -196 |
| `src/brain/tools.ts` | 新增 | +20 (预留) |
| `src/channels/http.ts` | 重写聊天端点，`idleTimeout` 从 60 改为 120 | ~-350 → +200 |
| `src/core/config.ts` | 修改默认值和接口 | ~-5 → +10 |
| `web/src/store/chatStore.ts` | 大幅精简 | -350 → +100 |
| `web/src/types/index.ts` | 删除 SSE 类型，适配 AI SDK 类型 | -30 → +15 |
| `web/src/components/ChatView.tsx` | 适配 `useChat` API | 重构 |
| `package.json` | 修改 | +2 依赖 |
| `web/package.json` | 修改 | +2 依赖 |

**净效果：删除约 600 行手写代码，新增约 350 行，净减 250 行。**
