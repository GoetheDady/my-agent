# AGENTS.md

Compact instruction file for AI agents working in this repository.

## 新对话快速上下文

如果需要快速理解项目，先读 `docs/project-overview.md`（含快速上手和开发边界）。本文件是 AI coding agent 的优先工作指令。

项目初心：

- `my-agent` 最早是一个个人 Agent 项目，不是一个通用多 Agent 平台。
- 记忆系统刻意类比人类记忆：长期记忆、稳定自我认知、用户理解、任务经历，以及后续整理。
- 多 Agent 能力是后来加入的，主要服务于角色分工和上下文边界。
- 单个 Agent 应该像人一样工作：同一时间只处理一个 Task；需要并行推进时，用多个 Agent 分工。
- 后端 Runtime 是项目核心形态。Web 是工程控制台，不是架构中心。

重要术语：

- **Agent**：智能体。这里指拥有配置、记忆、Skill、工具策略和运行状态的执行主体。
- **Runtime**：运行时。这里指调度任务、调用模型和工具、写事件、恢复卡住任务的后端系统。
- **Task**：任务。最小执行单元，Web 消息、渠道消息、委派请求都应该变成 Task。
- **Event**：事件。运行时审计记录，用于观察、恢复和调试。
- **Agent-scoped**：按 Agent 隔离。数据属于某个 Agent，例如 `.my-agent/agents/<agentId>/agent.json`、`soul.md`、`user.md`、skills 和渠道绑定。

## Codex Hooks 与文档同步规则

本仓库使用 `.codex/hooks.json` 配置 Codex Stop hook。**Hook** 是 Codex 生命周期脚本；**Stop hook** 是 Codex 准备结束本轮回复前触发的脚本，用来做最后校验。

当前 hook 脚本是 `.codex/hooks/ensure_module_docs.py`，它会检查本轮未提交改动：

- 如果修改了已映射模块的代码，需要同步更新对应 `docs/modules/m*.md` 模块文档。
- 如果修改了已映射模块的代码，需要同步更新 `docs/project-module-map.md`。
- 当前已有 M3 文档：`docs/modules/m3-task-system.md`。后续第一次改其他核心模块时，也应该补齐对应模块文档。

模块文档要记录：模块职责、当前状态、改动影响和下一步。`docs/project-module-map.md` 要保持整体模块状态、链接和优先级最新。

## 当前关键更正

**记忆提取流程 (Memory Extraction Flow) 以后端触发为准。** 旧流程是 frontend-triggered，也就是前端在每条消息后调用 `/api/memory/extract`。当前实际流程是：

1. Backend `src/routes/chat.ts` emits `assistant.message.persisted` lifecycle hook after saving the assistant message.
2. `src/memory/lifecycle-hooks.ts` listens for this hook and enqueues `MemoryExtractionWorker`.
3. Worker extracts memories, injects synthetic `memory_extract`/`memory_reconsolidate` tool parts into the message content, and runs deduplication.
4. Frontend `pages/ChatPage.tsx` polls for new tool parts via `startWorkerMessagePolling` (no longer calls `triggerMemoryExtract`).
5. `chatStore` no longer has `memoryStatusMap` or `triggerMemoryExtract` — these were removed.

## 当前架构补充

### Lifecycle Hooks (`src/lifecycle/hooks.ts`)
- Publish/subscribe system: `registerLifecycleHook(type, handler)` / `emitLifecycleHook(event)`.
- Currently one hook type: `assistant.message.persisted`.
- Handlers fire asynchronously (via `Promise.resolve().then()`), errors are caught and logged.
- Registered in `main.ts` via `registerMemoryLifecycleHooks()`.

