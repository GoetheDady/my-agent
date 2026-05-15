# CLAUDE.md

## 项目上下文

本项目 `my-agent` 是一个个人 AI Agent 项目（Bun/TypeScript 后端 + React 前端）。

- **后端 Runtime**：`src/` — Hono HTTP 服务、Agent 调度、记忆系统、工具系统、任务队列
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

## 代码风格

- 中文注释，英文代码/变量名
- ESLint + typescript-eslint，`_` 前缀为允许的未使用变量
- 优先使用 Bun API，同时保持 Node.js 兼容路径 (`src/core/runtime.ts`)
- 避免深层抽象，代码保持直接和可读

## 测试约定

- Bun test runner，测试文件：`*.test.ts`
- 内存 SQLite：`new Database(":memory:")` + DI 模式
- LanceDB 不 Mock，直接用文件数据库
- 通用测试 fixtures：`withRunnerDb()`、`createWorkerDb()`、`withMemoryToolDb()`

## 注意事项

- 不要跳过 Git hooks (`--no-verify`)
- 运行时数据在 `.my-agent/` 下，不要提交到 Git
- `agent.json` 只能通过 `AgentConfigService` 修改，不直接写入
- 任务生命周期：`queued` → `running` → `completed` | `failed` | `canceled`
- Web 前端已完成记忆提取的下游轮询流程，不要重新引入前端触发记忆提取的逻辑
