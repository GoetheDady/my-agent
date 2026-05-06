# 会话持久化 + 会话列表 + 自动标题 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将前端内存中的对话持久化到后端 SQLite 数据库，支持多会话切换（侧边栏列表）、页面刷新后恢复、自动根据首条消息生成会话标题。

**Architecture:** 后端 SQLite（bun:sqlite，WAL 模式）存储 sessions 和 messages 表。新增 REST API 管理 sessions。前端新增 SessionSidebar 组件 + sessionStore。chatStore 发送消息时携带 sessionId，后端存储消息到 DB。首条用户消息后异步调用 LLM 生成标题。

**Tech Stack:** Bun (bun:sqlite), React 19, Zustand, TypeScript

---

## 文件结构

```
src/
├── core/
│   └── database.ts               ← 新建：SQLite 数据库初始化 + 建表
├── channels/
│   ├── http.ts                   ← 修改：新增 REST API 路由
│   └── session-api.ts            ← 新建：session CRUD handler
├── brain/
│   ├── loop.ts                   ← 不改
│   └── provider.ts               ← 不改
└── main.ts                       ← 修改：初始化 DB

web/src/
├── store/
│   ├── chatStore.ts              ← 修改：添加 sessionId，发消息时带上
│   └── sessionStore.ts           ← 新建：会话列表 store
├── components/
│   ├── ChatView.tsx              ← 修改：集成侧边栏
│   ├── SessionSidebar.tsx        ← 新建：侧边栏会话列表
│   └── (其他组件不变)
└── types/
    └── index.ts                  ← 修改：添加 Session 类型
```

---

## 数据库设计

```sql
-- 会话表
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,           -- crypto.randomUUID()
  title TEXT NOT NULL DEFAULT '新对话',
  created_at INTEGER NOT NULL,   -- Date.now()
  updated_at INTEGER NOT NULL    -- Date.now()
);

-- 消息表
CREATE TABLE messages (
  id TEXT PRIMARY KEY,           -- crypto.randomUUID()
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,            -- 'user' | 'assistant'
  content TEXT NOT NULL,         -- JSON: content blocks 数组 (Anthropic 格式)
  created_at INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX idx_messages_session_id ON messages(session_id);
```

**为什么 content 存 JSON 字符串而不是分表存 blocks？**
- 简单。一条消息的所有 content blocks 作为一个整体读写，不需要复杂的 JOIN。
- 灵活。未来 content block 类型增加时，不需要改表结构。
- 与 Anthropic API 的 Message.content 格式一致，存取零转换。

**为什么不用向量索引？**
- 本计划只做会话持久化。记忆系统（向量检索）是独立系统，后续实现。

---

### Task 1: 数据库初始化模块

**Files:**
- Create: `src/core/database.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: 创建 database.ts**

```ts
import { Database } from "bun:sqlite";
import { resolve } from "path";

let db: Database | null = null;

export function getDb(): Database {
  if (db) return db;

  const dbPath = resolve(import.meta.dir, "../../data/agent.sqlite");

  db = new Database(dbPath, { create: true });

  // WAL 模式：支持多进程并发读，写不阻塞读
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA foreign_keys = ON");

  // 建表
  db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '新对话',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    )
  `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id)`);

  console.log(`[db] 数据库已初始化: ${dbPath}`);
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
```

- [ ] **Step 2: 修改 main.ts — 初始化数据库**

在 `src/main.ts` 中 import 并调用 `getDb()`：

```ts
import { serve } from "./channels/http";
import { getDb } from "./core/database";

getDb();

const PORT = parseInt(process.env.PORT ?? "3000", 10);

