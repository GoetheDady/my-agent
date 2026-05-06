# Web 前端设计 Spec — Step 5

## 概述

将 `http.ts` 中的内联 HTML 替换为正式的 React 前端项目。范围限定为对话页 MVP。

---

## 技术选型

| 层面 | 选择 | 理由 |
|------|------|------|
| 框架 | React 19 | 组件化开发，生态成熟 |
| 构建 | Vite 6 | 快速 HMR，开发体验好 |
| CSS | Tailwind CSS 4 | 原子化样式，深色主题方便 |
| 状态管理 | Zustand | 轻量、简洁、TypeScript 友好 |
| Markdown | react-markdown + remark-gfm + rehype-highlight | 轻量级渲染 + GFM 支持 + 代码高亮 |
| 语言 | TypeScript | 与后端一致 |

---

## 目录结构

```
web/                              ← 前端项目根目录
├── index.html                    ← Vite 入口
├── vite.config.ts                ← Vite 配置（含 @tailwindcss/vite 插件 + dev proxy）
├── package.json
├── tsconfig.json
└── src/
    ├── main.tsx                  ← React 挂载点
    ├── App.tsx                   ← 根组件
    ├── components/
    │   ├── ChatView.tsx          ← 对话主容器
    │   ├── MessageList.tsx       ← 消息列表（智能滚动）
    │   ├── MessageBubble.tsx     ← 单条消息（区分 role 渲染）
    │   ├── MarkdownContent.tsx   ← Markdown 渲染 + 代码高亮
    │   └── ChatInput.tsx         ← textarea 输入框 + 发送/停止按钮
    ├── store/
    │   └── chatStore.ts          ← Zustand store（含 SSE 通信逻辑）
    ├── types/
    │   └── index.ts              ← 类型定义
    └── styles/
        └── globals.css           ← Tailwind 导入 + 自定义样式 + @theme 配色
```

注意：Tailwind v4 不需要 `tailwind.config.ts` 和 `postcss.config.js`，改用 `@tailwindcss/vite` 插件 + CSS 内 `@import "tailwindcss"` + `@theme` 定义设计令牌。

---

## 组件设计

### ChatView

顶层容器，深色背景，全屏布局。包含 MessageList + ChatInput。

```
┌────────────────────────────────┐
│         MessageList            │  ← flex-1, overflow-y-auto
│                                │
│  [user bubble]        右对齐    │
│  [assistant bubble]  左对齐     │
│  [thinking 折叠]     左对齐     │
│                                │
├────────────────────────────────┤
│  ChatInput                     │  ← 固定底部
│  [textarea]         [发送/停止] │
└────────────────────────────────┘
```

### MessageBubble

根据 DisplayBlock 类型渲染不同样式：

| block 类型 | 样式 |
|------------|------|
| text | 左对齐气泡，Markdown 渲染（react-markdown + rehype-highlight） |
| thinking | 折叠面板，灰色斜体，点击展开，默认折叠 |

user 消息只有 text block，右对齐纯文本。

注意：MVP 阶段后端不执行工具，LLM 不会产出 tool_use 事件，因此 tool_use 的 UI 推迟到 Step 7（工具系统）实现。DisplayBlock 类型定义中保留 `tool_use` 作为预留，MessageBubble 渲染 switch 中 `tool_use` 分支返回 `null`（占位，Step 7 替换为工具面板组件）。

### MarkdownContent

- react-markdown 渲染 Markdown 内容
- rehype-highlight 做代码块语法高亮
- 代码块带一键复制按钮
- 支持表格、列表等 GFM 特性
- **流式渲染优化**：store 层节流 setState（每 50ms flush 一次 text_delta），避免每个 delta 都触发 React re-render 和 MarkdownContent 的 re-parse
- `done` 事件后做一次完整渲染（确保最终结果正确）

### ChatInput

- **textarea** 输入框（支持 Shift+Enter 换行）
- Enter 发送（无 Shift）
- 发送中显示停止按钮（abort 请求）
- 空消息不可发送

### MessageList 智能滚动

- 检测用户是否已贴底（scrollTop + clientHeight >= scrollHeight - 50px）
- 仅在贴底时自动滚动到底部
- 用户向上翻看历史时不强制滚回

---

## Zustand Store 设计

```ts
// store/chatStore.ts

/** 前端展示用的消息单元——一条"消息"可能包含多个 block */
interface DisplayBlock {
  type: "text" | "thinking" | "tool_use";
  content: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  collapsed?: boolean;  // thinking 默认折叠
}

interface Message {
  id: string;           // crypto.randomUUID()
  role: "user" | "assistant";
  blocks: DisplayBlock[];
}

interface ChatState {
  messages: Message[];
  isLoading: boolean;
  streamingMessageId: string | null;
  streamingBlocks: DisplayBlock[];

  sendMessage: (text: string) => void;
  abortRequest: () => void;
  clearMessages: () => void;
}
```

- `sendMessage`：创建 user 消息 → 创建空的 streaming assistant 消息（streamingBlocks=[]）→ 发起 SSE → 流式更新 streamingBlocks → SSE 结束后 streamingBlocks 合入 messages
- `abortRequest`：调用 AbortController.abort()，**丢弃 streamingBlocks**（简化逻辑：中断意味着用户不想要这次回复，保留半成品无意义）
- `isLoading`：控制发送按钮/停止按钮切换
- 流式渲染：MessageBubble 接收 `blocks` 数组，逐个渲染每个 DisplayBlock

### SSE 事件 → Store action 映射表

