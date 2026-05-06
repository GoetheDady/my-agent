# 记忆提取状态展示 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在助手回复气泡下方显示记忆提取状态（loading / 成功 / 失败），前端通过独立 API 查询。

**Architecture:** 后端新增 `POST /api/memory/extract` 同步 API，`extractMemories` 返回提取条数。移除 http.ts 中的 fire-and-forget 调用。前端在 SSE 流结束后调用该 API，在消息气泡下方展示状态。前端设 25s 超时（后端 20s + 5s 余量）。

**Tech Stack:** TypeScript, React, Zustand, Tailwind CSS

---

## 文件结构

```
src/
├── memory/
│   └── extract.ts               ← 修改：返回值 void → number
├── channels/
│   └── http.ts                  ← 修改：新增 extract 路由，移除 fire-and-forget

web/src/
├── types/
│   └── index.ts                 ← 修改：DisplayBlock 新增 memoryStatus/memoryCount
├── store/
│   └── chatStore.ts             ← 修改：SSE 结束后调 extract API + 更新状态
└── components/
    └── MessageBubble.tsx        ← 修改：新增 MemoryStatusBar 组件
```

---

### Task 1: 后端 — extractMemories 返回提取条数

**Files:**
- Modify: `src/memory/extract.ts`

- [ ] **Step 1: 修改 extractMemories 返回值**

将 `src/memory/extract.ts` 第 3-7 行的函数签名和所有 `return` 语句改为返回 `number`：

```ts
export async function extractMemories(
  userMessages: string[],
  assistantMessages: string[],
  sessionId: string,
): Promise<number> {
```

将第 13 行 `if (!conversationText) return;` 改为：

```ts
  if (!conversationText) return 0;
```

将第 73 行 `if (!jsonMatch) return;` 改为：

```ts
    if (!jsonMatch) return 0;
```

将第 87 行 `return;`（JSON 解析失败）改为：

```ts
      return 0;
```

将第 143-145 行的日志输出和函数末尾改为：

```ts
    if (count > 0) {
      console.log(`[memory] 提取了 ${count} 条记忆`);
    }
    return count;
  } catch (err) {
    console.error("[memory] 提取失败:", err);
    return 0;
  }
}
```

- [ ] **Step 2: 运行 check**

```bash
bun run check
```

- [ ] **Step 3: Commit**

```bash
git add src/memory/extract.ts
git commit -m "feat: extractMemories 返回提取条数"
```

---

### Task 2: 后端 — 新增 extract API + 移除 fire-and-forget

**Files:**
- Modify: `src/channels/http.ts`

- [ ] **Step 1: 在 http.ts 新增 `POST /api/memory/extract` 路由**

在 `src/channels/http.ts` 的聊天端点（`POST /api/chat`）之前，插入新路由：

```ts
      // 记忆提取端点
      if (req.method === "POST" && url.pathname === "/api/memory/extract") {
        try {
          const body = await req.json().catch(() => ({})) as {
            sessionId?: string;
            userText?: string;
            assistantText?: string;
          };
          if (!body.sessionId || !body.userText) {
            return jsonError("缺少 sessionId 或 userText", 400);
          }
          const count = await extractMemories(
            [body.userText],
            [body.assistantText ?? ""],
            body.sessionId,
          );
          return new Response(JSON.stringify({ count }), {
            headers: { "content-type": "application/json" },
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : "记忆提取失败";
          return new Response(JSON.stringify({ error: message }), {
            status: 500,
            headers: { "content-type": "application/json" },
          });
        }
      }
```

- [ ] **Step 2: 移除 fire-and-forget 调用**

删除 `src/channels/http.ts` 第 323-327 行（`finally` 块内的 extractMemories 调用）：

```ts
          const assistantMsg = assistantBlocks
            .filter((b) => b.type === "text")
            .map((b) => b.text ?? "")
            .join(" ");
          extractMemories([userText], [assistantMsg], capturedSessionId).catch(() => {});
```

整段删除。

- [ ] **Step 3: 运行 check**

```bash
bun run check
```

- [ ] **Step 4: Commit**

```bash
git add src/channels/http.ts
git commit -m "feat: POST /api/memory/extract 独立端点 + 移除 fire-and-forget"
```

---

### Task 3: 前端 — DisplayBlock 新增 memoryStatus 字段

**Files:**
- Modify: `web/src/types/index.ts`

- [ ] **Step 1: 修改 DisplayBlock 接口**

在 `web/src/types/index.ts` 第 1-8 行的 `DisplayBlock` 接口末尾，添加 `memoryStatus` 和 `memoryCount`：

```ts
export interface DisplayBlock {
  type: "text" | "thinking" | "tool_use";
  content: string;
  toolName?: string;
  toolUseId?: string;
  toolInput?: Record<string, unknown>;
  collapsed?: boolean;
  memoryStatus?: "loading" | "success" | "error";
  memoryCount?: number;
}
```

- [ ] **Step 2: 运行前端 check**

```bash
cd web && npx tsc --noEmit && cd ..
```

