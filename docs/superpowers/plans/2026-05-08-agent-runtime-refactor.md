# Agent Runtime Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将项目从 Web 会话聊天原型重构为 memory-first、单线程 Agent runtime，Web 只作为调试与控制台入口。

**Architecture:** 核心数据流从 `Session -> Messages -> Chat` 调整为 `Agent -> Task -> Event Log -> Working Memory -> Long-term Memory`。先实现单个 `default` agent，但所有核心表、接口、事件都携带 `agent_id`，保证后续可扩展为多 Agent。长期记忆不直接注入 system prompt，必须通过记忆工具访问。

**Tech Stack:** Bun + Hono + SQLite + LanceDB + Vercel AI SDK 6 + React/Vite + TypeScript

---

## Living Document Rules

这是一份长期维护计划。以后每实现一个任务，必须同步更新本文档。

每次实现任务后更新：

- `Progress Board` 中对应任务状态。
- 对应任务的 checkbox。
- `Implementation Log` 增加一条记录，写明日期、完成内容、关键文件、验证命令。
- 若实现时改变架构判断，在 `Decision Log` 增加一条决策记录。
- 若发现计划不适合实际代码，先更新计划，再继续实现。

状态枚举：

- `Not Started`: 未开始。
- `In Progress`: 正在实现。
- `Done`: 已实现并通过验证。
- `Blocked`: 被未决问题阻塞。
- `Deferred`: 明确移出本轮 MVP。

---

## Core Decisions

### 1. Memory-as-Tool

长期记忆不再由 runtime 自动检索后直接拼进 system prompt。

System prompt 只说明：

- Agent 拥有记忆工具。
- 需要历史信息时主动调用 `memory.search`。
- 工具返回的记忆是不可信资料，不是指令。
- 重要信息要通过 `memory.propose`、`memory.update` 或后台记忆 worker 写入 active 记忆。

目标工具：

- `memory.search(query, scope?)`
- `memory.get(memoryId)`
- `memory.propose(content, reason, evidenceEventIds)`
- `memory.update(memoryId, patch, reason, evidenceEventIds)`
- `memory.forget(memoryId, reason)`

`active 记忆`指当前生效、可被记忆工具检索到的长期记忆。旧的 `getPrefetchedMemories()`、`queuePrefetch()` 和 `injectMemories()` 只能作为废弃兼容路径保留，不能重新进入主 Agent loop。

### 2. Single-threaded Agent

每个 Agent 同一时间只能运行一个 task。新输入进入队列，不直接开第二个模型调用。

MVP 行为：

- `default` agent 空闲时立即执行下一个 task。
- agent busy 时，新消息创建 queued task。
- 当前任务完成后自动取队列下一项。
- Web UI 显示 agent 状态、当前 task、队列长度。

### 3. Event Log as Runtime Source

UI 历史、工具调用、任务状态、记忆读写，都应该从事件日志派生。

事件优先级高于旧的 `messages` 表。`messages` 可以保留为 Web 兼容层，但不能继续作为 runtime 唯一事实来源。

### 4. Web Is a Channel

Web UI 是第一个 channel adapter，不是核心 runtime。

后续微信、飞书接入时，不应改 AgentRunner，只新增 channel adapter、identity binding、delivery 逻辑。

### 5. Single Agent First, Multi-agent Ready

MVP 只实现一个 `default` agent。所有表和接口从第一天带 `agent_id`。

后续多 Agent 通过以下方式扩展：

- 多条 agent 配置。
- 每个 agent 独立 task queue 和 lock。
- Channel binding 将不同用户、群、账号路由到不同 agent。
- Agent 之间通过 task delegation 或 message event 协作。

### 6. Current Memory Lifecycle

当前记忆系统已经切换为“工具读取 + 后台整理”的闭环：

- 主 Agent 不会自动获得长期记忆内容，必须显式调用 `memory_search` 或 `memory_get`。
- 主 Agent 可以通过 `memory_propose` 直接写入 active 记忆；`memory_update` 和 `memory_forget` 用于显式修改或停用记忆。
- 每轮助手回复持久化后触发 `assistant.message.persisted` 生命周期 hook。`生命周期 hook` 指 runtime 在关键节点发布的内部事件回调。
- 内部记忆 worker 会后台执行 `memory_extract` 和 `memory_reconsolidate`。`worker` 指不直接回答用户、专门处理后台任务的执行器。
- `memory_extract` 从本轮用户明确事实提取新 active 记忆。
- `memory_reconsolidate` 在旧记忆被重新检索或 worker 自主检索到后，用新证据更新原 active 记忆。`再巩固`指旧记忆被唤起后，结合新事实重新写回。
- 新记忆写入前会检查本轮检索结果和全局 active 记忆，避免跨会话重复写入。
- 去重会识别已有事实中包含的偏好片段，避免把同一内容跨类型再写成 preference。
- 历史重复清理由确定性 `memory.dedupe` 处理。`确定性`指只按固定规则处理规范化后完全相同的内容，不让模型自由改写。
- dream worker 仍是后续工作，用于定时整理近似重复、冲突摘要和长期知识沉淀。

---

## Current Baseline

当前已经实现：

- `src/routes/chat.ts`: Web chat 入口，接收 Web 输入并交给 channel/Agent runtime。
- `src/core/database.ts`: SQLite 初始化，包含 session 兼容层和 runtime 表。
- `src/agents/*`: Agent registry、单线程状态和 AgentRunner。
- `src/tasks/*`: Task queue、task store 和单 Agent lock。
- `src/events/*`: 事件日志和 runtime 事件类型。
- `src/brain/*`: prompt builder、tool registry、tool policy 和工具定义。
- `src/memory/*`: LanceDB 长期记忆、记忆工具、后台提取 worker、再巩固、确定性去重和 working memory。
- `src/lifecycle/*`: 生命周期 hook 总线。
- `src/channels/*`: Web channel adapter 和 session 兼容 API。
- `web/src/*`: Web 调试 UI、消息历史、工具展示、记忆面板。