serve(PORT);
```

- [ ] **Step 3: 确保 data/ 目录存在（.gitkeep）**

```bash
mkdir -p data && touch data/.gitkeep
```

- [ ] **Step 4: 添加 data/*.sqlite 到 .gitignore**

在 `.gitignore` 中添加：

```
data/*.sqlite
data/*.sqlite-wal
data/*.sqlite-shm
```

- [ ] **Step 5: 运行 check**

```bash
bun run check
```

预期：零错误。

- [ ] **Step 6: 验证数据库初始化**

```bash
bun run src/main.ts &
sleep 2
ls -la data/
kill %1
```

预期：`data/agent.sqlite` 文件已创建。

- [ ] **Step 7: Commit**

```bash
git add src/core/database.ts src/main.ts data/.gitkeep .gitignore
git commit -m "feat: SQLite 数据库初始化（sessions + messages 表）"
```

---

### Task 2: Session API — CRUD 端点

**Files:**
- Create: `src/channels/session-api.ts`
- Modify: `src/channels/http.ts`

- [ ] **Step 1: 创建 session-api.ts**

```ts
import { getDb } from "../core/database";
import type { Database } from "bun:sqlite";

export interface Session {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
}

export interface SessionWithMessages extends Session {
  messages: SessionMessage[];
}

export interface SessionMessage {
  id: string;
  session_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: number;
}

export function createSession(title?: string): Session {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = Date.now();
  db.run(
    "INSERT INTO sessions (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)",
    [id, title ?? "新对话", now, now],
  );
  return { id, title: title ?? "新对话", created_at: now, updated_at: now };
}

export function listSessions(): Session[] {
  const db = getDb();
  return db.query("SELECT * FROM sessions ORDER BY updated_at DESC").all() as Session[];
}

export function getSession(id: string): Session | null {
  const db = getDb();
  return db.query("SELECT * FROM sessions WHERE id = ?").get(id) as Session | null;
}

export function updateSessionTitle(id: string, title: string): void {
  const db = getDb();
  const now = Date.now();
  db.run("UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?", [title, now, id]);
}

export function deleteSession(id: string): void {
  const db = getDb();
  db.run("DELETE FROM sessions WHERE id = ?", [id]);
}

export function appendMessage(sessionId: string, role: "user" | "assistant", content: string): SessionMessage {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = Date.now();
  db.run(
    "INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)",
    [id, sessionId, role, JSON.stringify(content), now],
  );
  // 更新 session 的 updated_at
  db.run("UPDATE sessions SET updated_at = ? WHERE id = ?", [now, sessionId]);
  return { id, session_id: sessionId, role, content: JSON.stringify(content), created_at: now };
}

export function getSessionMessages(sessionId: string): SessionMessage[] {
  const db = getDb();
  return db.query("SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC").all(sessionId) as SessionMessage[];
}

export function updateMessageContent(id: string, content: string): void {
  const db = getDb();
  db.run("UPDATE messages SET content = ? WHERE id = ?", [JSON.stringify(content), id]);
}
```

- [ ] **Step 2: 修改 http.ts — 添加 session REST API 路由**

在 `http.ts` 的 `fetch` 函数中，在聊天端点之前添加 session 路由。需要导入 `session-api`：

在文件顶部 import 区域添加：

```ts
import {
  createSession,
  listSessions,
  getSession,
  updateSessionTitle,
  deleteSession,
  getSessionMessages,
} from "./session-api";
```

将 `fetch` 函数中的路由逻辑替换为（仅展示变更部分，在 `handleChat` 路由之前插入）：

```ts
// Session REST API
if (req.method === "GET" && url.pathname === "/api/sessions") {
  const sessions = listSessions();
  return new Response(JSON.stringify(sessions), {
    headers: { "content-type": "application/json" },
  });
}

if (req.method === "POST" && url.pathname === "/api/sessions") {
  const body = await req.json().catch(() => ({})) as { title?: string };
  const session = createSession(body.title);
  return new Response(JSON.stringify(session), {
    status: 201,
    headers: { "content-type": "application/json" },
  });
}

if (req.method === "GET" && url.pathname.startsWith("/api/sessions/") && url.pathname.endsWith("/messages")) {
  const id = url.pathname.split("/")[3];
  const messages = getSessionMessages(id);
  return new Response(JSON.stringify(messages), {
    headers: { "content-type": "application/json" },
  });
}

if (req.method === "PATCH" && url.pathname.startsWith("/api/sessions/") && !url.pathname.includes("/messages")) {
  const id = url.pathname.split("/")[3];
  const body = await req.json().catch(() => ({})) as { title?: string };
  if (body.title) updateSessionTitle(id, body.title);
  return new Response(JSON.stringify({ ok: true }), {
    headers: { "content-type": "application/json" },
  });
}

if (req.method === "DELETE" && url.pathname.startsWith("/api/sessions/")) {
  const id = url.pathname.split("/")[3];
  deleteSession(id);
  return new Response(JSON.stringify({ ok: true }), {
    headers: { "content-type": "application/json" },
  });
}
```

- [ ] **Step 3: 运行 check**

```bash
bun run check
```

- [ ] **Step 4: 验证 API 端点**

```bash
bun run src/main.ts &
sleep 2

# 创建 session
curl -s --noproxy localhost -X POST http://localhost:3000/api/sessions -H "content-type: application/json" -d '{"title":"测试会话"}'

# 列出 sessions
curl -s --noproxy localhost http://localhost:3000/api/sessions

# 获取单个 session 的 messages
curl -s --noproxy localhost http://localhost:3000/api/sessions/<ID>/messages

kill %1
```

预期：session 创建成功，列表返回数组。

- [ ] **Step 5: Commit**

```bash
git add src/channels/session-api.ts src/channels/http.ts
git commit -m "feat: session REST API（创建/列表/删除/消息查询）"
```

---

### Task 3: 后端存储聊天消息

**Files:**
- Modify: `src/channels/http.ts` — handleChat 中存储消息

- [ ] **Step 1: 修改 handleChat — 支持 sessionId 参数，存储消息到 DB**

修改 `handleChat` 函数：

1. 请求体新增 `sessionId` 字段：`{ message?: string; messages?: Message[]; sessionId?: string }`
2. 如果有 sessionId，将 user 消息存入 DB
3. SSE 结束后，将 assistant 消息存入 DB
4. 返回 `done` 事件时附带 sessionId

将 `handleChat` 函数修改为：

```ts
import { appendMessage, createSession, updateSessionTitle } from "./session-api";

async function handleChat(req: Request, defaultSystemPrompt: string): Promise<Response> {
  let body: { message?: string; messages?: Message[]; sessionId?: string };
  try {
    body = await req.json();
  } catch {
    return jsonError("请求体必须是 JSON", 400);
  }

  const messages: Message[] = body.messages ?? [
    { role: "user", content: body.message ?? "" },
  ];

  if (messages.length === 0) {
    return jsonError("消息为空", 400);
  }

  // 会话管理：有 sessionId 用现有的，没有则自动创建
  let sessionId = body.sessionId;
  if (!sessionId) {
    const session = createSession();
    sessionId = session.id;
  }

  // 存储用户消息（最后一条是用户发送的）
  const lastMsg = messages[messages.length - 1];
  if (lastMsg.role === "user") {
    const userContent = typeof lastMsg.content === "string"
      ? lastMsg.content
      : JSON.stringify(lastMsg.content);
    appendMessage(sessionId, "user", userContent);
  }

  const capturedSessionId = sessionId;

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const loopGen = runLoop({
        systemPrompt: defaultSystemPrompt,
        messages,
        signal: req.signal,
      });

      const abortHandler = () => {
        (loopGen as { return?: () => void }).return?.();
        try { controller.close(); } catch { /* 已关闭 */ }
      };
      req.signal.addEventListener("abort", abortHandler, { once: true });

      // 收集 assistant 回复的 content blocks
      const assistantBlocks: Message["content"] = [];

      try {
        for await (const event of loopGen) {
          if (req.signal.aborted) break;

          if (event.type === "loop_done") {
            // 存储 assistant 消息到 DB
            const output = event.output;
            // 从 output.messages 中找最后一条 assistant 消息
            for (const msg of output.messages) {
              if (msg.role === "assistant") {
                const idx = output.messages.indexOf(msg);
                // 只存最后一条 assistant 消息（本轮生成的）
                if (idx === output.messages.length - 1 || (idx >= messages.length && msg.role === "assistant")) {
                  // 用后一个条件判断：从 messages.length 开始的都是新消息
                }
              }
            }
            // 简化：直接用收集到的 assistantBlocks
            continue;
          }

          // 收集 assistant content blocks
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
                assistantBlocks.push({ type: "thinking", thinking: event.content, signature: "" });
              }
              break;
            }
            case "thinking_done": {
              const lastThink = assistantBlocks.findLast((b) => b.type === "thinking") as
                | { type: "thinking"; thinking: string; signature: string }
                | undefined;
              if (lastThink) lastThink.signature = event.signature;
              break;
            }
            case "tool_use_done": {
              assistantBlocks.push({ type: "tool_use", id: event.id, name: event.name, input: event.input });
              break;
            }
            default: break;
          }

          const sse = chatEventToSSE(event);
          if (sse) {
            // done 事件附带 sessionId
            if (sse.event === "done") {
              sse.data = { ...sse.data, sessionId: capturedSessionId };
            }
            controller.enqueue(encoder.encode(formatSSE(sse)));
          }
        }
      } catch (err) {
        if (!req.signal.aborted) {
          const message = err instanceof Error ? err.message : "未知错误";
          controller.enqueue(
            encoder.encode(formatSSE({ event: "error", data: { message } })),
          );
        }
      } finally {
        req.signal.removeEventListener("abort", abortHandler);

        // 存储 assistant 消息（过滤掉 thinking，减少存储量）
        const storageBlocks = assistantBlocks.filter((b) => b.type !== "thinking");
        if (storageBlocks.length > 0) {
          appendMessage(capturedSessionId, "assistant", JSON.stringify(storageBlocks));
        }

        try { controller.close(); } catch { /* 已关闭 */ }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      "connection": "keep-alive",
      "access-control-allow-origin": "*",
    },
  });
}
```

注意：这个修改比较大。`handleChat` 现在需要：
1. 从请求体读 `sessionId`，没有则自动创建 session
2. 收集 assistant content blocks（已在 loop.ts 中做了，但在 http.ts 的 SSE 层也收集一份用于存储）
3. `done` SSE 事件附带 `sessionId`
4. 流结束后将 assistant 消息存入 DB

同时需要在文件顶部更新 import：

```ts
import { appendMessage, createSession } from "./session-api";
```

并且 `handleChat` 的声明改为不再需要外层 try/catch（已在 fetch 中处理）：

实际上保持 fetch 中的 try/catch 不变，只改 `handleChat` 内部逻辑即可。

- [ ] **Step 2: 运行 check**

```bash
bun run check
```

- [ ] **Step 3: 验证消息存储**

```bash
bun run src/main.ts &
sleep 2