### Agent System (`src/agents/`, `src/runtime/`)
- `ensureDefaultAgent()` still creates the fallback `default` Agent on startup.
- `AgentService` can create/list/read/update additional Agents without schema changes.
- Each Agent has independent `.my-agent/agents/<agentId>/agent.json`, `.my-agent/agents/<agentId>/skills/`, `.my-agent/agents/<agentId>/soul.md`, and `.my-agent/agents/<agentId>/user.md`.
- `user.md` is now agent-scoped and lives next to `soul.md`; do not add new writers under `.my-agent/profiles/`.
- Agent states: `idle` | `running` | `paused` | `error`.
- `src/runtime/agent-runtime.ts` `runAgentTask()` orchestrates: mark task running → build system prompt → build tools → `streamText` → mark complete/fail.
- Has 45s model timeout + abort signal handling. Uses `failTaskOnce` guard to prevent double-completion.
- `AgentConfigService` owns `.my-agent/agents/<agentId>/agent.json`: agent name, description, model, tool policy, memory switches, skill metadata, and agent-scoped channel bindings.
- Runtime reads the latest Agent config before each run. Do not add new direct writers for `agent.json`.
- `temperature` is intentionally not part of MVP config.
- `agent_config_patch` supports precise add/remove operations for tool arrays and skill metadata; prefer those over replacing whole arrays when possible.
- Agent tools now include `agent_list`, `agent_get`, and `agent_create`; they belong to the `agent_config` toolset.

### Skill System (`src/skills/`)
- `SKILL.md` stores skill body only.
- Skill metadata and enabled/disabled status live in the same `agent.json` managed by `AgentConfigService`.
- `SkillService` creates/reads skill content, but uses `AgentConfigService` for skill metadata changes.
- Legacy `skills.json` is migration-only and should not be used as a new config source.

### Task System (`src/tasks/`)
- Task lifecycle: `queued` → `running` → `completed` | `failed` | `canceled`.
- Tasks are created with `createTask()` and dispatched via `task-queue.ts`.
- Task queue processes tasks one at a time per agent.

### Channel System (`src/channels/`)
- `ChannelService` owns incoming channel messages: identity mapping, conversation mapping, task creation, and user/task events.
- Adapters only handle channel-specific delivery or protocol details; they must not create tasks directly.
- Web sessions remain frontend display state. Runtime context uses `conversations`, `tasks`, and `events`.
- Feishu uses a WebSocket long connection MVP. Its app binding lives in the target Agent's `agent.json` under `channels.feishu.bindings`; do not add new writers for `.my-agent/channels/feishu-bindings.json`.
- Feishu scan-to-create onboarding lives in `FeishuOnboardingService`: it generates a QR URL, polls Feishu's registration endpoint, writes the resulting binding through `FeishuBindingService`, and never returns raw app secrets from APIs.
- WeChat adapter is still a stub for now.

### Event System (`src/events/`)
- `appendEvent()` writes typed runtime events to SQLite.
- Event types include: `task.*`, `tool.*`, `memory.search`, `memory.remember`, `memory.update`, `memory.extract.*`, `memory.reconsolidate.*`, `memory.dedupe.*`.
- Events are exposed via `GET /api/runtime/events?agentId=default`.

### Tool System (`src/tools/`)
- Tools registered via `registerTool({ name, tool, toolset, category })`.
- `src/tools/service.ts` is the tools facade: list tools, build agent tools, evaluate policy, and expose execution helpers.
- `buildAgentTools(context: MemoryToolContext)` builds context-aware tools and passes task/agent info to memory tools.
- Policy: read-only tools allowed by default. Write tools need approval unless a concrete path is allowlisted. Memory write tools write active memories directly (no more "candidate" pattern).
- `ApprovalService` persists tool approvals in `tool_approvals` and emits `tool.approval.*` events. It records the audit trail only; ChatPage still calls `addToolApprovalResponse()` so the AI SDK can continue or stop the tool call.
- Tool policy is Agent-scoped. `enabledToolsets`, `requiresApproval`, and `allowedPaths` are read from `.my-agent/agents/<agentId>/agent.json` through `AgentConfigService`.
- `isInputPathAllowlisted` controls which file paths `write_file` can target without another approval.
- `write_file` must not modify `.my-agent/agents/<agentId>/agent.json`; use `agent_config_patch` instead.
- Legacy `/api/tools/whitelist` must not write global `config.json`; it is only a compatibility route that creates and approves a tool approval, then updates the target Agent config.

### Memory System (`src/memory/`)
- LanceDB for vector storage. Zhipu AI embedding-3 model (2048 dims).
- Hybrid search: vector similarity + TF-IDF text matching.
- `MemoryExtractionWorker`: runs after assistant message persisted. Uses a planner (LLM call) to decide what memories to create/update, then applies them with deduplication.
- `dedupeActiveMemories()`: finds semantically similar active memories, keeps highest-confidence, marks others inactive. Supports dry-run.
- Memory tools now accept `MemoryToolContext` with `agentId`, `taskId`, `conversationId` for event context.