当前主要缺口：

- 还没有 dream worker 定时整理长期记忆。
- 还没有 WeChat / Feishu channel adapter。
- 还没有多 Agent delegation。
- 还没有 MCP server / 插件市场接入。
- 还没有 WebSocket/SSE 事件推送。
- 还没有完整的记忆审计与手动合并 UI。

---

## Progress Board

| Task | Name | Status | Last Updated |
| --- | --- | --- | --- |
| 1 | Runtime schema | Done | 2026-05-08 |
| 2 | Agent registry | Done | 2026-05-08 |
| 3 | Task queue and lock | Done | 2026-05-08 |
| 4 | Event log | Done | 2026-05-08 |
| 5 | Working memory | Done | 2026-05-08 |
| 6 | Agent runner extraction | Done | 2026-05-08 |
| 7 | Memory tools | Done | 2026-05-08 |
| 8 | Remove memory prompt injection | Done | 2026-05-08 |
| 9 | Channel adapter boundary | Done | 2026-05-08 |
| 10 | Tool registry and policy | Done | 2026-05-08 |
| 11 | Runtime status APIs | Done | 2026-05-08 |
| 12 | Web control panel integration | Done | 2026-05-08 |
| 13 | Documentation and cleanup | Done | 2026-05-08 |
| 14 | Lifecycle hook memory worker | Done | 2026-05-08 |
| 15 | Candidate-memory cleanup | Done | 2026-05-09 |
| 16 | Memory worker risk hardening | Done | 2026-05-09 |
| 17 | Global active-memory dedupe | Done | 2026-05-09 |
| 18 | Deterministic duplicate cleanup | Done | 2026-05-09 |
| 19 | Cross-type memory fragment dedupe | Done | 2026-05-09 |

---

## Target File Structure

```text
src/
├── agents/
│   ├── agent-registry.ts
│   ├── agent-runner.ts
│   ├── agent-state.ts
│   └── agent-types.ts
├── tasks/
│   ├── task-queue.ts
│   ├── task-store.ts
│   └── task-types.ts
├── events/
│   ├── event-log.ts
│   └── event-types.ts
├── memory/
│   ├── dedupe.ts
│   ├── extraction-worker.ts
│   ├── lifecycle-hooks.ts
│   ├── memory-tools.ts
│   ├── working-memory.ts
│   ├── store.ts
│   ├── extract.ts
│   └── embedder.ts
├── lifecycle/
│   └── hooks.ts
├── channels/
│   ├── channel-adapter.ts
│   ├── web-channel.ts
│   ├── session-api.ts
│   └── message-parts.ts
├── brain/
│   ├── prompt-builder.ts
│   ├── tool-registry.ts
│   ├── tool-policy.ts
│   ├── tool-executor.ts
│   └── tools.ts
├── routes/
│   ├── chat.ts
│   ├── runtime.ts
│   ├── sessions.ts
│   ├── memory.ts
│   └── tools.ts
└── core/
    ├── database.ts
    ├── config.ts
    └── runtime.ts
```

文件结构允许按实际实现调整，但调整时必须在 `Decision Log` 写明原因。

---

## Data Model

### SQLite Tables

`agents`

