# Web 前端实现计划 — Step 5

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 http.ts 中的内联 HTML 替换为 React + Vite + Tailwind CSS 4 + Zustand 前端项目，实现深色极简对话页 MVP。

**Architecture:** 前端独立项目 `web/`，开发模式 Vite proxy 转发 API，生产模式 Bun.serve 托管 `dist/` 静态文件 + SPA fallback。SSE 通信由 Zustand store 内的纯函数 `streamChat` 处理，流式更新 store state 驱动 React 渲染。

**Tech Stack:** React 19, Vite 6, Tailwind CSS 4, Zustand, react-markdown, remark-gfm, rehype-highlight, TypeScript

---

## 文件结构

```
web/                              ← 新建：前端项目根目录
├── index.html
├── vite.config.ts
├── package.json
├── tsconfig.json
└── src/
    ├── main.tsx
    ├── App.tsx
    ├── components/
    │   ├── ChatView.tsx
    │   ├── MessageList.tsx
    │   ├── MessageBubble.tsx
    │   ├── MarkdownContent.tsx
    │   └── ChatInput.tsx
    ├── store/
    │   └── chatStore.ts          ← 含 streamChat 纯函数
    ├── types/
    │   └── index.ts
    └── styles/
        └── globals.css

src/channels/http.ts              ← 修改：替换 serveIndex 为静态文件服务
```

---

### Task 1: 初始化 web/ 项目骨架

**Files:**
- Create: `web/package.json`
- Create: `web/tsconfig.json`
- Create: `web/vite.config.ts`
- Create: `web/index.html`
- Create: `web/src/main.tsx`
- Create: `web/src/styles/globals.css`
- Create: `web/src/App.tsx`

- [ ] **Step 1: 创建 web/ 目录结构**

```bash
mkdir -p web/src/{components,store,types,styles}
```

- [ ] **Step 2: 创建 web/package.json**

```json
{
  "name": "my-agent-web",
  "private": true,
  "version": "0.0.1",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview"
  }
}
```

- [ ] **Step 3: 安装前端依赖**

注意：`bun add` 会超时，使用 `npm install` 代替。

```bash
cd web && npm install -D react@19 react-dom@19 @types/react@19 @types/react-dom@19 @vitejs/plugin-react vite@6 @tailwindcss/vite tailwindcss typescript@6 && npm install zustand react-markdown remark-gfm rehype-highlight && cd ..
```

然后运行 `bun install` 更新根 lockfile。

- [ ] **Step 4: 创建 web/tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedSideEffectImports": true
  },
  "include": ["src"]
}
```

- [ ] **Step 5: 创建 web/vite.config.ts**

```ts
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      "/api": "http://localhost:3001",
    },
  },
});
```

- [ ] **Step 6: 创建 web/index.html**

```html
<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>My Agent</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 7: 创建 web/src/styles/globals.css**

```css
@import "tailwindcss";

@theme {
  --color-bg: #1a1a2e;
  --color-surface: #16213e;
  --color-user-bubble: #0f3460;
  --color-assistant-bubble: #1e293b;
  --color-thinking: #334155;
  --color-text: #e0e0e0;
  --color-accent: #533483;
  --color-code-bg: #0d1117;
}

body {
  margin: 0;
  background-color: var(--color-bg);
  color: var(--color-text);
  font-family: system-ui, -apple-system, sans-serif;
}
```

- [ ] **Step 8: 创建 web/src/main.tsx**

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles/globals.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 9: 创建 web/src/App.tsx（占位）**

```tsx
import ChatView from "./components/ChatView";

export default function App() {
  return <ChatView />;
}
```

- [ ] **Step 10: 验证项目能启动**

```bash
cd web && npx vite --host 0.0.0.0 &
sleep 3
curl -s http://localhost:5173 | head -5
kill %1
```

预期：能看到 HTML 输出。组件会报错（ChatView 未创建），这是正常的。

- [ ] **Step 11: Commit**

