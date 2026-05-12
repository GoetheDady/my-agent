# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

基于 Bun + Hono + Vercel AI SDK 的 AI Agent 系统，包含后端 API 和 React 前端。支持多会话对话、长期记忆存储与检索、Agent 任务调度、以及 DeepSeek 模型的 thinking 模式。

## Commands

```bash
# 后端
bun run dev          # 热重载开发
bun run start        # 生产运行（需先构建前端）
bun test             # 所有测试
bun test src/path    # 单个测试文件
bun run check        # lint + typecheck

# 前端
cd web
bun run dev          # Vite 开发服务器（代理 /api 到 :3000）
bun run build        # 构建到 web/dist
```

## Architecture

### Backend (`src/`)

**Runtime & Web**: Bun + Hono。运行时检测在 `src/core/runtime.ts`，路由在 `src/routes/`。

**Database**:
- SQLite (`data/agent.sqlite`)：会话、消息、Agent、任务、事件。WAL 模式，外键强制。
- LanceDB (`data/memories.lancedb`)：向量记忆存储，智谱 AI embedding-3（2048 dims）。
- Profile 文件默认在对应 Agent 目录下，例如 `data/agents/default/soul.md` 和 `data/agents/default/user.md`。可通过 `MY_AGENT_DATA_DIR` 改运行时数据根目录。

**Agent 系统** (`src/agents/`, `src/runtime/`):
- 启动时 `ensureDefaultAgent()` 创建兜底默认 Agent（`id: "default"`）。
- `AgentService` 支持创建、列出、读取和更新多个 Agent；本阶段只做独立运行，不做 delegation。
- 每个 Agent 有独立 `data/agents/<agentId>/agent.json`、`data/agents/<agentId>/skills/`、`data/agents/<agentId>/soul.md` 和 `data/agents/<agentId>/user.md`。
- `user.md` 也跟随 Agent 目录，不再放在 `data/profiles/users/`。
- `AgentConfigService` 负责 `data/agents/<agentId>/agent.json`，这是 Agent 名称、模型、工具策略、skill 元数据和 Agent 级渠道绑定的唯一配置源。
- `temperature` 不属于 Agent MVP 配置；模型配置只保留 provider 和 model。
- `runAgentTask()` 编排：标记运行 → 构建 system prompt → 构建工具集 → `streamText` → 标记完成/失败。
- Agent 状态：`idle | running | paused | error`。45s 模型超时 + abort 信号处理。
- Agent 工具包括 `agent_list`、`agent_get`、`agent_create`，用于让 Agent 查看和创建可用 Agent。

**任务系统** (`src/tasks/`):
- 生命周期：`queued → running → completed | failed | canceled`。
- 每个 Agent 的任务队列串行处理。

**渠道系统** (`src/channels/`):
- `ChannelService` 是 Web、未来微信/飞书/CLI/HTTP API 的统一入站服务。
- 入站流程：标准化 channel message → 映射 channel identity → 映射 conversation → 创建 task → 写 `task.created` / `user.message` 事件。
- Web 的 `sessions/messages` 仍是前端展示层；内部 runtime 使用 `conversations/tasks/events`。
- 飞书已接入 WebSocket 长连接 MVP，飞书 App 绑定保存在目标 Agent 的 `agent.json` 的 `channels.feishu.bindings`，不再使用独立 `feishu-bindings.json` 作为配置源。
- 微信目前只有 stub adapter，不接真实 SDK。

**生命周期钩子** (`src/lifecycle/hooks.ts`):
- `registerLifecycleHook(type, handler)` / `emitLifecycleHook(event)`。
- 当前唯一钩子类型：`assistant.message.persisted`。
- 处理器异步触发（`Promise.resolve().then()`），错误被捕获并记录。
- 在 `main.ts` 通过 `registerMemoryLifecycleHooks()` 注册。

**工具系统** (`src/tools/`):
- `registerTool({ name, tool, toolset, category })` 注册工具。
- `src/tools/service.ts` 是工具系统门面，统一提供工具列表、工具集构建、权限评估和执行包装。
- `buildAgentTools(context: MemoryToolContext)` 工厂函数，为记忆工具注入 `agentId/taskId/conversationId` 上下文。
- 只读工具默认允许，写工具需审批（除非加入白名单）。
- 通用文件工具不能写 `data/agents/<agentId>/agent.json`；修改 Agent 配置必须走 `agent_config_patch` 或 HTTP 配置接口。

**Skill 系统** (`src/skills/`):
- `SKILL.md` 只保存 skill 正文。
- skill 的名称、描述、工具范围和 enabled/disabled 状态统一保存在 `agent.json`。
- `SkillService` 负责 skill 文件和展示，但启停、索引元数据会委托给 `AgentConfigService`。