```sql
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'idle',
  current_task_id TEXT,
  workspace_path TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

`tasks`

```sql
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  conversation_id TEXT,
  source_channel TEXT NOT NULL,
  source_user_id TEXT NOT NULL DEFAULT 'default',
  status TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  input TEXT NOT NULL,
  result TEXT,
  error TEXT,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  completed_at INTEGER,
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);
```

`events`

```sql
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  task_id TEXT,
  conversation_id TEXT,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (agent_id) REFERENCES agents(id),
  FOREIGN KEY (task_id) REFERENCES tasks(id)
);
```

`working_memory`

```sql
CREATE TABLE IF NOT EXISTS working_memory (
  agent_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (agent_id, task_id, key),
  FOREIGN KEY (agent_id) REFERENCES agents(id),
  FOREIGN KEY (task_id) REFERENCES tasks(id)
);
```

`conversations`

```sql
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  external_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '新对话',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(channel, external_id),
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);
```

`channel_identities`

```sql
CREATE TABLE IF NOT EXISTS channel_identities (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  external_user_id TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(channel, external_user_id)
);
```

---

## Task 1: Runtime Schema

**Files:**

- Modify: `src/core/database.ts`
- Create: `src/agents/agent-types.ts`
- Create: `src/tasks/task-types.ts`
- Create: `src/events/event-types.ts`
- Test: `src/core/database.test.ts`

- [x] **Step 1: Add schema tests**

Create tests that initialize the database and assert these tables exist:

- `agents`
- `tasks`
- `events`
- `working_memory`
- `conversations`
- `channel_identities`

Run:

```bash
bun test src/core/database.test.ts
```

Expected: fail before schema exists.

- [x] **Step 2: Add SQLite tables and indexes**

Extend `getDb()` in `src/core/database.ts` with the tables from `Data Model`.

Required indexes:

```sql
CREATE INDEX IF NOT EXISTS idx_tasks_agent_status ON tasks(agent_id, status, priority, created_at);
CREATE INDEX IF NOT EXISTS idx_events_agent_created ON events(agent_id, created_at);
CREATE INDEX IF NOT EXISTS idx_events_task_created ON events(task_id, created_at);
CREATE INDEX IF NOT EXISTS idx_conversations_agent_updated ON conversations(agent_id, updated_at);
```

- [x] **Step 3: Add shared runtime types**

Create type files with string union statuses:

```ts
export type AgentStatus = "idle" | "running" | "paused" | "error";
export type TaskStatus = "queued" | "running" | "completed" | "failed" | "canceled";
```

- [x] **Step 4: Verify**

Run:

```bash
bun test src/core/database.test.ts
bun run typecheck
```

Expected: all pass.

---

## Task 2: Agent Registry

**Files:**

- Create: `src/agents/agent-registry.ts`
- Modify: `src/core/runtime.ts`
- Modify: `src/main.ts`
- Test: `src/agents/agent-registry.test.ts`

- [x] **Step 1: Write registry tests**

Cover:

- `ensureDefaultAgent()` creates `default` if missing.
- Calling it twice is idempotent.
- `getAgent("default")` returns status `idle`.

- [x] **Step 2: Implement registry**

Required API:

```ts
export function ensureDefaultAgent(): AgentRecord;
export function getAgent(agentId: string): AgentRecord | null;
export function updateAgentStatus(agentId: string, status: AgentStatus, currentTaskId?: string | null): void;
```

- [x] **Step 3: Initialize default agent at startup**

Call `ensureDefaultAgent()` during runtime startup, before routes handle chat requests.

- [x] **Step 4: Verify**

Run:

```bash
bun test src/agents/agent-registry.test.ts
bun run typecheck
```

Expected: all pass.

---

## Task 3: Task Queue and Single-thread Lock

**Files:**

- Create: `src/tasks/task-store.ts`
- Create: `src/tasks/task-queue.ts`
- Test: `src/tasks/task-queue.test.ts`

- [x] **Step 1: Write task queue tests**

Cover:

- Creating task stores `queued`.
- `claimNextTask("default")` returns oldest highest-priority queued task.
- If agent status is `running`, no second task is claimed.
- Completing current task sets agent back to `idle`.

- [x] **Step 2: Implement task store**

Required API:

```ts
export function createTask(input: CreateTaskInput): TaskRecord;
export function getTask(taskId: string): TaskRecord | null;
export function listTasks(agentId: string, statuses?: TaskStatus[]): TaskRecord[];
export function markTaskRunning(taskId: string): void;
export function markTaskCompleted(taskId: string, result: string): void;
export function markTaskFailed(taskId: string, error: string): void;
```

- [x] **Step 3: Implement queue claim lock**

Use a SQLite transaction so one agent cannot claim two tasks concurrently.

- [x] **Step 4: Verify**

Run:

```bash
bun test src/tasks/task-queue.test.ts
bun run typecheck
```

Expected: all pass.

---

## Task 4: Event Log

**Files:**

- Create: `src/events/event-log.ts`
- Test: `src/events/event-log.test.ts`

- [x] **Step 1: Write event log tests**

Cover:

- Append event.
- List events by task.
- List events by conversation.
- Payload round-trips JSON safely.

- [x] **Step 2: Implement event log**

Required API:

```ts
export function appendEvent(input: AppendEventInput): RuntimeEvent;
export function listTaskEvents(taskId: string): RuntimeEvent[];
export function listConversationEvents(conversationId: string): RuntimeEvent[];
export function listAgentEvents(agentId: string, limit?: number): RuntimeEvent[];
```

Minimum event types:

```ts
export type RuntimeEventType =
  | "task.created"
  | "task.started"
  | "task.completed"
  | "task.failed"
  | "user.message"
  | "assistant.delta"
  | "assistant.message"
  | "tool.call"
  | "tool.result"
  | "memory.search"
  | "memory.propose"
  | "memory.update";