```bash
git add web/
git commit -m "feat: 初始化 web/ 前端项目骨架（React + Vite + Tailwind 4）"
```

---

### Task 2: 类型定义

**Files:**
- Create: `web/src/types/index.ts`

- [ ] **Step 1: 创建类型定义文件**

```ts
export interface DisplayBlock {
  type: "text" | "thinking" | "tool_use";
  content: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  collapsed?: boolean;
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  blocks: DisplayBlock[];
}

export interface SSETextDelta {
  content: string;
}

export interface SSEThinking {
  content: string;
}

export interface SSEToolStart {
  name: string;
}

export interface SSEToolDone {
  name: string;
  input: Record<string, unknown>;
}

export interface SSEDone {
  stopReason: string;
  inputTokens: number;
  outputTokens: number;
}

export interface SSEError {
  message: string;
}

export type SSEEventData =
  | SSETextDelta
  | SSEThinking
  | SSEToolStart
  | SSEToolDone
  | SSEDone
  | SSEError;
```

- [ ] **Step 2: Commit**

```bash
git add web/src/types/
git commit -m "feat: 前端类型定义（DisplayBlock, Message, SSE 事件类型）"
```

---

### Task 3: Zustand Store + SSE 通信

**Files:**
- Create: `web/src/store/chatStore.ts`

- [ ] **Step 1: 创建 chatStore.ts**

