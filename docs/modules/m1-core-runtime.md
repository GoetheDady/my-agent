# M1 Core Runtime

本文档记录 Core Runtime 的模块边界。以后修改 `src/core/`、`src/main.ts`、`src/scripts/` 时，需要同步更新本文档和 `docs/project-module-map.md`。

专业术语说明：

- **Core Runtime**：系统启动和基础设施层，负责配置、数据库、运行时目录和初始化。
- **Schema**：数据库表结构，包括字段、索引和约束。
- **兼容迁移**：老数据库启动时自动补齐新字段，不要求用户删库重建。

## 1. 模块定位

Core Runtime 负责让后端服务稳定启动，并保证本地运行时数据结构可用。

它应该负责：

- 读取配置和运行时目录。
- 初始化 SQLite。
- 用兼容迁移维护数据库 schema。
- 初始化默认 Agent。
- 注册启动时必须运行的后台流程。

它不应该负责：

- 执行 Task。
- 写 Agent 业务配置。
- 直接处理渠道协议。
- 生成长期记忆或 Skill。

## 2. 当前相关代码

```text
src/core/
src/main.ts
src/scripts/
```

## 3. 当前状态

当前 Core Runtime 已支持：

- `.my-agent/` 运行时数据目录。
- SQLite schema 初始化。
- `ensureColumn()` 兼容迁移。
- WAL 和外键约束。
- Gateway 相关脚本。
- 启动后注册后台调度器，包括梦整理调度器和 Task Watchdog 调度器。
- 启动时检查最近一次 SQLite 备份；超过 24 小时则异步创建一次新备份，不阻塞 HTTP 服务启动。
- 启动 HTTP 服务时注册 `/api/workbench` 路由，用于 Web Console 的本地 Git 分支控制面。

本轮开发工作台改动对 Core Runtime 的影响：

- `src/main.ts` 新增 `createWorkbenchRoutes()` 注册，路径为 `/api/workbench`。
- Workbench 路由只在项目根目录执行 Git 命令，不写入 Runtime 数据库，也不参与 Agent Task 执行链路。
- 这里的 **Git 控制面** 指后端提供给控制台的分支查看、diff、merge 和 discard 管理接口；它是开发辅助能力，不是 Agent Runtime 的数据面。

本轮 P0 数据备份改动对 Core Runtime 的影响：

- 新增 `src/core/backup.ts`，集中承载 SQLite 热备份、备份列表、旧备份清理和结构化 JSON 导出逻辑。这里的“热备份”指服务不中断时创建一致性数据库快照。
- `src/main.ts` 启动后会调用 `backupDatabaseIfStale()`，最近备份超过 24 小时时异步创建新备份。
- 当前备份只覆盖 SQLite；LanceDB 向量库和 Agent 文件目录仍需要后续统一编排。

本轮 M7 改动对 Core Runtime 的影响：

- SQLite schema 新增 `memory_extraction_retries` 表和按 `next_retry_at` / `attempt_count` 查询的索引，用于保存记忆提取失败后的持久化重试队列。
- `src/main.ts` 在梦整理调度器启动后注册 60 秒轮询，扫描到期的记忆提取重试记录。
- 这里的“持久化重试队列”指失败任务写入 SQLite，进程重启后仍能继续扫描和重试。
- `episodes` 表新增 task 派生字段：`task_status`、`attempt_count`、`failure_type`、`failure_stage`、`retriable`。
- `episodes` 表新增 `key_steps`，用于保存一次经历的关键步骤。
- 老数据库通过 `ensureColumn()` 自动补齐新字段，避免用户删库重建。
- Runtime 启动时会扫描终态 task，并为缺失或过期的 episode 做一次确定性补齐/刷新。
- 这些字段仍属于 Memory System 的业务语义；Core Runtime 只负责 schema 初始化和兼容迁移。

本轮 M3/M15 改动对 Core Runtime 的影响：

- `src/main.ts` 在 `initializeRuntime()` 和 `startDreamScheduler()` 后启动 `startTaskWatchdogScheduler()`。
- Watchdog 默认每 60 秒巡检一次异常 Task 和 Agent 状态。
- 启动时的 `recoverRunningTasks()` 仍保留在 Runtime 初始化流程；Watchdog 负责运行期间的持续巡检和审计事件写入。

本轮 M3 Task Plan / Dependency v1 改动对 Core Runtime 的影响：

- `tasks` 表新增 `parent_task_id` 和 `plan_step_id`，用于表达父子任务和任务步骤关联。
- 新增 `task_steps` 表，保存任务计划步骤、步骤状态和可选 child task 关联。
- 新增 `task_dependencies` 表，保存 task-level 依赖关系和依赖原因。
- 老数据库通过 `ensureColumn()` 自动补齐 `tasks` 新字段；新表通过 `CREATE TABLE IF NOT EXISTS` 平滑创建。
- Core Runtime 只负责 schema 初始化、兼容迁移和索引创建；计划、依赖校验、blocked 状态和事件审计仍属于 Task System。

本轮 P1 Skill candidate 表改动对 Core Runtime 的影响：

- SQLite schema 新增 `skill_candidates` 表和 `idx_skill_candidates_agent_status` 索引，用于保存正式 Skill 候选、审查状态和来源 episode。
- 该表的业务语义属于 Skill System；Core Runtime 只负责建表、外键和索引初始化。

## 4. 后续需要补齐

- 数据库 schema 版本号。
- 启动诊断报告。
- 运行时目录权限检查。
- 迁移失败时的中文错误说明。
- 后台调度器健康状态和最近运行时间展示。
- LanceDB 和 Agent 文件目录的统一备份/恢复编排；当前启动自动备份只覆盖 SQLite。
