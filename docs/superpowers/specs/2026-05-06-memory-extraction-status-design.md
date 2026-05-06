# 记忆提取状态展示设计 Spec

## 概述

在助手回复气泡下方，显示记忆提取的实时状态（loading / 成功 / 失败），让用户感知后台记忆系统的运行情况。

---

## 设计目标

1. 用户能看到"记忆提取中 → 提取完成"的完整过程
2. 不污染 SSE 聊天流，记忆提取走独立 API
3. 失败时显示错误提示并自动淡出
4. 前端单次请求，不轮询

---

## API 设计

### `POST /api/memory/extract`

请求体：

```json
{
  "sessionId": "xxx",
  "userText": "用户消息文本",
  "assistantText": "助手回复文本"
}
```

成功响应（200）：

```json
{ "count": 2 }
```

无可提取内容（200）：

```json
{ "count": 0 }
```

失败响应（500）：

```json
{ "error": "记忆提取失败" }
```

### 行为

- 同步执行 `extractMemories`，等待完成后返回
- `extractMemories` 内部已有 20s 超时保护
- 无 ZHIPU_API_KEY 时直接返回 `{ count: 0 }`，不报错

---

## 后端改动

### `src/channels/http.ts`

1. 新增 `POST /api/memory/extract` 路由
2. 移除 `finally` 块中的 fire-and-forget `extractMemories().catch(() => {})` 调用

### `src/memory/extract.ts`

修改 `extractMemories` 返回值：从 `Promise<void>` 改为 `Promise<number>`，返回提取的记忆条数。

---

## 前端改动

### `web/src/types/index.ts`

`DisplayBlock` 新增 `memoryStatus` 字段：

```ts
export interface DisplayBlock {
  type: "text" | "thinking" | "tool_use";
  content: string;
  // ... existing fields ...
  memoryStatus?: "loading" | "success" | "error";
  memoryCount?: number;
}
```

### `web/src/store/chatStore.ts`

在 `finalizeStream` 或 SSE 流结束后，触发记忆提取 API 调用：

1. SSE `done` 事件后，助手消息已完成
2. 调用 `POST /api/memory/extract`，前端设 25s 超时（后端 20s + 5s 余量）
3. 请求发出时，给助手消息最后一个 text block 设置 `memoryStatus: "loading"`
4. 成功：`memoryStatus: "success"`, `memoryCount: N`
5. 失败/超时：`memoryStatus: "error"`

### `web/src/components/MessageBubble.tsx`

助手消息气泡下方新增 `MemoryStatusBar` 组件：

- `loading`：显示 "记忆提取中..." + 旋转动画图标
- `success`：显示 "已提取 N 条记忆"（N > 0 时）或无提示（N = 0 时），3 秒后淡出
- `error`：显示红色 "记忆提取失败" 文字，3 秒后淡出

样式：小字（text-xs）、灰色/低对比度、不干扰主对话阅读。

### 状态生命周期

```
助手回复完成
  → memoryStatus: "loading"（显示 "记忆提取中..."）
  → API 返回
    → count > 0: memoryStatus: "success", memoryCount: N（显示 "已提取 N 条记忆"）
    → count = 0: 不显示任何状态
    → 失败/超时: memoryStatus: "error"（显示红色错误）
  → 3 秒后淡出
```

---

## 超时与降级

| 场景 | 行为 |
|------|------|
| API 25s 超时 | 显示 "记忆提取失败" 红色提示 |
| 无 ZHIPU_API_KEY | 后端直接返回 `{ count: 0 }`，前端不显示任何状态 |
| 网络断开 | fetch 异常，显示 "记忆提取失败" |
| 用户发送新消息时上轮提取还在进行 | 上轮的 fetch 被 AbortController 取消，显示淡出 |

---

## 不在范围内

- 记忆管理 UI（查看/编辑/删除记忆）
- 提取详情展示（具体提取了哪些内容）
- WebSocket 推送记忆状态
- 记忆提取进度百分比

---

## 涉及文件

| 文件 | 改动 |
|------|------|
| `src/channels/http.ts` | 新增 extract 路由，移除 fire-and-forget 调用 |
| `src/memory/extract.ts` | 返回值从 void 改为 number（提取条数） |
| `web/src/types/index.ts` | DisplayBlock 新增 memoryStatus/memoryCount |
| `web/src/store/chatStore.ts` | SSE 结束后调用 extract API，更新状态 |
| `web/src/components/MessageBubble.tsx` | 新增 MemoryStatusBar 组件 |
