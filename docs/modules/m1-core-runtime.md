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

本轮 M7 改动对 Core Runtime 的影响：

- `episodes` 表新增 task 派生字段：`task_status`、`attempt_count`、`failure_type`、`failure_stage`、`retriable`。
- `episodes` 表新增 `key_steps`，用于保存一次经历的关键步骤。
- 老数据库通过 `ensureColumn()` 自动补齐新字段，避免用户删库重建。
- Runtime 启动时会扫描终态 task，并为缺失或过期的 episode 做一次确定性补齐/刷新。
- 这些字段仍属于 Memory System 的业务语义；Core Runtime 只负责 schema 初始化和兼容迁移。

## 4. 后续需要补齐

- 数据库 schema 版本号。
- 启动诊断报告。
- 运行时目录权限检查。
- 迁移失败时的中文错误说明。