| 后端 SSE 事件 | Store action |
|---------------|-------------|
| `text_delta` | 追加 `data.content` 到 streamingBlocks 最后一个 text block（无 text block 则新建） |
| `thinking` | 新建 thinking block，追加 `data.content` |
| `tool_start` | 新建 tool_use block，记录 `data.name`（Step 7 实现） |
| `tool_done` | 回填 `data.input` 到对应 tool_use block（Step 7 实现） |
| `done` | 仅停止 loading 动画。不合并 streamingBlocks——合并以 `reader.done`（SSE 流结束）为准 |
| `error` | 追加一条 error 提示到 messages，清空 streaming 状态 |

### thinking signature 处理

后端 `thinking_done` 事件当前被 `http.ts:230-231` 过滤掉了，前端拿不到 signature。而 signature 必须回传到下一轮消息否则 API 报错。

**方案：前端发送下一轮消息时，剥离 assistant 消息中的 thinking blocks。** 这是最简单的方案——thinking 只在前端展示用，不参与 API 交互。后端 `http.ts` 不需要改。

实现：`sendMessage` 构造 API 请求的 messages 时，对每条 assistant 消息过滤掉 `type === "thinking"` 的 blocks。这样 thinking 内容不回传给 API，也就不需要 signature。

---

## SSE 通信（store 内实现）

SSE 解析逻辑是纯函数，直接在 store 的 `sendMessage` action 中调用，不需要单独的 hook。

```ts
// store/chatStore.ts 内部

/** 纯函数：发起 SSE 流式请求，通过 onEvent 回调通知 store */
async function streamChat(
  messages: BackendMessage[],  // 后端 Message 格式（复用 provider.ts 的 Message 类型）
  onEvent: (type: string, data: any) => void,
  signal: AbortSignal,
) {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages }),
    signal,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    onEvent("error", { message: err.error || `HTTP ${res.status}` });
    return;
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop()!;

      for (const part of parts) {
        const lines = part.split("\n");
        const eventType = lines.find(l => l.startsWith("event:"))?.slice(7).trim();
        const dataLine = lines.find(l => l.startsWith("data:"));
        if (!eventType || !dataLine) continue;

        let data;
        try { data = JSON.parse(dataLine.slice(6)); } catch { continue; }
        onEvent(eventType, data);
      }
    }
  } catch (err) {
    if (signal.aborted) return;
    onEvent("error", { message: err instanceof Error ? err.message : "连接中断" });
  }
}
```

关键点：
- AbortController 由 store 持有（`abortRef`）
- 非 2xx 响应处理：解析 JSON 错误消息，通过 error 事件通知
- `signal.aborted` 时静默返回，不报错
- reader.read() 的 AbortError 被 catch 兜住

---

## 与后端的集成

### 开发模式

`vite dev`（端口 5173）→ Vite proxy 转发 `/api/*` 到 `:3001`

```ts
// vite.config.ts
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      "/api": "http://localhost:3001",
    },
  },
});
```

### 生产模式

`vite build` → `dist/`，Bun.serve 托管静态文件：

- `http.ts` 修改：非 `/api/*` 的 GET 请求 → 尝试从 `dist/` 返回静态文件，找不到则返回 `dist/index.html`（SPA fallback）
- API 路由不变
- 仅支持同源部署（开发靠 Vite proxy，生产靠 Bun.serve 同源托管）

### 后端改动

`http.ts` 的 `serveIndex()` 函数替换为静态文件服务：

```ts
// 伪代码
if (url.pathname.startsWith("/api/")) {
  // API 路由...
} else {
  // 静态文件：path.resolve 防止 path traversal，校验仍在 dist/ 前缀内
  // 找不到返回 dist/index.html（SPA fallback）
  return serveStatic(url.pathname);
}
```

---

## API 接口

复用现有接口，不做变更：

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/chat | 发送消息，返回 SSE 流 |
| GET | /api/health | 健康检查 |

前端发送格式改为 `{ messages }` （带完整历史），而非 `{ message }`：

```json
{
  "messages": [
    { "role": "user", "content": "你好" },
    { "role": "assistant", "content": [{ "type": "text", "text": "你好！有什么可以帮你的吗？" }] },
    { "role": "user", "content": "今天天气怎么样" }
  ]
}
```

注意：前端内部 messages 使用 `Message.blocks: DisplayBlock[]`，但发送给 API 时需要转换为后端的 `Message` 格式。转换规则：
- user 消息：`content` 直接用 blocks[0].content（string）
- assistant 消息：`content` 过滤掉 thinking blocks 后，剩余 blocks 转为后端格式

### 多轮 message_done 处理

后端 Agent Loop 可能多轮调用 LLM（工具调用场景），每轮都 emit `message_done`。前端不能把"收到 done"当作关流信号。以 `reader.done`（ReadableStream 结束）为准，`done` 事件只用于更新 UI 状态（如停止 loading 动画）。

---

## 深色主题配色

在 `globals.css` 中用 `@theme` 定义：

| 元素 | CSS 变量 | 颜色 |
|------|----------|------|
| 背景 | --color-bg | #1a1a2e |
| 消息列表背景 | --color-surface | #16213e |
| 用户气泡 | --color-user-bubble | #0f3460 |
| 助手气泡 | --color-assistant-bubble | #1e293b |
| 思考面板 | --color-thinking | #334155 |
| 文字 | --color-text | #e0e0e0 |
| 强调色 | --color-accent | #533483 |
| 代码块背景 | --color-code-bg | #0d1117 |

---

## 不在 Step 5 范围内

- 多会话切换（Step 8）
- 会话持久化（Step 6）
- Agent 管理页
- 配置页
- WebSocket 状态推送
- 消息操作（重新生成、编辑、复制）
- /agent /skill 命令
- tool_use UI 渲染（Step 7，随工具系统一起实现）
- CORS preflight 处理（仅支持同源部署）