### Database Schema
Tables: `sessions`, `messages`, `agents`, `tasks`, `events`, `tool_approvals`, `working_memory`, `conversations`, `channel_identities`.
- WAL mode enabled, foreign keys enforced.
- All store functions accept optional `database: Database` parameter (DI pattern for testing).

## Commands

```bash
bun run dev          # backend hot reload
bun run start        # production (serves web/dist)
bun test             # all tests
bun test src/path    # specific test file
bun run lint         # eslint src/
bun run typecheck    # tsc --noEmit
bun run check        # lint + typecheck

cd web
bun run dev          # Vite dev server (proxies /api to :3100)
bun run build        # tsc -b && vite build → web/dist
```

## Testing Patterns

- **Bun test runner** (not Vitest/Jest). Test files: `*.test.ts`.
- **In-memory SQLite**: `new Database(":memory:")` + `db.run("PRAGMA foreign_keys = ON")` + `initializeDatabaseSchema(db)` + `ensureDefaultAgent(db)`.
- **LanceDB is NOT mocked** in tests. Tests that need LanceDB use the real file-based DB. If LanceDB native bindings are unavailable, those tests will fail — skip them with `test.skipIf(!lanceDbAvailable)`.
- **Common test fixtures**: `withRunnerDb()` (agent runtime tests), `createWorkerDb()` (extraction worker tests), `withMemoryToolDb()` (memory tool tests). Each sets up test DB with schema + default agent.
- **DI pattern**: All functions accept optional `database: Database`. Pass `:memory:` DB in tests, omit in production to use default.

## Frontend Conventions

- **React Router is enabled.** `App.tsx` owns the route tree, `layouts/AppShell.tsx` owns the engineering-console shell, and route pages live in `web/src/pages/`.
- **Frontend directory boundaries**: page-level route components go in `pages/`; shared layout goes in `layouts/`; feature-owned UI goes in `features/`; generic reusable UI goes in `components/common/`.
- **Session routing**: chat uses `/` for a new conversation entry and `/sessions/:sessionId` for persisted sessions. Use `getSessionPath()` for session URLs.
- **Zustand stores**: `chatStore` (sessionId, thinkingEnabled), `sessionStore` (session list CRUD), `memoryStore` (memory panel data), `runtimeStore` (agent status, task queue, events).
- **Session creation must happen before first message.** Frontend `sessionStore.createSession()` → backend returns sessionId → stored in `chatStore.sessionId`.
- **DB content format**: Messages stored as JSON string in `messages.content`. Use `parseDbContent(content, role)` to parse into typed blocks (text, reasoning, tool-*, memory_*).
- **Tailwind CSS 4** with `@tailwindcss/vite` plugin. No separate config file needed — config is in CSS via `@theme`.

## Gotchas

1. **Don't use `sessionId: null` in chat requests** — backend creates a new session, desyncing frontend state.
2. **Thinking mode is off by default.** Toggle via `chatStore.thinkingEnabled`.
3. **LanceDB empty table workaround**: On first run, a placeholder record is inserted then immediately deleted to bypass LanceDB's empty table limitation.
4. **Config priority**: env vars > config.json > defaults. `config.json` values with `$VAR` syntax are resolved from env.
5. **`bunfig.toml` sets npm registry to npmmirror.com** — packages resolve from Chinese mirror.
6. **Web build required for production**: Backend serves `web/dist`. Must run `cd web && bun run build` before `bun run start`.
7. **Vite dev proxy**: `web/vite.config.ts` proxies `/api` to `http://localhost:3100`. Start backend first, then frontend.
8. **ESLint ignores `web/`** — frontend has its own tsc check in build step (`web/tsconfig.json`).
9. **Runtime data lives under `.my-agent/` by default** — `agent.json`, `SKILL.md`, SQLite, LanceDB, and profile files are generated there. Do not commit generated runtime data.

## Code Style

- ESLint + typescript-eslint. Unused vars prefixed with `_` are allowed.
- Chinese comments, English code/variable names.
- Prefer Bun APIs (`Bun.sqlite`, `Bun.serve`) but maintain Node.js compatibility path (`src/core/runtime.ts`).
- Avoid deep abstraction. Keep code direct and readable.
