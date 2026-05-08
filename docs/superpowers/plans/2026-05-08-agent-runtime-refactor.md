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
- 重要信息要通过 `memory.propose` 或 `memory.update` 形成候选写入。

目标工具：

- `memory.search(query, scope?)`
- `memory.get(memoryId)`
- `memory.propose(content, reason, evidenceEventIds)`
- `memory.update(memoryId, patch, reason, evidenceEventIds)`
- `memory.forget(memoryId, reason)`

当前 `src/routes/chat.ts` 中的 `getPrefetchedMemories()` 直接注入，以及 `src/memory/memory.ts` 的 `injectMemories()`，在本重构中降级为过渡代码，最终从主 Agent loop 移除。

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

---

## Current Baseline

当前已经存在：

- `src/routes/chat.ts`: Web chat 入口，直接调用 `streamText`。
- `src/core/database.ts`: SQLite 初始化，包含 `sessions` 和 `messages`。
- `src/brain/tools.ts`: 当前工具定义。
- `src/brain/tool-executor.ts`: 工具执行逻辑。
- `src/memory/*`: LanceDB 记忆、抽取、预取、注入相关模块。
- `src/channels/session-api.ts`: Web session 存储 API。
- `web/src/*`: Web 调试 UI、消息历史、工具展示、记忆面板。

当前主要缺口：

- 没有 Agent Registry。
- 没有 Task Queue。
- 没有单线程 lock。
- 没有 Event Log。
- 没有 Working Memory。
- 没有 Channel Adapter 抽象。
- 没有 Tool Registry / Toolset / Tool Policy 分层。
- 记忆仍有 prompt injection 路径。

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
│   ├── memory-tools.ts
│   ├── working-memory.ts
│   ├── store.ts
│   ├── extract.ts
│   └── embedder.ts
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
- `memory.propose` creates a candidate memory, not active long-term memory.
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
- Memory write tools create candidates by default.

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
- memory candidates

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

## Deferred Work

These are important, but not required for the first Agent Runtime MVP:

- WeChat adapter.
- Feishu adapter.
- Multi-agent delegation.
- Cron and heartbeat.
- MCP server integration.
- Plugin marketplace.
- Sandboxed terminal backends.
- Long-running background memory consolidation job.
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
  - Extended `src/memory/store.ts` so `addMemory` can create candidate memories and memories can be marked inactive without hard deletion.
  - Added `src/memory/memory-tools.test.ts` covering suspicious memory filtering, get, candidate proposal, update evidence events, and inactive forget behavior.
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
  - Updated `web/src/components/MemoryPanel.tsx` to surface candidate-memory counts from memory stats.
  - Verified with `bun test web/src/store/runtimeStore.test.ts web/src/store/chatStore.test.ts web/src/lib/toolPart.test.ts`, `bun run build` from `web/`, and `bun run typecheck`.
- Task 13 Documentation and cleanup completed:
  - Added `docs/superpowers/specs/2026-05-08-agent-runtime-refactor-design.md` as the current MVP architecture source of truth.
  - Updated `docs/superpowers/specs/2026-05-05-agent-architecture-design.md` to mark early memory-injection assumptions as superseded by Memory-as-Tool.
  - Final verification passed with `bun test` (65 pass, 0 fail) and `bun run check`.

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