```ts
import { create } from "zustand";
import type { Message, DisplayBlock } from "../types";

let abortController: AbortController | null = null;

let throttledTextBuffer = "";
let throttleTimer: ReturnType<typeof setTimeout> | null = null;

interface ChatState {
  messages: Message[];
  isLoading: boolean;
  streamingMessageId: string | null;
  streamingBlocks: DisplayBlock[];

  sendMessage: (text: string) => void;
  abortRequest: () => void;
  clearMessages: () => void;
}

function flushTextBuffer(set: (partial: Partial<ChatState>) => void, get: () => ChatState) {
  if (throttledTextBuffer === "") return;
  const state = get();
  const blocks = [...state.streamingBlocks];
  const last = blocks.at(-1);
  if (last && last.type === "text") {
    blocks[blocks.length - 1] = { ...last, content: last.content + throttledTextBuffer };
  } else {
    blocks.push({ type: "text", content: throttledTextBuffer });
  }
  throttledTextBuffer = "";
  set({ streamingBlocks: blocks });
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  isLoading: false,
  streamingMessageId: null,
  streamingBlocks: [],

  sendMessage: (text: string) => {
    const state = get();
    if (state.isLoading) return;

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      blocks: [{ type: "text", content: text }],
    };

    const streamingId = crypto.randomUUID();
    set({
      messages: [...state.messages, userMsg],
      isLoading: true,
      streamingMessageId: streamingId,
      streamingBlocks: [],
    });

    throttledTextBuffer = "";
    throttleTimer = null;

    const apiMessages = toApiMessages([...state.messages, userMsg]);

    const controller = new AbortController();
    abortController = controller;

    streamChat(
      apiMessages,
      (eventType, data) => {
        const s = get();
        switch (eventType) {
          case "text_delta": {
            throttledTextBuffer += data.content;
            if (!throttleTimer) {
              throttleTimer = setTimeout(() => {
                throttleTimer = null;
                flushTextBuffer(set, get);
              }, 50);
            }
            break;
          }
          case "thinking": {
            flushTextBuffer(set, get);
            const blocks = [...s.streamingBlocks];
            const last = blocks.at(-1);
            if (last && last.type === "thinking") {
              blocks[blocks.length - 1] = { ...last, content: last.content + data.content };
            } else {
              blocks.push({ type: "thinking", content: data.content, collapsed: true });
            }
            set({ streamingBlocks: blocks });
            break;
          }
          case "tool_start": {
            flushTextBuffer(set, get);
            const blocks = [...s.streamingBlocks];
            blocks.push({ type: "tool_use", content: "", toolName: data.name });
            set({ streamingBlocks: blocks });
            break;
          }
          case "tool_done": {
            flushTextBuffer(set, get);
            const blocks = [...s.streamingBlocks];
            const idx = blocks.findLastIndex((b) => b.type === "tool_use" && b.toolName === data.name);
            if (idx !== -1) {
              blocks[idx] = { ...blocks[idx], toolInput: data.input, content: JSON.stringify(data.input, null, 2) };
            }
            set({ streamingBlocks: blocks });
            break;
          }
          case "done": {
            flushTextBuffer(set, get);
            break;
          }
          case "error": {
            flushTextBuffer(set, get);
            const errBlock: DisplayBlock = { type: "text", content: `错误: ${data.message}` };
            const streamingBlocks = get().streamingBlocks;
            const assistantMsg: Message = {
              id: streamingId,
              role: "assistant",
              blocks: streamingBlocks.length > 0 ? [...streamingBlocks, errBlock] : [errBlock],
            };
            set({
              messages: [...get().messages, assistantMsg],
              isLoading: false,
              streamingMessageId: null,
              streamingBlocks: [],
            });
            abortController = null;
            break;
          }
        }
      },
      controller.signal,
    ).then(() => {
      const s = get();
      if (s.streamingMessageId !== streamingId) return;
      flushTextBuffer(set, get);
      const finalBlocks = get().streamingBlocks;
      if (finalBlocks.length > 0) {
        const assistantMsg: Message = {
          id: streamingId,
          role: "assistant",
          blocks: finalBlocks,
        };
        set({
          messages: [...s.messages, assistantMsg],
          isLoading: false,
          streamingMessageId: null,
          streamingBlocks: [],
        });
      } else {
        set({ isLoading: false, streamingMessageId: null, streamingBlocks: [] });
      }
      abortController = null;
    });
  },

  abortRequest: () => {
    abortController?.abort();
    abortController = null;
    if (throttleTimer) {
      clearTimeout(throttleTimer);
      throttleTimer = null;
      throttledTextBuffer = "";
    }
    const s = get();
    set({
      isLoading: false,
      streamingMessageId: null,
      streamingBlocks: [],
    });
  },

  clearMessages: () => {
    abortController?.abort();
    abortController = null;
    set({ messages: [], isLoading: false, streamingMessageId: null, streamingBlocks: [] });
  },
}));

function toApiMessages(messages: Message[]) {
  return messages.map((msg) => {
    if (msg.role === "user") {
      return { role: "user" as const, content: msg.blocks.map((b) => b.content).join("\n") };
    }
    const content = msg.blocks
      .filter((b) => b.type !== "thinking")
      .map((b) => {
        if (b.type === "text") return { type: "text" as const, text: b.content };
        if (b.type === "tool_use") return { type: "tool_use" as const, id: "", name: b.toolName ?? "", input: b.toolInput ?? {} };
        return null;
      })
      .filter(Boolean);
    return { role: "assistant" as const, content };
  });
}

async function streamChat(
  messages: { role: string; content: unknown }[],
  onEvent: (type: string, data: any) => void,
  signal: AbortSignal,
) {
  let res: Response;
  try {
    res = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages }),
      signal,
    });
  } catch (err) {
    if (signal.aborted) return;
    onEvent("error", { message: err instanceof Error ? err.message : "网络请求失败" });
    return;
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    onEvent("error", { message: err.error || `HTTP ${res.status}` });
    return;
  }

  if (!res.body) {
    onEvent("error", { message: "响应体为空" });
    return;
  }

  const reader = res.body.getReader();
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
        const eventType = lines.find((l) => l.startsWith("event:"))?.slice(7).trim();
        const dataLine = lines.find((l) => l.startsWith("data:"));
        if (!eventType || !dataLine) continue;

        let data;
        try {
          data = JSON.parse(dataLine.slice(6));
        } catch {
          continue;
        }
        onEvent(eventType, data);
      }
    }
  } catch (err) {
    if (signal.aborted) return;
    onEvent("error", { message: err instanceof Error ? err.message : "连接中断" });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/store/
git commit -m "feat: Zustand chatStore + SSE streamChat 纯函数"
```