```

- [x] **Step 3: Verify**

Run:

```bash
bun test src/events/event-log.test.ts
bun run typecheck
```

Expected: all pass.

---

## Task 5: Working Memory

**Files:**

- Create: `src/memory/working-memory.ts`
- Test: `src/memory/working-memory.test.ts`

- [x] **Step 1: Write working memory tests**

Cover:

- Set key.
- Get key.
- List all keys for task.
- Clear task working memory after completion.

- [x] **Step 2: Implement working memory API**

Required API:

```ts
export function setWorkingMemory(agentId: string, taskId: string, key: string, value: unknown): void;
export function getWorkingMemory<T>(agentId: string, taskId: string, key: string): T | null;
export function listWorkingMemory(agentId: string, taskId: string): Record<string, unknown>;
export function clearWorkingMemory(agentId: string, taskId: string): void;
```

- [x] **Step 3: Verify**

Run:

```bash
bun test src/memory/working-memory.test.ts
bun run typecheck
```

Expected: all pass.

---

## Task 6: Agent Runner Extraction

**Files:**

- Create: `src/agents/agent-runner.ts`
- Create: `src/brain/prompt-builder.ts`
- Modify: `src/routes/chat.ts`
- Test: `src/agents/agent-runner.test.ts`

- [x] **Step 1: Write runner tests with a fake model adapter**

Cover:

- Runner marks task as running.
- Runner appends task lifecycle events.
- Runner completes task with assistant output.
- Runner marks task failed when model call throws.

- [x] **Step 2: Move model execution out of route**

`src/routes/chat.ts` should create or append channel input, then submit a task. Model streaming belongs in `AgentRunner`.

- [x] **Step 3: Add prompt builder without memory injection**

Prompt builder may include:

- agent identity
- tool usage rules
- current task input
- working memory summary

Prompt builder must not include long-term memory search results.

- [x] **Step 4: Verify**

Run:

```bash
bun test src/agents/agent-runner.test.ts
bun run typecheck
```

Expected: all pass.

---

## Task 7: Memory Tools

**Files:**

- Create: `src/memory/memory-tools.ts`
- Modify: `src/memory/store.ts`
- Modify: `src/brain/tools.ts`
- Test: `src/memory/memory-tools.test.ts`

- [x] **Step 1: Write memory tool tests**

Cover:

- `memory.search` returns ranked memories without exposing raw system content.
- `memory.get` returns one memory by id.
- `memory.propose` now writes active long-term memory directly. Earlier candidate behavior has been superseded.
- `memory.update` records evidence event ids.
- `memory.forget` marks memory inactive instead of deleting by default.

- [x] **Step 2: Implement memory tools**

Add tool definitions and execution wrappers for:

- `memory_search`
- `memory_get`
- `memory_propose`
- `memory_update`
- `memory_forget`

Tool names may use snake case if AI SDK compatibility requires it. UI labels can render dotted names.

- [x] **Step 3: Persist memory tool events**

Each memory tool call appends an event:

- `memory.search`
- `memory.propose`
- `memory.update`

- [x] **Step 4: Verify**

Run:

```bash
bun test src/memory/memory-tools.test.ts
bun run typecheck
```

Expected: all pass.

---

## Task 8: Remove Memory Prompt Injection

**Files:**

- Modify: `src/routes/chat.ts`
- Modify: `src/memory/memory.ts`
- Modify: `src/memory/prefetch.ts`
- Test: `src/routes/chat.test.ts`

- [x] **Step 1: Write regression test**

Test that chat system prompt does not contain `<relevant-memories>` and does not call `getPrefetchedMemories()` before model execution.

- [x] **Step 2: Remove direct memory injection from chat route**

Delete or bypass the route-level enhanced prompt path.

- [x] **Step 3: Keep memory modules available for tools**

Do not delete LanceDB store or search implementation. Only remove automatic prompt injection from the main Agent flow.

- [x] **Step 4: Verify**

Run:

```bash
bun test src/routes/chat.test.ts
bun run typecheck
```

Expected: all pass.

---

## Task 9: Channel Adapter Boundary

**Files:**

- Create: `src/channels/channel-adapter.ts`
- Create: `src/channels/web-channel.ts`
- Modify: `src/routes/chat.ts`
- Test: `src/channels/web-channel.test.ts`

- [x] **Step 1: Write channel adapter tests**

Cover:

- Web message maps to `conversation_id`.
- Same Web session maps to same conversation.
- Channel input creates a queued task for `default` agent.

- [x] **Step 2: Define ChannelAdapter interface**

Required shape:

```ts
export interface ChannelAdapter {
  readonly channel: string;
  receive(input: ChannelInput): Promise<ChannelReceiveResult>;
  deliver(output: ChannelOutput): Promise<void>;
}
```

- [x] **Step 3: Implement Web channel adapter**

The Web adapter preserves current frontend compatibility while writing to `conversations` and `events`.

- [x] **Step 4: Verify**

Run:

```bash
bun test src/channels/web-channel.test.ts
bun run typecheck
```

Expected: all pass.

---

## Task 10: Tool Registry and Policy

**Files:**

- Create: `src/brain/tool-registry.ts`
- Create: `src/brain/tool-policy.ts`
- Modify: `src/brain/tools.ts`
- Modify: `src/brain/tool-executor.ts`
- Test: `src/brain/tool-registry.test.ts`
- Test: `src/brain/tool-policy.test.ts`

- [x] **Step 1: Write registry tests**

Cover:

- Register built-in tools.
- Register memory tools.
- List tools by agent.
- Disable a tool for an agent.

- [x] **Step 2: Write policy tests**

Cover:

- Read-only tools allowed by default.
- Write tools require approval unless allowlisted.
- Memory write tools write active memories by default.

- [x] **Step 3: Implement registry and policy**

Required API:

```ts
export function registerTool(tool: RegisteredTool): void;
export function getTool(name: string): RegisteredTool | null;
export function listToolsForAgent(agentId: string): RegisteredTool[];
export function evaluateToolPolicy(input: ToolPolicyInput): ToolPolicyDecision;
```

- [x] **Step 4: Verify**

Run:

```bash
bun test src/brain/tool-registry.test.ts src/brain/tool-policy.test.ts
bun run typecheck
```

Expected: all pass.

---

## Task 11: Runtime Status APIs

**Files:**

- Create: `src/routes/runtime.ts`
- Modify: `src/main.ts`
- Test: `src/routes/runtime.test.ts`

- [x] **Step 1: Write route tests**

Cover:

- `GET /runtime/agents/default`
- `GET /runtime/tasks?agentId=default`
- `GET /runtime/events?agentId=default`
- `POST /runtime/tasks/:id/cancel`

- [x] **Step 2: Implement runtime routes**

Routes return JSON only. Streaming remains in chat/channel routes until event streaming is designed.

- [x] **Step 3: Register route**

Register runtime route in `src/main.ts`.

- [x] **Step 4: Verify**

Run:

```bash
bun test src/routes/runtime.test.ts
bun run typecheck
```

Expected: all pass.

---

## Task 12: Web Control Panel Integration

**Files:**

- Modify: `web/src/store/chatStore.ts`
- Create: `web/src/store/runtimeStore.ts`
- Modify: `web/src/components/SessionSidebar.tsx`
- Modify: `web/src/components/MessageBubble.tsx`
- Modify: `web/src/components/MemoryPanel.tsx`
- Test: `web/src/store/runtimeStore.test.ts`

- [x] **Step 1: Write frontend store tests**

Cover:

- Fetch runtime status.
- Fetch queue.
- Fetch events.
- Render tool and memory events from persisted history.

- [x] **Step 2: Add runtime store**

Poll runtime APIs initially. WebSocket/SSE event stream can be added after MVP runtime stabilizes.

- [x] **Step 3: Update UI surfaces**

Show:

- agent status
- current task
- queue length
- event history
- memory tool calls
- memory stats and persisted memory worker cards

- [x] **Step 4: Verify**

Run:

```bash
bun test web/src/store/runtimeStore.test.ts
bun run typecheck
```

Expected: all pass.

---

## Task 13: Documentation and Cleanup

**Files:**

- Modify: `docs/superpowers/plans/2026-05-08-agent-runtime-refactor.md`
- Create: `docs/superpowers/specs/2026-05-08-agent-runtime-refactor-design.md`
- Modify: `docs/superpowers/specs/2026-05-05-agent-architecture-design.md`

- [x] **Step 1: Write architecture spec**

Create a compact spec that captures the final MVP architecture after implementation has validated the shape.

- [x] **Step 2: Mark old architecture assumptions**

Update the older architecture spec to point to the new Agent Runtime refactor spec, especially around Memory-as-Tool.

- [x] **Step 3: Final verification**

Run:

```bash
bun test
bun run check
```

Expected: all pass.

- [x] **Step 4: Update this plan**

Set all completed tasks to `Done`, add final `Implementation Log`, and record remaining non-MVP work under `Deferred Work`.

---

## Task 14: Lifecycle Hook Memory Worker

**Files:**

- Create: `src/lifecycle/hooks.ts`
- Create: `src/memory/extraction-worker.ts`
- Create: `src/memory/lifecycle-hooks.ts`
- Modify: `src/routes/chat.ts`
- Modify: `src/main.ts`
- Modify: `web/src/components/MessageBubble.tsx`
- Test: `src/memory/extraction-worker.test.ts`

- [x] **Step 1: Add lifecycle hook bus**

Support `assistant.message.persisted` so runtime components can react after assistant messages are saved.

- [x] **Step 2: Move memory extraction behind the backend hook**

Run memory extraction in an internal worker instead of letting the frontend call memory extraction APIs.

- [x] **Step 3: Persist synthetic tool cards**

Append `memory_extract` and `memory_reconsolidate` tool parts to the assistant message so current and historical chats show the same background memory work.

- [x] **Step 4: Verify**

Run:

```bash
bun test src/memory/extraction-worker.test.ts
bun run typecheck
cd web && bun run build
```

Expected: all pass.

---

## Task 15: Candidate-memory Cleanup

**Files:**

- Modify: `src/memory/memory-tools.ts`
- Modify: `src/brain/tool-policy.ts`
- Modify: `web/src/components/MemoryPanel.tsx`
- Modify: `web/src/store/runtimeStore.ts`
- Test: `src/memory/memory-tools.test.ts`
- Test: `src/brain/tool-policy.test.ts`

- [x] **Step 1: Stop creating new candidate memories in MVP flow**

`memory_propose` writes active memories directly. `candidate` means pending review memory, and it is no longer part of the current MVP path.

- [x] **Step 2: Remove candidate UI emphasis**

Memory UI should show active memory stats and actions, not candidate-memory counters.

- [x] **Step 3: Update policy labels**

Tool policy and runtime labels should describe memory writes as active writes.

- [x] **Step 4: Verify**

Run:

```bash
bun test src/memory/memory-tools.test.ts src/brain/tool-policy.test.ts
bun run typecheck
cd web && bun run build
```

Expected: all pass.

---

## Task 16: Memory Worker Risk Hardening

**Files:**

- Modify: `src/memory/extraction-worker.ts`
- Modify: `web/src/store/chatStore.ts`
- Test: `src/memory/extraction-worker.test.ts`

- [x] **Step 1: Let the worker search old memories itself**

The worker should not depend on the main Agent choosing to call `memory_search`.

- [x] **Step 2: Merge Agent and worker retrieval results**

Reconsolidation uses both main-Agent memory search events and worker autonomous search results.

- [x] **Step 3: Add write quality gates**

Reject low-confidence memory, suspicious prompt-injection-like content, and duplicate content.

- [x] **Step 4: Keep frontend polling while memory cards run**

Current chat should continue refreshing until background memory tool parts finish.

- [x] **Step 5: Verify**

Run:

```bash
bun test src/memory/extraction-worker.test.ts
bun test
bun run typecheck
bun run lint
cd web && bun run build
```

Expected: all pass.

---

## Task 17: Global Active-memory Dedupe

**Files:**

- Modify: `src/memory/extraction-worker.ts`
- Test: `src/memory/extraction-worker.test.ts`

- [x] **Step 1: Check global active memory before write**

When `searchMemories()` misses an existing memory, the worker still scans the active-memory list before calling `addMemory`.

- [x] **Step 2: Prevent same-plan duplicates**

Memories written earlier in the same worker run are added to the local duplicate set.

- [x] **Step 3: Add cross-session regression test**

Repeated “please remember” statements in different sessions should not create duplicate active memories.

- [x] **Step 4: Verify**

Run:

```bash
bun test src/memory/extraction-worker.test.ts
bun test
bun run typecheck
bun run lint
cd web && bun run build
```

Expected: all pass.

---

## Task 18: Deterministic Duplicate Cleanup

**Files:**

- Create: `src/memory/dedupe.ts`
- Create: `src/memory/dedupe.test.ts`
- Modify: `src/routes/memory.ts`
- Modify: `src/events/event-types.ts`
- Modify: `web/src/store/runtimeStore.ts`

- [x] **Step 1: Add exact active-memory duplicate cleanup**

`memory.dedupe` groups normalized exact duplicates and marks duplicate active memories as inactive. It does not hard-delete data.

- [x] **Step 2: Add dry-run support**

`dryRun` reports duplicate groups without changing memory status.

- [x] **Step 3: Record runtime events**

Emit `memory.dedupe.started`, `memory.dedupe.completed`, and `memory.dedupe.failed`.

- [x] **Step 4: Verify**

Run:

```bash
bun test src/memory/dedupe.test.ts
bun run typecheck
```

Expected: all pass.

---

## Task 19: Cross-type Memory Fragment Dedupe

**Files:**

- Create: `src/memory/duplicate.ts`
- Modify: `src/memory/extraction-worker.ts`
- Modify: `src/memory/memory-tools.ts`
- Modify: `src/memory/dedupe.ts`
- Test: `src/memory/extraction-worker.test.ts`
- Test: `src/memory/memory-tools.test.ts`

- [x] **Step 1: Share duplicate detection**

Move memory-content normalization and duplicate matching into a shared helper.

- [x] **Step 2: Detect embedded preference fragments**

If an active fact already contains a preference fragment, skip writing the same fragment as a separate preference memory.

- [x] **Step 3: Apply to both write paths**

Use the shared duplicate check in both the lifecycle memory worker and `memory_propose`.

- [x] **Step 4: Verify**

Run:

```bash
bun test src/memory/extraction-worker.test.ts src/memory/memory-tools.test.ts src/memory/dedupe.test.ts
bun test
bun run typecheck
bun run lint
```

Expected: all pass.

---

## Deferred Work

These are important, but not required for the first Agent Runtime MVP:

- WeChat adapter.
- Feishu adapter.
- Multi-agent delegation.
- Cron and heartbeat.
- MCP server integration.
- Plugin marketplace.
- Sandboxed terminal backends.
- Dream worker for scheduled long-running memory consolidation.
- WebSocket event replay and gap recovery.

---

## Acceptance Criteria

MVP is complete when:

- `default` agent exists as a real entity.
- Web input creates a task instead of directly owning model execution.
- `default` agent only runs one task at a time.
- Tool calls, model output, task lifecycle, and memory actions are recorded as events.
- Working memory exists per task.
- Long-term memory is accessed through tools, not automatic prompt injection.
- Backend memory worker extracts, reconsolidates, and deduplicates active memories without blocking the main Agent reply.
- Web UI can show current agent status, queue, events, tool calls, and memory calls.
- Existing chat experience still works through the Web channel.
- `bun test` and `bun run check` pass.

---

## Implementation Log

### 2026-05-08

- Created this living refactor plan.
- Locked initial architecture direction:
  - Single Agent first.
  - Multi-agent ready through `agent_id`.
  - Memory-as-Tool.
  - Event Log as runtime source.
  - Web as first channel adapter.
- Task 1 Runtime schema completed:
  - Added runtime SQLite schema and indexes in `src/core/database.ts`.
  - Added isolated in-memory schema tests in `src/core/database.test.ts` covering runtime columns, defaults, foreign keys, and index columns.
  - Added shared runtime status and record types in `src/agents/agent-types.ts`, `src/tasks/task-types.ts`, and `src/events/event-types.ts`.
  - Verified with `bun test src/core/database.test.ts` and `bun run typecheck`.
- Task 2 Agent registry completed:
  - Added `src/agents/agent-registry.ts` with `ensureDefaultAgent`, `getAgent`, and `updateAgentStatus`.
  - Added isolated in-memory registry tests in `src/agents/agent-registry.test.ts`.
  - Added `initializeRuntime()` in `src/core/runtime.ts` and called it from `src/main.ts` so the `default` agent exists before routes handle requests.
  - Verified with `bun test src/agents/agent-registry.test.ts`, `bun test src/core/database.test.ts src/agents/agent-registry.test.ts`, and `bun run typecheck`.
- Task 3 Task queue and lock completed:
  - Added `src/tasks/task-store.ts` with queued task creation, lookup, listing, running/completed/failed state updates.
  - Added `src/tasks/task-queue.ts` with transactional `claimNextTask()` that refuses a second claim while the agent is running.
  - Added isolated in-memory task queue tests in `src/tasks/task-queue.test.ts`.
  - Verified with `bun test src/tasks/task-queue.test.ts`, `bun test src/core/database.test.ts src/agents/agent-registry.test.ts src/tasks/task-queue.test.ts`, `bun run typecheck`, and `bun run lint`.
- Task 4 Event log completed:
  - Added `src/events/event-log.ts` with append and list APIs for task, conversation, and agent event history.
  - Added isolated in-memory event log tests in `src/events/event-log.test.ts` covering append, task/conversation filters, JSON payload round-trip, ordering, and limit behavior.
  - Verified with `bun test src/events/event-log.test.ts`, `bun test src/core/database.test.ts src/agents/agent-registry.test.ts src/tasks/task-queue.test.ts src/events/event-log.test.ts`, `bun run typecheck`, and `bun run lint`.
- Task 5 Working memory completed:
  - Added `src/memory/working-memory.ts` with JSON-backed set, get, list, and clear APIs scoped by `agent_id` and `task_id`.
  - Added isolated in-memory working memory tests in `src/memory/working-memory.test.ts`.
  - Verified with `bun test src/memory/working-memory.test.ts`, `bun test src/core/database.test.ts src/agents/agent-registry.test.ts src/tasks/task-queue.test.ts src/events/event-log.test.ts src/memory/working-memory.test.ts`, `bun run typecheck`, and `bun run lint`.
- Task 6 Agent runner extraction completed:
  - Added `src/brain/prompt-builder.ts` to centralize the system prompt and working-memory injection only.
  - Added `src/agents/agent-runner.ts` to own model execution, task lifecycle events, and stream response conversion.
  - Added `src/agents/agent-runner.test.ts` covering running, started/completed/failed events, and busy-task handling.
  - Updated `src/routes/chat.ts` to create the task and delegate streaming to AgentRunner instead of owning `streamText` directly.
  - Verified with `bun test src/agents/agent-runner.test.ts`, `bun test src/tasks/task-queue.test.ts src/agents/agent-runner.test.ts`, `bun test`, `bun run typecheck`, and `bun run lint`.
- Task 7 Memory tools completed:
  - Added `src/memory/memory-tools.ts` with `memory_search`, `memory_get`, `memory_propose`, `memory_update`, and `memory_forget` tool definitions and execution helpers.
  - Updated `src/brain/tools.ts` to expose memory tools to the model.
  - Extended `src/memory/store.ts` so memory writes and inactive status transitions are explicit.
  - Added `src/memory/memory-tools.test.ts` covering suspicious memory filtering, get, active proposal, update evidence events, and inactive forget behavior.
  - Verified with `bun test src/memory/memory-tools.test.ts`, `bun test`, `bun run typecheck`, and `bun run lint`.
- Task 8 Remove memory prompt injection completed:
  - Removed the remaining `queuePrefetch` call from `src/routes/chat.ts`.
  - Added `src/routes/chat.test.ts` to prevent `getPrefetchedMemories`, `queuePrefetch`, or `<relevant-memories>` from returning to the chat route.
  - Marked legacy prompt-injection helpers in `src/memory/memory.ts` and `src/memory/prefetch.ts` as deprecated compatibility paths.
  - Verified with `bun test src/routes/chat.test.ts`, `bun test`, `bun run typecheck`, and `bun run lint`.
- Task 9 Channel adapter boundary completed:
  - Added `src/channels/channel-adapter.ts` with channel-neutral input, output, receive result, and adapter interfaces.
  - Added `src/channels/web-channel.ts` to map Web sessions to conversations, create queued tasks, and record channel events.
  - Updated `src/routes/chat.ts` to receive Web input through `WebChannelAdapter`.
  - Added `src/channels/web-channel.test.ts` covering conversation mapping, same-session reuse, queued default-agent task creation, and event writes.
  - Verified with `bun test src/channels/web-channel.test.ts`, `bun test`, `bun run typecheck`, and `bun run lint`.
- Task 10 Tool registry and policy completed:
  - Added `src/brain/tool-registry.ts` for registered tool metadata, per-agent listing, and AI SDK toolset generation.
  - Added `src/brain/tool-policy.ts` for read/write/memory policy decisions.
  - Updated `src/brain/tools.ts` to register filesystem and memory tools through the registry.
  - Added `isInputPathAllowlisted()` in `src/brain/tool-executor.ts` for policy-safe path checks.
  - Added `src/brain/tool-registry.test.ts` and `src/brain/tool-policy.test.ts`.
  - Verified with `bun test src/brain/tool-registry.test.ts src/brain/tool-policy.test.ts`, `bun test`, `bun run typecheck`, and `bun run lint`.
- Task 11 Runtime status APIs completed:
  - Added `src/routes/runtime.ts` with agent, task, event, and cancel endpoints.
  - Added `markTaskCanceled()` in `src/tasks/task-store.ts`.
  - Registered runtime routes under `/api/runtime` in `src/main.ts`.
  - Added `src/routes/runtime.test.ts` covering agent status, task listing, event listing, queued cancel, and running cancel release.
  - Verified with `bun test src/routes/runtime.test.ts`, `bun test`, `bun run typecheck`, and `bun run lint`.
- Task 12 Web control panel integration completed:
  - Added `web/src/store/runtimeStore.ts` with runtime snapshot polling, task cancellation, queue/current-task selectors, event payload parsing, and event view labels.
  - Added `web/src/store/runtimeStore.test.ts` covering runtime status fetch, task queue derivation, and persisted memory/tool event display metadata.
  - Updated `web/src/components/SessionSidebar.tsx` to replace duplicate static control links with a runtime panel showing agent status, current task, queue length, recent runtime events, refresh, and cancel action.
  - Updated `web/src/components/MessageBubble.tsx` so persisted memory tools render as memory actions instead of raw generic tool names.
  - Updated `web/src/components/MemoryPanel.tsx` to surface memory stats.
  - Verified with `bun test web/src/store/runtimeStore.test.ts web/src/store/chatStore.test.ts web/src/lib/toolPart.test.ts`, `bun run build` from `web/`, and `bun run typecheck`.
- Task 13 Documentation and cleanup completed:
  - Added `docs/superpowers/specs/2026-05-08-agent-runtime-refactor-design.md` as the current MVP architecture source of truth.
  - Updated `docs/superpowers/specs/2026-05-05-agent-architecture-design.md` to mark early memory-injection assumptions as superseded by Memory-as-Tool.
  - Final verification passed with `bun test` (65 pass, 0 fail) and `bun run check`.
- Task 14 Lifecycle hook memory worker completed:
  - Added a backend lifecycle hook boundary for `assistant.message.persisted`.
  - Added an internal memory extraction worker that runs after assistant message persistence instead of being triggered by the frontend.
  - Added synthetic `memory_extract` and `memory_reconsolidate` tool parts so background memory work can render in chat history like tool calls.
  - Updated memory tools so `memory.search` events carry task and conversation context for later reconsolidation.
  - Removed the frontend per-message legacy extraction status flow.
  - Verified with targeted backend tests, `bun test` (71 pass, 0 fail), `bun run typecheck`, `bun run lint`, and `cd web && bun run build`.
- Task 15 Candidate-memory UI and policy cleanup completed:
  - Updated `memory_propose` so model-proposed memories are written as active memories.
  - Updated memory tool policy metadata so memory writes no longer advertise candidate creation.
  - Removed the candidate-memory count from the memory management panel.
  - Renamed memory-propose UI labels from candidate wording to active memory writing wording.
  - Verified with targeted tests, `bun test` (71 pass, 0 fail), `bun run typecheck`, `bun run lint`, and `cd web && bun run build`.
- Task 16 Memory worker risk hardening completed:
  - Updated the memory worker to run its own related-memory search every turn, so reconsolidation no longer depends on the main Agent choosing to call `memory_search`.
  - Merged main-Agent memory search results with worker search results before planning extraction and reconsolidation.
  - Added active-memory write quality gates for confidence, suspicious content, and duplicate content.
  - Updated the worker prompt so duplicate facts should update old memory instead of creating another active memory.
  - Extended frontend polling so background memory tool cards do not stop refreshing while `memory_extract` or `memory_reconsolidate` is still running.
  - Verified with `bun test src/memory/extraction-worker.test.ts`, `bun test` (73 pass, 0 fail), `bun run typecheck`, `bun run lint`, and `cd web && bun run build`.
- Task 17 Global active-memory dedupe completed:
  - Updated the memory worker so new active-memory writes check both retrieved memories and the global active-memory list before calling `addMemory`.
  - Added a regression test for cross-session duplicate facts when related-memory search misses the existing active memory.
  - New memories saved earlier in the same worker run are added to the local duplicate set, preventing duplicate writes within one extraction plan.
  - Verified with `bun test src/memory/extraction-worker.test.ts`, `bun test` (74 pass, 0 fail), `bun run typecheck`, `bun run lint`, and `cd web && bun run build`.
- Task 18 Deterministic duplicate cleanup completed:
  - Added `src/memory/dedupe.ts` to mark normalized exact duplicate active memories inactive while keeping the best retained memory.
  - Added dry-run support so duplicate groups can be inspected before changing memory status.
  - Added `/api/memory/dedupe` and runtime event labels for `memory.dedupe.started`, `memory.dedupe.completed`, and `memory.dedupe.failed`.
  - Added `src/memory/dedupe.test.ts` covering exact duplicate cleanup and dry-run behavior.
- Task 19 Cross-type memory fragment dedupe completed:
  - Added `src/memory/duplicate.ts` as the shared duplicate detector for memory writes.
  - Updated the lifecycle memory worker to skip preference fragments already embedded in broader active facts.
  - Updated `memory_propose` to return the existing active memory instead of creating a duplicate when the user explicitly asks to remember the same preference.
  - Added regression tests for both worker extraction and direct memory tool writes.
  - Verified with targeted memory tests, `bun test` (77 pass, 0 fail), `bun run typecheck`, and `bun run lint`.

---

## Decision Log

### 2026-05-08: Long-term memory must be tool-based

Decision: Long-term memory is not injected directly into system prompt. Agent must call memory tools to search, read, propose, update, or forget memory.

Reason: This better matches the desired human-like recall model, improves observability, reduces prompt injection risk, and creates a clean boundary for multi-agent permissions.

### 2026-05-08: Build single Agent first

Decision: MVP implements only `default` agent, while all runtime data models include `agent_id`.

Reason: This keeps the first implementation small while avoiding a future schema rewrite for multi-agent support.

### 2026-05-08: Keep Web as debugging/control surface

Decision: Web UI remains the first channel and control panel, not the core product boundary.

Reason: The product target is an Agent runtime that can later connect to Web, WeChat, Feishu, CLI, or other channels.

### 2026-05-08: Keep session compatibility separate from channel mapping

Decision: Web conversation mapping is implemented in `src/channels/web-channel.ts`; `src/channels/session-api.ts` remains the legacy Web transcript compatibility layer.

Reason: This avoids mixing old Web session persistence with the new channel-neutral adapter boundary, while preserving current frontend history behavior.

### 2026-05-08: Runtime panel replaces duplicate sidebar control links

Decision: The sidebar no longer duplicates the top-right memory/config entry points. It now focuses on runtime observability: agent status, task queue, current task, and event history.

Reason: The Web UI is primarily a debug/control surface for the Agent runtime, and repeated memory/tool/permission/config controls were confusing before those configuration screens exist.

### 2026-05-08: Memory extraction runs through lifecycle hooks

Decision: Memory extraction is triggered by the backend `assistant.message.persisted` lifecycle hook, not by the frontend after chat completion.

Reason: This keeps memory behavior inside the runtime, makes future lifecycle hooks reusable, and lets the Web UI display memory work as persisted synthetic tool parts.

### 2026-05-08: Reconsolidation updates active memories in place

Decision: When a retrieved active memory conflicts with new user evidence, the memory worker updates the original active memory and preserves the change history in the memory text.

Reason: This matches the desired human-like memory model: recalled memories can be rewritten by new evidence without losing the fact that the preference or fact changed over time.

### 2026-05-09: Candidate memories are no longer part of the MVP path

Decision: `memory_propose` writes active memories directly, and the Web memory panel no longer displays candidate-memory counts.

Reason: The current product direction favors a simpler MVP rule: hook worker extraction and explicit memory write tools both produce active long-term memories. Existing old candidate rows may remain in storage, but new runtime flows should not create or surface them.

### 2026-05-09: Memory worker owns retrieval, dedupe, and reconsolidation

Decision: The memory worker now performs its own related-memory search after every assistant reply and merges those results with any `memory_search` calls made by the main Agent.

Reason: Reconsolidation should not depend on whether the main Agent remembered to search. The worker is responsible for finding related old memories, avoiding duplicate active memories, and updating recalled memories when new user evidence changes them.

### 2026-05-09: Exact duplicate cleanup is deterministic first

Decision: `memory.dedupe` only handles normalized exact duplicates for now, marking duplicates inactive and retaining the best memory by confidence, age, and usage.

Reason: Exact duplicate cleanup is safe enough for the current MVP. Approximate semantic merging, conflict summaries, and broader memory reorganization should wait for the future dream worker because they require model judgment and stronger audit UI.

### 2026-05-09: Memory write dedupe must work across memory types

Decision: New memory writes use shared duplicate detection that can treat a preference fragment embedded in a broader fact as already remembered.

Reason: The model may split one user statement into both a `fact` and a `preference`. Without cross-type fragment dedupe, the system avoids exact duplicate facts but still creates redundant preference memories.