**记忆系统** (`src/memory/`):
- 混合检索：向量相似度 + TF-IDF 文本匹配。
- `MemoryExtractionWorker`：assistant 消息持久化后触发，使用 LLM planner 决定创建/更新哪些记忆，并去重。
- `dedupeActiveMemories()`：找语义相似的活跃记忆，保留置信度最高的，其余标记为 inactive。支持 dry-run。
- `src/memory/legacy/`：旧版提取/注入代码，保留兼容性。
- `src/memory/storage/`：LanceDB 表定义、搜索评分、类型。
- `src/memory/tools/`：召回意图识别、排序、序列化。
- `src/memory/dream/`：Dream 调度器，定期对记忆进行整合与反思。

**事件系统** (`src/events/`):
- `appendEvent()` 写入类型化运行时事件到 SQLite。
- 事件类型涵盖 `task.*`、`tool.*`、`memory.*`。
- 通过 `GET /api/runtime/events?agentId=default` 暴露。

### Frontend (`web/src/`)

**框架**: React 19 + Vite + TypeScript + Zustand + Tailwind CSS 4（配置在 CSS `@theme` 中，无独立配置文件）。

**路由**: React Router。`App.tsx` 拥有路由树，`layouts/AppShell.tsx` 是工程控制台 shell，页面在 `pages/`。
- `/`：新对话入口；`/sessions/:sessionId`：持久化会话。使用 `getSessionPath()` 生成 URL。

**目录边界**: 页面级路由组件 → `pages/`；共享布局 → `layouts/`；功能 UI → `features/`；通用 UI → `components/common/`。

**Zustand Stores** (`web/src/store/`):
- `chatStore`：sessionId、thinkingEnabled。
- `sessionStore`：会话列表 CRUD。
- `memoryStore`：记忆面板数据。
- `runtimeStore`：Agent 状态、任务队列、事件。

## Key Patterns

### 记忆提取流程（后端驱动）
1. 后端 `src/routes/chat.ts` 保存 assistant 消息后触发 `assistant.message.persisted` 钩子。
2. `src/memory/lifecycle-hooks.ts` 监听并入队 `MemoryExtractionWorker`。
3. Worker 提取记忆，将 `memory_extract`/`memory_reconsolidate` tool parts 注入消息内容，并去重。
4. 前端 `pages/ChatPage.tsx` 通过 `startWorkerMessagePolling` 轮询新 tool parts（不再调用 `/api/memory/extract`）。

### 消息内容格式
数据库 `messages.content` 存储 JSON 字符串。用 `parseDbContent(content, role)` 解析为类型化 blocks（text、reasoning、tool-*、memory_*）。

### 配置优先级
环境变量 > `config.json`（`$VAR` 语法从 env 解析）> 默认值。必需：`DEEPSEEK_API_KEY`、`ZHIPU_API_KEY`。

### 静态文件服务
`src/main.ts` 内联实现，非 `/api/*` 路由从 `web/dist` 读取，404 回退 `index.html`。

## Testing

Bun 内置测试运行器（非 Vitest/Jest），测试文件 `*.test.ts`。

**In-memory SQLite 模式**：
```ts
const db = new Database(":memory:");
db.run("PRAGMA foreign_keys = ON");
initializeDatabaseSchema(db);
ensureDefaultAgent(db);
```

**LanceDB 不 mock**：需要真实文件 DB。若 native bindings 不可用，用 `test.skipIf(!lanceDbAvailable)` 跳过。

常用测试 fixture：`withRunnerDb()`（agent runtime）、`createWorkerDb()`（extraction worker）、`withMemoryToolDb()`（memory tools）。

## Gotchas

1. **`sessionId: null`**：后端会创建新会话，导致前端状态脱同步。
2. **LanceDB 空表**：首次运行插入占位记录后立即删除（绕过空表限制）。
3. **`bunfig.toml` 使用 npmmirror.com**：包从中国镜像解析。
4. **ESLint 忽略 `web/`**：前端类型检查在 `bun run build` 的 `tsc -b` 步骤中完成。
5. **Thinking 模式默认关闭**：通过 `chatStore.thinkingEnabled` 切换。

## Code Style

- ESLint + typescript-eslint。未使用变量以 `_` 前缀允许。
- 注释用中文，代码和变量名用英文。
- 优先 Bun API（`Bun.sqlite`、`Bun.serve`），保持 Node.js 兼容路径。
- 避免过度抽象，保持代码直接可读。