- [ ] **Step 3: Commit**

```bash
git add web/src/types/index.ts
git commit -m "feat: DisplayBlock 新增 memoryStatus/memoryCount 字段"
```

---

### Task 4: 前端 — chatStore SSE 结束后调用 extract API

**Files:**
- Modify: `web/src/store/chatStore.ts`

- [ ] **Step 1: 添加记忆提取状态和 abort 管理**

在文件顶部（`let abortController` 下方，约第 5-8 行之间）新增：

```ts
let memoryAbortController: AbortController | null = null;
```

在 `ChatState` 接口（第 10-24 行）新增一个字段：

```ts
  memoryExtractId: string | null;
```

在 store 初始值（约第 89 行）新增：

```ts
  memoryExtractId: null,
```

- [ ] **Step 2: 实现 triggerMemoryExtract 函数**

在 `flushTextBuffer` 函数之前（约第 26 行），新增：

```ts
function triggerMemoryExtract(
  set: (partial: Partial<ChatState>) => void,
  get: () => ChatState,
  assistantMessageId: string,
  userText: string,
  assistantText: string,
  sessionId: string | null,
) {
  if (memoryAbortController) {
    memoryAbortController.abort();
  }
  memoryAbortController = new AbortController();
  const signal = memoryAbortController.signal;

  const s = get();
  const msgIdx = s.messages.findIndex((m) => m.id === assistantMessageId);
  if (msgIdx === -1) return;

  const msg = s.messages[msgIdx];
  const lastTextIdx = msg.blocks.findLastIndex((b) => b.type === "text");
  if (lastTextIdx === -1) return;

  const updatedBlocks = [...msg.blocks];
  updatedBlocks[lastTextIdx] = { ...updatedBlocks[lastTextIdx], memoryStatus: "loading" as const, memoryCount: undefined };
  const updatedMessages = [...s.messages];
  updatedMessages[msgIdx] = { ...msg, blocks: updatedBlocks };
  set({ messages: updatedMessages });

  const controller = memoryAbortController;

  fetch("/api/memory/extract", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId, userText, assistantText }),
    signal,
  })
    .then(async (res) => {
      if (controller !== memoryAbortController) return;
      if (signal.aborted) return;

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "提取失败" })) as { error?: string };
        throw new Error(err.error ?? "提取失败");
      }
      const data = await res.json() as { count: number };
      return data.count;
    })
    .then((count) => {
      if (controller !== memoryAbortController) return;
      if (signal.aborted) return;

      const s2 = get();
      const idx = s2.messages.findIndex((m) => m.id === assistantMessageId);
      if (idx === -1) return;

      const m = s2.messages[idx];
      const ti = m.blocks.findLastIndex((b) => b.type === "text");
      if (ti === -1) return;

      if (count === undefined) return;

      const blocks = [...m.blocks];
      if (count === 0) {
        blocks[ti] = { ...blocks[ti], memoryStatus: undefined, memoryCount: undefined };
      } else {
        blocks[ti] = { ...blocks[ti], memoryStatus: "success", memoryCount: count };
      }
      const msgs = [...s2.messages];
      msgs[idx] = { ...m, blocks };
      set({ messages: msgs });
    })
    .catch(() => {
      if (controller !== memoryAbortController) return;
      if (signal.aborted) return;

      const s2 = get();
      const idx = s2.messages.findIndex((m) => m.id === assistantMessageId);
      if (idx === -1) return;

      const m = s2.messages[idx];
      const ti = m.blocks.findLastIndex((b) => b.type === "text");
      if (ti === -1) return;

      const blocks = [...m.blocks];
      blocks[ti] = { ...blocks[ti], memoryStatus: "error", memoryCount: undefined };
      const msgs = [...s2.messages];
      msgs[idx] = { ...m, blocks };
      set({ messages: msgs });
    });
}
```

- [ ] **Step 3: 在 finalizeStream 之后触发记忆提取**

找到 `streamChat(...).then(() => { finalizeStream(...) })` 这段代码（约第 204-212 行），将 `.then` 回调改为：

```ts
    ).then(() => {
      finalizeStream(set, get, streamingId);

      const s = get();
      const assistantMsg = s.messages.find((m) => m.id === streamingId);
      if (assistantMsg && s.sessionId) {
        const userBlocks = s.messages
          .filter((m) => m.role === "user")
          .at(-1)?.blocks ?? [];
        const userText = userBlocks
          .filter((b) => b.type === "text")
          .map((b) => b.content)
          .join("\n");
        const assistantText = assistantMsg.blocks
          .filter((b) => b.type === "text")
          .map((b) => b.content)
          .join("\n");
        if (userText) {
          triggerMemoryExtract(set, get, streamingId, userText, assistantText, s.sessionId);
        }
      }
    }).catch(() => {
      const s = get();
      if (s.streamingMessageId === streamingId) {
        finalizeStream(set, get, streamingId);
      }
    });
```

- [ ] **Step 4: 在 abortRequest 和 clearMessages 中取消记忆提取**