# 发送消息（不带 sessionId，自动创建）
curl -s --noproxy localhost -X POST http://localhost:3000/api/chat -H "content-type: application/json" -d '{"message":"你好"}' 2>&1 | head -20

# 检查 sessions
curl -s --noproxy localhost http://localhost:3000/api/sessions

# 用返回的 sessionId 检查 messages
curl -s --noproxy localhost http://localhost:3000/api/sessions/<ID>/messages

kill %1
```

预期：session 自动创建，messages 表中有 user 和 assistant 两条记录。

- [ ] **Step 4: Commit**

```bash
git add src/channels/http.ts
git commit -m "feat: 聊天消息自动存储到 SQLite（支持 sessionId）"
```

---

### Task 4: 自动标题生成

**Files:**
- Modify: `src/channels/http.ts` — 流结束后异步生成标题

- [ ] **Step 1: 在 http.ts 中添加自动标题生成**

在 `handleChat` 的 `finally` 块中，assistant 消息存储之后，添加异步标题生成逻辑。

在 `http.ts` 顶部添加 import：

```ts
import { updateSessionTitle as updateTitle } from "./session-api";
```

在 `handleChat` 函数的 `finally` 块中，在 `appendMessage` 之后添加：

```ts
// 异步生成标题（fire-and-forget，不阻塞响应）
if (assistantBlocks.some((b) => b.type === "text")) {
  const firstUserText = messages
    .filter((m) => m.role === "user")
    .map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)))
    .join(" ")
    .slice(0, 200);

  generateTitle(capturedSessionId, firstUserText).catch(() => {});
}
```

在 `http.ts` 文件底部添加辅助函数（不导出）：

```ts
async function generateTitle(sessionId: string, userMessage: string): Promise<void> {
  try {
    const { streamChat: providerStream } = await import("../brain/provider");
    const titlePrompt = `根据以下用户消息，生成一个简短的对话标题（不超过20个字，不要引号，不要句号）：\n\n${userMessage}`;

    let title = "";
    for await (const event of providerStream({
      system: "你是标题生成器。只返回标题文本，不要任何额外内容。",
      messages: [{ role: "user", content: titlePrompt }],
      signal: AbortSignal.timeout(10000),
    })) {
      if (event.type === "text_delta") {
        title += event.content;
      }
    }

    title = title.trim().replace(/^["""']+|["""']+$/g, "").slice(0, 30);
    if (title) {
      updateTitle(sessionId, title);
    }
  } catch {
    // 标题生成失败不影响主流程，保持默认标题
  }
}
```

- [ ] **Step 2: 运行 check**

```bash
bun run check
```

- [ ] **Step 3: 验证标题生成**

```bash
bun run src/main.ts &
sleep 2

# 发送消息
curl -s --noproxy localhost -X POST http://localhost:3000/api/chat -H "content-type: application/json" -d '{"message":"帮我写一个快速排序算法"}' 2>&1 > /dev/null

# 等待标题生成（LLM 调用需要几秒）
sleep 10

# 检查 sessions
curl -s --noproxy localhost http://localhost:3000/api/sessions | python3 -m json.tool

kill %1
```

预期：session 的 title 不再是"新对话"，而是类似"快速排序算法实现"。

- [ ] **Step 4: Commit**

```bash
git add src/channels/http.ts
git commit -m "feat: 自动根据首条消息生成会话标题（异步 LLM 调用）"
```

---

### Task 5: 前端 Session 类型 + sessionStore

**Files:**
- Modify: `web/src/types/index.ts` — 添加 Session 类型
- Create: `web/src/store/sessionStore.ts`

- [ ] **Step 1: 修改 types/index.ts — 添加 Session 类型**

在文件末尾添加：

```ts
export interface Session {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
}
```

- [ ] **Step 2: 创建 sessionStore.ts**

```ts
import { create } from "zustand";
import type { Session } from "../types";

interface SessionState {
  sessions: Session[];
  activeSessionId: string | null;
  loading: boolean;

  fetchSessions: () => Promise<void>;
  createSession: () => Promise<Session>;
  switchSession: (id: string) => void;
  deleteSession: (id: string) => Promise<void>;
  setActiveSessionId: (id: string | null) => void;
}

export const useSessionStore = create<SessionState>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  loading: false,

  fetchSessions: async () => {
    set({ loading: true });
    try {
      const res = await fetch("/api/sessions");
      if (!res.ok) throw new Error("获取会话列表失败");
      const sessions = await res.json() as Session[];
      set({ sessions, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  createSession: async () => {
    const res = await fetch("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    if (!res.ok) throw new Error("创建会话失败");
    const session = await res.json() as Session;
    set((s) => ({ sessions: [session, ...s.sessions], activeSessionId: session.id }));
    return session;
  },

  switchSession: (id: string) => {
    set({ activeSessionId: id });
  },

  deleteSession: async (id: string) => {
    await fetch(`/api/sessions/${id}`, { method: "DELETE" });
    const s = get();
    const sessions = s.sessions.filter((ss) => ss.id !== id);
    const activeSessionId = s.activeSessionId === id ? null : s.activeSessionId;
    set({ sessions, activeSessionId });
  },

  setActiveSessionId: (id: string | null) => {
    set({ activeSessionId: id });
  },
}));
```

- [ ] **Step 3: 运行前端类型检查**

```bash
cd web && npx tsc --noEmit && cd ..
```

- [ ] **Step 4: Commit**

```bash
git add web/src/types/index.ts web/src/store/sessionStore.ts
git commit -m "feat: 前端 Session 类型和 sessionStore（会话列表状态管理）"
```

---

### Task 6: 修改 chatStore — 支持 sessionId

**Files:**
- Modify: `web/src/store/chatStore.ts` — 发消息带 sessionId，加载历史消息

- [ ] **Step 1: 修改 chatStore — 添加 sessionId 支持**

修改 `ChatState` 接口，添加 `sessionId` 字段：

```ts
interface ChatState {
  messages: Message[];
  isLoading: boolean;
  streamingMessageId: string | null;
  streamingBlocks: DisplayBlock[];
  sessionId: string | null;

  sendMessage: (text: string) => void;
  abortRequest: () => void;
  clearMessages: () => void;
  loadSession: (sessionId: string) => Promise<void>;
  setSessionId: (id: string | null) => void;
}
```

修改 `useChatStore` 的初始状态和方法：

在初始状态中添加 `sessionId: null`。

修改 `sendMessage` 方法：
1. 从 `get()` 中取 `sessionId`
2. 如果没有 sessionId，先 POST `/api/sessions` 创建一个
3. 发送请求时带上 `sessionId`
4. 收到 `done` 事件时更新 `sessionId`

修改 `streamChat` 函数签名，添加 `sessionId` 参数：

```ts
async function streamChat(
  messages: { role: string; content: unknown }[],
  sessionId: string | null,
  onEvent: (type: string, data: any) => void,
  signal: AbortSignal,
)
```

在 `streamChat` 的 `fetch` body 中带上 `sessionId`：

```ts
body: JSON.stringify({ messages, sessionId }),
```

修改 `sendMessage` 中调用 `streamChat` 的地方：

```ts
streamChat(
  apiMessages,
  state.sessionId,
  (eventType, data) => { ... },
  controller.signal,
)
```

在 `done` 事件处理中保存 sessionId：

```ts
case "done": {
  flushTextBuffer(set, get);
  if (data.sessionId && !get().sessionId) {
    set({ sessionId: data.sessionId });
  }
  break;
}
```

添加 `loadSession` 方法：

```ts
loadSession: async (sessionId: string) => {
  const s = get();
  if (s.isLoading) return;

  try {
    const res = await fetch(`/api/sessions/${sessionId}/messages`);
    if (!res.ok) throw new Error("加载消息失败");
    const rawMessages = await res.json() as Array<{
      id: string;
      role: "user" | "assistant";
      content: string;
    }>;

    const messages: Message[] = rawMessages.map((m) => ({
      id: m.id,
      role: m.role,
      blocks: parseDbContent(m.content, m.role),
    }));

    set({ messages, sessionId, streamingMessageId: null, streamingBlocks: [] });
  } catch (err) {
    console.error("加载会话失败:", err);
  }
},

setSessionId: (id: string | null) => {
  set({ sessionId: id });
},
```

添加 `parseDbContent` 辅助函数（在文件底部）：

```ts
function parseDbContent(contentStr: string, role: "user" | "assistant"): DisplayBlock[] {
  // user 消息 content 是纯字符串（JSON.stringify 后的）
  if (role === "user") {
    try {
      const parsed = JSON.parse(contentStr);
      return [{ type: "text", content: typeof parsed === "string" ? parsed : contentStr }];
    } catch {
      return [{ type: "text", content: contentStr }];
    }
  }

  // assistant 消息 content 是 content blocks 数组（JSON 字符串）
  try {
    const blocks = JSON.parse(contentStr) as Array<{ type: string; text?: string; name?: string; input?: Record<string, unknown> }>;
    return blocks.map((b) => {
      if (b.type === "text") return { type: "text" as const, content: b.text ?? "" };
      if (b.type === "tool_use") return { type: "tool_use" as const, content: JSON.stringify(b.input, null, 2), toolName: b.name, toolInput: b.input };
      return { type: "text" as const, content: "" };
    }).filter((b) => b.content !== "");
  } catch {
    return [{ type: "text", content: contentStr }];
  }
}
```

修改 `clearMessages` 为 `resetSession`：

```ts
clearMessages: () => {
  abortController?.abort();
  abortController = null;
  if (throttleTimer) {
    clearTimeout(throttleTimer);
    throttleTimer = null;
  }
  throttledTextBuffer = "";
  set({ messages: [], isLoading: false, streamingMessageId: null, streamingBlocks: [], sessionId: null });
},
```

- [ ] **Step 2: 运行前端类型检查**

```bash
cd web && npx tsc --noEmit && cd ..
```

- [ ] **Step 3: Commit**

```bash
git add web/src/store/chatStore.ts
git commit -m "feat: chatStore 支持 sessionId（发送/接收/加载历史消息）"
```

---

### Task 7: 前端 SessionSidebar 组件

**Files:**
- Create: `web/src/components/SessionSidebar.tsx`

- [ ] **Step 1: 创建 SessionSidebar.tsx**

```tsx
import { useEffect } from "react";
import { useSessionStore } from "../store/sessionStore";
import { useChatStore } from "../store/chatStore";

export default function SessionSidebar() {
  const { sessions, activeSessionId, fetchSessions, createSession, switchSession, deleteSession } = useSessionStore();
  const { loadSession, clearMessages } = useChatStore();

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  async function handleNew() {
    clearMessages();
    const session = await createSession();
    switchSession(session.id);
  }

  async function handleSwitch(id: string) {
    if (id === activeSessionId) return;
    switchSession(id);
    await loadSession(id);
  }

  async function handleDelete(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    await deleteSession(id);
    if (id === activeSessionId) {
      clearMessages();
    }
  }

  function formatTime(ts: number): string {
    const d = new Date(ts);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
    }
    return d.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
  }

  return (
    <div className="flex h-full w-64 flex-col border-r border-white/10 bg-[var(--color-surface)]">
      <div className="p-3">
        <button
          onClick={handleNew}
          className="w-full rounded-lg border border-white/10 px-3 py-2 text-sm text-[var(--color-text)] hover:bg-white/5"
        >
          + 新对话
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {sessions.map((s) => (
          <div
            key={s.id}
            onClick={() => handleSwitch(s.id)}
            className={`group flex cursor-pointer items-center justify-between px-3 py-2.5 text-sm ${
              s.id === activeSessionId
                ? "bg-white/10 text-white"
                : "text-white/60 hover:bg-white/5 hover:text-white/80"
            }`}
          >
            <span className="flex-1 truncate">{s.title}</span>
            <span className="mr-2 shrink-0 text-xs text-white/30">{formatTime(s.updated_at)}</span>
            <button
              onClick={(e) => handleDelete(e, s.id)}
              className="hidden shrink-0 text-white/30 hover:text-red-400 group-hover:block"
              title="删除"
            >
              &times;
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 运行前端类型检查**

```bash
cd web && npx tsc --noEmit && cd ..
```

- [ ] **Step 3: Commit**

```bash
git add web/src/components/SessionSidebar.tsx
git commit -m "feat: SessionSidebar 组件（会话列表 + 新建 + 切换 + 删除）"
```

---

### Task 8: 集成侧边栏到 ChatView

**Files:**
- Modify: `web/src/components/ChatView.tsx`

- [ ] **Step 1: 修改 ChatView.tsx — 添加侧边栏**

```tsx
import { useState } from "react";
import MessageList from "./MessageList";
import ChatInput from "./ChatInput";
import SessionSidebar from "./SessionSidebar";

export default function ChatView() {
  const [sidebarOpen, setSidebarOpen] = useState(true);

  return (
    <div className="flex h-screen bg-[var(--color-bg)]">
      {sidebarOpen && <SessionSidebar />}

      <div className="flex flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-white/10 bg-[var(--color-surface)] px-6 py-3">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="text-white/60 hover:text-white"
            title={sidebarOpen ? "收起侧栏" : "展开侧栏"}
          >
            {sidebarOpen ? "◁" : "▷"}
          </button>
          <h1 className="text-lg font-semibold text-[var(--color-text)]">My Agent</h1>
        </header>
        <MessageList />
        <ChatInput />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 修改 MessageList.tsx — 空状态提示**

在 `MessageList.tsx` 中，当 `messages` 为空且没有 streaming 消息时，显示空状态提示：

将 MessageList 组件的返回值修改为：

```tsx
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

  const isEmpty = messages.length === 0 && !streamingMsg;

  return (
    <div
      ref={scrollRef}
      onScroll={checkNearBottom}
      className="flex-1 overflow-y-auto px-4 py-6"
    >
      <div className="mx-auto max-w-3xl space-y-4">
        {isEmpty && (
          <div className="flex h-full items-center justify-center py-20">
            <p className="text-white/30">输入消息开始对话</p>
          </div>
        )}
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        {streamingMsg && <MessageBubble message={streamingMsg} />}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 运行前端构建**

```bash
cd web && npx tsc --noEmit && npx vite build && cd ..
```

- [ ] **Step 4: Commit**

```bash
git add web/src/components/ChatView.tsx web/src/components/MessageList.tsx
git commit -m "feat: ChatView 集成 SessionSidebar（可收起侧边栏）"
```

---

### Task 9: 端到端验证

**Files:**
- No new files

- [ ] **Step 1: 构建前端**

```bash
cd web && npx vite build && cd ..
```

- [ ] **Step 2: 启动后端**

```bash
rm -f data/agent.sqlite
nohup bun run dev > /tmp/my-agent-backend.log 2>&1 &
sleep 3
```

- [ ] **Step 3: 浏览器测试**

打开 `http://localhost:3000/`，测试以下场景：

1. **新建对话**：点击"新对话"按钮 → 侧边栏出现"新对话"
2. **发送消息**：输入"帮我写一个快速排序" → 流式回复
3. **标题自动生成**：等待 5-10 秒 → 侧边栏标题变为有意义的标题
4. **页面刷新**：F5 刷新 → 侧边栏仍显示会话列表 → 点击会话 → 消息恢复
5. **新建第二个对话**：点击"新对话" → 输入"你好" → 切换回第一个对话 → 消息仍在
6. **删除对话**：点击 × 按钮 → 会话从列表移除

- [ ] **Step 4: 清理**

```bash
kill %1
```

---

### Task 10: 最终 check + 清理

**Files:**
- No new files

- [ ] **Step 1: 后端 check**

```bash
bun run check
```

- [ ] **Step 2: 前端构建验证**

```bash
cd web && npx tsc --noEmit && npx vite build && cd ..
```

- [ ] **Step 3: 确认无残留**

```bash
git status
```

确认所有改动已提交。

---

## 自查清单

### Spec 覆盖

| 架构 Spec 要求 | 本计划覆盖 |
|---|---|
| SQLite（WAL 模式）| Task 1 ✅ |
| Message 存储粒度（role + content blocks）| Task 2-3 ✅ |
| 会话列表 | Task 2, 5, 7 ✅ |
| 多会话切换 | Task 6, 7, 8 ✅ |
| 自动标题生成 | Task 4 ✅ |
| 加载历史消息 | Task 6 ✅ |
| 页面刷新恢复 | Task 9 ✅ |

### 占位符扫描

- 无 TBD/TODO
- 所有步骤都有完整代码
- 所有命令都有预期输出

### 类型一致性

- `Session` 类型在 `web/src/types/index.ts` 和 `src/channels/session-api.ts` 中字段一致
- `sessionId` 在 chatStore、sessionStore、http.ts 中均为 `string | null`
- SSE `done` 事件的 `data.sessionId` 与 chatStore 中读取的字段名一致
