# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目上下文

`my-agent` 是本地优先的个人 AI Agent Runtime（Bun/TypeScript 后端 + React 控制台前端）。

- **后端 Runtime**：`src/` — Hono HTTP、Agent 调度、记忆系统、工具系统、任务队列
- **Web 控制台**：`web/` — React + Vite + Tailwind CSS 4，代理后端 `/api`
- **完整说明**：见 `docs/project-overview.md` 和 `AGENTS.md`

## 快速命令

```bash
bun run dev          # 后端热重载 (端口 3100)
bun run start        # 生产模式 (含 web/dist)
bun test             # 全部测试 (Bun test runner)
bun test src/path    # 指定测试文件
bun run lint         # ESLint
bun run typecheck    # tsc --noEmit
bun run check        # lint + typecheck

cd web
bun run dev          # Vite 开发 (代理 /api → :3100)
bun run build        # 构建到 web/dist
```

## 架构概览

### 后端核心流程

```
HTTP/Channel → TaskQueue → AgentRuntime → ModelAPI (Vercel AI SDK / DeepSeek)
                                ↓
                         ToolSystem / MemorySystem
```

- **`src/main.ts`**：启动入口，初始化运行时、注册 lifecycle hooks、启动调度器
- **`src/core/runtime.ts`**：初始化 SQLite + LanceDB、默认 Agent、全局工具注册
- **`src/runtime/agent-runtime.ts`**：单个 Task 的执行器（模型调用、工具循环、流式输出）
- **`src/tasks/`**：任务队列 + 状态机（`queued → running → completed | failed | canceled`）、watchdog 卡死恢复
- **`src/memory/`**：长期记忆提取（`extraction/`）、向量存储（LanceDB）、梦整理调度（`dream-scheduler.ts`）、情景记忆（`episode-store.ts`）
- **`src/channels/`**：Web / 飞书 / 微信适配器，统一经 `ChannelService` 创建 Task
- **`src/lifecycle/hooks.ts`**：发布/订阅事件总线（如 `assistant.message.persisted`）
- **`src/agents/config-service.ts`**：唯一合法的 `agent.json` 读写入口
- **`src/skills/`**：Skill 内容（`SKILL.md`）管理；元数据由 `AgentConfigService` 持有

### 记忆提取数据流

1. `src/routes/chat.ts` 保存助手消息后触发 `assistant.message.persisted` hook
2. `src/memory/lifecycle-hooks.ts` 监听并入队 `MemoryExtractionWorker`
3. Worker 提取、去重、注入合成工具部分
4. 前端轮询新工具部分（**不触发提取**，只消费结果）

### 前端状态管理

`web/src/store/` 下各 Zustand store 职责：

| Store | 管理内容 |
|---|---|
| `chatStore` | 当前 sessionId、thinkingEnabled |
| `sessionStore` | 会话列表 CRUD |
| `runtimeStore` | Agent 状态、任务队列、事件 |
| `memoryStore` | 记忆面板数据 |
| `realtimeStore` | WebSocket 连接状态 |

## 代码风格

- 中文注释，英文代码/变量名
- ESLint + typescript-eslint，`_` 前缀为允许的未使用变量
- 优先使用 Bun API，同时保持 Node.js 兼容路径
- 避免深层抽象，代码保持直接和可读

## 测试约定

- Bun test runner，测试文件：`*.test.ts`
- 内存 SQLite：`new Database(":memory:")` + DI 模式
- LanceDB 不 Mock，直接用文件数据库
- 通用测试 fixtures：`withRunnerDb()`、`createWorkerDb()`、`withMemoryToolDb()`

## 关键边界约束

- 不要跳过 Git hooks (`--no-verify`)
- 运行时数据在 `.my-agent/` 下，不要提交到 Git
- `agent.json` 只能通过 `AgentConfigService` 修改，不直接写入
- Channel adapter 不直接创建 Task，必须通过 `ChannelService`
- 远程 Skill 安装后默认 disabled，不自动启用
- 同一 Agent 不能并发执行多个 Task
- Web 前端不触发记忆提取（只轮询消费）
- Web 控制台是观察/调试界面，不是产品主界面