---

### Task 4: 组件实现

**Files:**
- Create: `web/src/components/ChatInput.tsx`
- Create: `web/src/components/MarkdownContent.tsx`
- Create: `web/src/components/MessageBubble.tsx`
- Create: `web/src/components/MessageList.tsx`
- Create: `web/src/components/ChatView.tsx`
- Modify: `web/src/App.tsx`

- [ ] **Step 1: 创建 ChatInput.tsx**

```tsx
import { useRef } from "react";
import { useChatStore } from "../store/chatStore";

export default function ChatInput() {
  const { isLoading, sendMessage, abortRequest } = useChatStore();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function handleSend() {
    const text = textareaRef.current?.value.trim() ?? "";
    if (!text || isLoading) return;
    sendMessage(text);
    if (textareaRef.current) textareaRef.current.value = "";
    autoResize();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function autoResize() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }

  return (
    <div className="flex items-end gap-3 border-t border-white/10 bg-[var(--color-surface)] p-4">
      <textarea
        ref={textareaRef}
        className="flex-1 resize-none rounded-lg border border-white/10 bg-[var(--color-bg)] px-4 py-3 text-[var(--color-text)] outline-none placeholder:text-white/30 focus:border-[var(--color-accent)]"
        placeholder="输入消息..."
        rows={1}
        onKeyDown={handleKeyDown}
        onInput={autoResize}
        disabled={isLoading}
      />
      {isLoading ? (
        <button
          onClick={abortRequest}
          className="rounded-lg bg-red-600 px-5 py-3 text-white hover:bg-red-700 disabled:opacity-50"
        >
          停止
        </button>
      ) : (
        <button
          onClick={handleSend}
          className="rounded-lg bg-[var(--color-accent)] px-5 py-3 text-white hover:brightness-110 disabled:opacity-50"
        >
          发送
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 创建 MarkdownContent.tsx**

```tsx
import ReactMarkdown from "react-markdown";
import type { ReactNode, ReactElement } from "react";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { useState } from "react";

export default function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="prose prose-invert max-w-none text-sm [&_pre]:rounded-lg [&_pre]:bg-[var(--color-code-bg)] [&_pre]:p-4 [&_code]:text-xs">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={{
        pre: ({ children }) => <PreBlock>{children}</PreBlock>,
      }}>
        {content}
      </ReactMarkdown>
    </div>
  );
}

function PreBlock({ children }: { children: ReactNode }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    const codeEl = (children as ReactElement)?.props?.children;
    const text = typeof codeEl === "string" ? codeEl : "";
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="relative">
      <button
        onClick={handleCopy}
        className="absolute right-2 top-2 rounded bg-white/10 px-2 py-1 text-xs text-white/60 hover:bg-white/20"
      >
        {copied ? "已复制" : "复制"}
      </button>
      <pre>{children}</pre>
    </div>
  );
}
```

- [ ] **Step 3: 创建 MessageBubble.tsx**

```tsx
import type { Message, DisplayBlock } from "../types";
import MarkdownContent from "./MarkdownContent";

