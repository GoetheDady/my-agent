# AGENTS.md

Compact instruction file for AI agents working in this repository. See also `CLAUDE.md` for the full project overview.

## Corrections to CLAUDE.md

**记忆提取流程 (Memory Extraction Flow) is WRONG in CLAUDE.md.** The old flow was frontend-triggered (frontend calls `/api/memory/extract` after each message). The actual flow is now:

1. Backend `src/routes/chat.ts` emits `assistant.message.persisted` lifecycle hook after saving the assistant message.
2. `src/memory/lifecycle-hooks.ts` listens for this hook and enqueues `MemoryExtractionWorker`.
3. Worker extracts memories, injects synthetic `memory_extract`/`memory_reconsolidate` tool parts into the message content, and runs deduplication.
4. Frontend `pages/ChatPage.tsx` polls for new tool parts via `startWorkerMessagePolling` (no longer calls `triggerMemoryExtract`).
5. `chatStore` no longer has `memoryStatusMap` or `triggerMemoryExtract` — these were removed.

## Architecture: What CLAUDE.md Doesn't Cover

### Lifecycle Hooks (`src/lifecycle/hooks.ts`)
- Publish/subscribe system: `registerLifecycleHook(type, handler)` / `emitLifecycleHook(event)`.
- Currently one hook type: `assistant.message.persisted`.
- Handlers fire asynchronously (via `Promise.resolve().then()`), errors are caught and logged.
- Registered in `main.ts` via `registerMemoryLifecycleHooks()`.

### Agent System (`src/agents/`, `src/runtime/`)
- Single default agent (`id: "default"`) created by `ensureDefaultAgent()` on startup.
- Agent states: `idle` | `running` | `paused` | `error`.
- `src/runtime/agent-runtime.ts` `runAgentTask()` orchestrates: mark task running → build system prompt → build tools → `streamText` → mark complete/fail.
- Has 45s model timeout + abort signal handling. Uses `failTaskOnce` guard to prevent double-completion.

### Task System (`src/tasks/`)
- Task lifecycle: `queued` → `running` → `completed` | `failed` | `canceled`.
- Tasks are created with `createTask()` and dispatched via `task-queue.ts`.
- Task queue processes tasks one at a time per agent.

### Event System (`src/events/`)
- `appendEvent()` writes typed runtime events to SQLite.
- Event types include: `task.*`, `tool.*`, `memory.search`, `memory.remember`, `memory.update`, `memory.extract.*`, `memory.reconsolidate.*`, `memory.dedupe.*`.
- Events are exposed via `GET /api/runtime/events?agentId=default`.

### Tool System (`src/tools/`)
- Tools registered via `registerTool({ name, tool, toolset, category })`.
- `src/tools/service.ts` is the tools facade: list tools, build agent tools, evaluate policy, and expose execution helpers.
- `buildAgentTools(context: MemoryToolContext)` builds context-aware tools and passes task/agent info to memory tools.
- Policy: read-only tools allowed by default. Write tools need approval unless allowlisted. Memory write tools write active memories directly (no more "candidate" pattern).
- `isInputPathAllowlisted` controls which file paths write_file can target.

### Memory System (`src/memory/`)
- LanceDB for vector storage. Zhipu AI embedding-3 model (2048 dims).
- Hybrid search: vector similarity + TF-IDF text matching.
- `MemoryExtractionWorker`: runs after assistant message persisted. Uses a planner (LLM call) to decide what memories to create/update, then applies them with deduplication.
- `dedupeActiveMemories()`: finds semantically similar active memories, keeps highest-confidence, marks others inactive. Supports dry-run.
- Memory tools now accept `MemoryToolContext` with `agentId`, `taskId`, `conversationId` for event context.

### Database Schema
Tables: `sessions`, `messages`, `agents`, `tasks`, `events`, `working_memory`, `conversations`, `channel_identities`.
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
bun run dev          # Vite dev server (proxies /api to :3000)
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
7. **Vite dev proxy**: `web/vite.config.ts` proxies `/api` to `http://localhost:3000`. Start backend first, then frontend.
8. **ESLint ignores `web/`** — frontend has its own tsc check in build step (`web/tsconfig.json`).
9. **No `.env.example` or `README`** — setup requires `DEEPSEEK_API_KEY` and `ZHIPU_API_KEY` env vars.

## Code Style

- ESLint + typescript-eslint. Unused vars prefixed with `_` are allowed.
- Chinese comments, English code/variable names.
- Prefer Bun APIs (`Bun.sqlite`, `Bun.serve`) but maintain Node.js compatibility path (`src/core/runtime.ts`).
- Avoid deep abstraction. Keep code direct and readable.