在 `abortRequest` 函数开头（约第 216 行 `abortController?.abort()` 之后）新增：

```ts
    memoryAbortController?.abort();
    memoryAbortController = null;
```

在 `clearMessages` 函数开头（约第 247 行 `abortController?.abort()` 之后）新增：

```ts
    memoryAbortController?.abort();
    memoryAbortController = null;
```

- [ ] **Step 5: 运行前端 check**

```bash
cd web && npx tsc --noEmit && cd ..
```

- [ ] **Step 6: Commit**

```bash
git add web/src/store/chatStore.ts
git commit -m "feat: chatStore SSE 结束后调用 memory/extract API"
```

---

### Task 5: 前端 — MessageBubble 新增 MemoryStatusBar

**Files:**
- Modify: `web/src/components/MessageBubble.tsx`

- [ ] **Step 1: 在助手消息气泡下方渲染 MemoryStatusBar**

修改 `MessageBubble` 组件（第 21-30 行），将助手消息的渲染改为：

```tsx
  return (
    <div className="flex justify-start">
      <div className="max-w-[80%] space-y-2">
        {message.blocks.map((block, i) => (
          <BlockRenderer key={i} block={block} />
        ))}
        <MemoryStatusBar blocks={message.blocks} />
      </div>
    </div>
  );
```

- [ ] **Step 2: 新增 MemoryStatusBar 组件**

在文件末尾（`ThinkingBlock` 之后）新增：

```tsx
function MemoryStatusBar({ blocks }: { blocks: DisplayBlock[] }) {
  const lastTextBlock = blocks.findLast((b) => b.type === "text");
  if (!lastTextBlock?.memoryStatus) return null;

  if (lastTextBlock.memoryStatus === "loading") {
    return (
      <div className="flex items-center gap-1.5 px-2 py-1 text-xs text-white/30">
        <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        记忆提取中...
      </div>
    );
  }

  if (lastTextBlock.memoryStatus === "success") {
    return <FadeOutText text={`已提取 ${lastTextBlock.memoryCount ?? 0} 条记忆`} color="text-white/30" />;
  }

  if (lastTextBlock.memoryStatus === "error") {
    return <FadeOutText text="记忆提取失败" color="text-red-400/60" />;
  }

  return null;
}

function FadeOutText({ text, color }: { text: string; color: string }) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), 3000);
    return () => clearTimeout(timer);
  }, []);

  if (!visible) return null;

  return (
    <div className={`px-2 py-1 text-xs ${color} transition-opacity duration-500`}>
      {text}
    </div>
  );
}
```

- [ ] **Step 3: 运行前端 check**

```bash
cd web && npx tsc --noEmit && cd ..
```

- [ ] **Step 4: Commit**

```bash
git add web/src/components/MessageBubble.tsx
git commit -m "feat: MemoryStatusBar 组件（loading/成功/失败 + 自动淡出）"
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
bun run dev &
sleep 3
curl -s --noproxy localhost http://localhost:3000/api/health
```

预期：`{"status":"ok"}`

- [ ] **Step 3: 验证 extract API**

```bash
curl -s --noproxy localhost -X POST http://localhost:3000/api/memory/extract \
  -H "content-type: application/json" \
  -d '{"sessionId":"test","userText":"我叫张三，是一名后端开发","assistantText":"你好张三！"}'
```

预期：`{"count": N}`（N >= 0）

- [ ] **Step 4: 清理**

```bash
lsof -ti:3000 | xargs kill 2>/dev/null
bun run check
cd web && npx tsc --noEmit && npx vite build && cd ..
```

- [ ] **Step 5: Commit（如有未提交改动）**

---

## 自查清单

### Spec 覆盖

| Spec 要求 | 本计划覆盖 |
|---|---|
| `POST /api/memory/extract` 同步 API | Task 2 ✅ |
| `extractMemories` 返回 number | Task 1 ✅ |
| 移除 fire-and-forget | Task 2 ✅ |
| DisplayBlock 新增 memoryStatus/memoryCount | Task 3 ✅ |
| SSE 结束后调 extract API | Task 4 ✅ |
| 25s 前端超时（abort 控制） | Task 4（AbortController） ✅ |
| loading 状态展示 | Task 5 ✅ |
| 成功显示提取数量 | Task 5 ✅ |
| 失败红色提示 + 自动淡出 | Task 5 ✅ |
| count = 0 不显示任何状态 | Task 4（清除 memoryStatus） ✅ |
| 新消息发送时取消上轮提取 | Task 4（memoryAbortController） ✅ |

### 占位符扫描

- 无 TBD/TODO
- 所有步骤都有完整代码

### 类型一致性

- `extractMemories` 返回 `Promise<number>`，http.ts 路由消费 `count`
- `DisplayBlock.memoryStatus` 类型为 `"loading" | "success" | "error"`，chatStore 和 MessageBubble 使用一致
- `triggerMemoryExtract` 参数类型与 `DisplayBlock` 字段匹配