export default function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-[var(--color-user-bubble)] px-4 py-3 text-[var(--color-text)]">
          {message.blocks.map((b, i) => (
            <p key={i} className="whitespace-pre-wrap text-sm">{b.content}</p>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <div className="max-w-[80%] space-y-2">
        {message.blocks.map((block, i) => (
          <BlockRenderer key={i} block={block} />
        ))}
      </div>
    </div>
  );
}

function BlockRenderer({ block }: { block: DisplayBlock }) {
  switch (block.type) {
    case "text":
      return (
        <div className="rounded-2xl rounded-bl-sm bg-[var(--color-assistant-bubble)] px-4 py-3 text-[var(--color-text)]">
          <MarkdownContent content={block.content} />
        </div>
      );
    case "thinking":
      return <ThinkingBlock block={block} />;
    case "tool_use":
      return null;
    default:
      return null;
  }
}

function ThinkingBlock({ block }: { block: DisplayBlock }) {
  const collapsed = block.collapsed !== false;

  if (collapsed) {
    return (
      <details className="rounded-lg bg-[var(--color-thinking)] px-3 py-2">
        <summary className="cursor-pointer text-xs italic text-white/40">
          思考过程...
        </summary>
        <p className="mt-2 whitespace-pre-wrap text-xs italic text-white/50">
          {block.content}
        </p>
      </details>
    );
  }

  return (
    <div className="rounded-lg bg-[var(--color-thinking)] px-3 py-2">
      <p className="whitespace-pre-wrap text-xs italic text-white/50">{block.content}</p>
    </div>
  );
}
```

- [ ] **Step 4: 创建 MessageList.tsx**

```tsx
import { useEffect, useRef } from "react";
import { useChatStore } from "../store/chatStore";
import MessageBubble from "./MessageBubble";

export default function MessageList() {
  const { messages, streamingBlocks, streamingMessageId } = useChatStore();
  const scrollRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);

  function checkNearBottom() {
    const el = scrollRef.current;
    if (!el) return;
    isNearBottomRef.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 50;
  }

  useEffect(() => {
    if (isNearBottomRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streamingBlocks]);

  const streamingMsg = streamingMessageId && streamingBlocks.length > 0
    ? { id: streamingMessageId, role: "assistant" as const, blocks: streamingBlocks }
    : null;

  return (
    <div
      ref={scrollRef}
      onScroll={checkNearBottom}
      className="flex-1 overflow-y-auto px-4 py-6"
    >
      <div className="mx-auto max-w-3xl space-y-4">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        {streamingMsg && <MessageBubble message={streamingMsg} />}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: 创建 ChatView.tsx**

```tsx
import MessageList from "./MessageList";
import ChatInput from "./ChatInput";

export default function ChatView() {
  return (
    <div className="flex h-screen flex-col bg-[var(--color-bg)]">
      <header className="border-b border-white/10 bg-[var(--color-surface)] px-6 py-3">
        <h1 className="text-lg font-semibold text-[var(--color-text)]">My Agent</h1>
      </header>
      <MessageList />
      <ChatInput />
    </div>
  );
}
```

- [ ] **Step 6: 更新 App.tsx（已在 Task 1 创建，确认内容正确）**

App.tsx 已在 Task 1 Step 9 创建，内容就是 `<ChatView />`，无需修改。

- [ ] **Step 7: 验证前端能渲染**

```bash
cd web && npx vite --host 0.0.0.0 &
sleep 3
curl -s http://localhost:5173 | head -10
kill %1
```

预期：能看到 HTML 页面，无 JS 编译错误。

- [ ] **Step 8: Commit**

```bash
git add web/src/components/
git commit -m "feat: 前端组件实现（ChatView, MessageList, MessageBubble, MarkdownContent, ChatInput）"
```

---

### Task 5: 后端静态文件服务

**Files:**
- Modify: `src/channels/http.ts` — 替换 `serveIndex()` 为静态文件服务

- [ ] **Step 1: 修改 http.ts — 删除 serveIndex 函数，添加 serveStatic 函数**

将 `http.ts` 中 `serveIndex()` 函数（约 245-365 行）替换为：

```ts
import { resolve, extname } from "path";
import { readFile, stat } from "fs/promises";

const DIST_DIR = resolve(import.meta.dir, "../../web/dist");

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
};

async function serveStatic(pathname: string): Promise<Response> {
  const safePath = resolve(DIST_DIR, pathname.slice(1) || "index.html");
  if (!safePath.startsWith(DIST_DIR)) {
    return new Response("Forbidden", { status: 403 });
  }

  try {
    const fileStat = await stat(safePath);
    if (!fileStat.isFile()) throw new Error("not a file");
    const data = await readFile(safePath);
    const mime = MIME_TYPES[extname(safePath)] ?? "application/octet-stream";
    return new Response(data, {
      headers: { "content-type": mime, "cache-control": "public, max-age=3600" },
    });
  } catch {
    const indexPath = resolve(DIST_DIR, "index.html");
    try {
      const data = await readFile(indexPath);
      return new Response(data, {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    } catch {
      return new Response("Not Found", { status: 404 });
    }
  }
}
```

- [ ] **Step 2: 修改 http.ts — 更新 fetch 路由**

将 `fetch` 函数中的路由逻辑替换为：

```ts
async fetch(req) {
  const url = new URL(req.url);

  if (req.method === "GET" && url.pathname === "/api/health") {
    return new Response(JSON.stringify({ status: "ok" }), {
      headers: { "content-type": "application/json" },
    });
  }

  if (req.method === "POST" && url.pathname === "/api/chat") {
    return handleChat(req, DEFAULT_SYSTEM_PROMPT);
  }

  if (req.method === "GET") {
    return serveStatic(url.pathname);
  }

  return new Response("Not Found", { status: 404 });
}
```

注意：删除了原来的 `GET /` 路由和 `serveIndex()` 函数。

- [ ] **Step 3: 运行 check**

```bash
bun run check
```

预期：零错误。`fs/promises` 和 `path` 在 Bun 环境下可用。

- [ ] **Step 4: 构建前端并验证集成**

```bash
cd web && npx vite build && cd ..
PORT=3001 bun run src/main.ts &
sleep 2
curl -s http://localhost:3001/ | head -5
curl -s http://localhost:3001/api/health
kill %1
```

预期：`/` 返回 HTML，`/api/health` 返回 `{"status":"ok"}`。

- [ ] **Step 5: Commit**

```bash
git add src/channels/http.ts
git commit -m "feat: 后端静态文件服务（替换内联 HTML，支持 SPA fallback）"
```

---

### Task 6: 端到端验证

**Files:**
- No new files

- [ ] **Step 1: 构建前端**

```bash
cd web && npx vite build && cd ..
```

- [ ] **Step 2: 启动后端**

```bash
PORT=3001 bun run src/main.ts &
sleep 2
```

- [ ] **Step 3: 验证页面可访问**

```bash
curl -s --noproxy "*" http://127.0.0.1:3001/ | head -10
```

预期：返回 `web/dist/index.html` 内容。

- [ ] **Step 4: 验证 SSE 聊天**

```bash
curl -s --noproxy "*" -X POST http://127.0.0.1:3001/api/chat -H "content-type: application/json" -d '{"message":"你好"}' 2>&1 | head -20
```

预期：SSE 流式返回 text_delta 事件。

- [ ] **Step 5: 浏览器手动测试**

打开 `http://127.0.0.1:3001/`，在输入框输入"你好"并发送，预期：
- 用户消息右对齐显示
- 助手消息左对齐，流式打字机效果
- Markdown 正确渲染
- 思考过程（如果有）以折叠面板显示

- [ ] **Step 6: 清理**

```bash
kill %1
```

---

### Task 7: 最终 check + 清理

**Files:**
- No new files

- [ ] **Step 1: 后端 check**

```bash
bun run check
```

预期：零错误。

- [ ] **Step 2: 前端构建验证**

```bash
cd web && npx tsc -b && npx vite build && cd ..
```

预期：零错误，构建成功。

- [ ] **Step 3: 确认根 tsconfig.json 排除 web/**

检查 `tsconfig.json` 中 `"exclude": ["node_modules", "dist", "web"]` 是否存在（应已配置）。

- [ ] **Step 4: Commit（如有未提交的改动）**

```bash
git status
# 如有改动则提交
```
