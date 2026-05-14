# my-agent 项目完整说明

## 1. 项目定位

`my-agent` 是一个本地优先的个人 Agent Runtime 项目，并在这个基础上扩展出多 Agent 能力。

这个项目的初衷不是先做一个“多 Agent 平台”，而是先做一个属于自己的 Agent。它应该更像一个人：有长期记忆，有稳定认知，有可学习的 Skill，有可使用的工具，也有明确的工作节奏。后面引入多 Agent，是为了让不同 Agent 可以承担不同角色、不同上下文和不同任务边界，而不是把单个 Agent 改造成无限并发的机器。

它不是一个强绑定 Web 的聊天应用，而是一个以**后端运行时**为核心的 Agent 系统。Web 前端只是工程控制台，用来观察、调试和管理后端状态。项目的核心目标是让一个或多个 Agent 可以接收来自不同渠道的输入，把输入转换成可靠的 Task，通过模型和工具完成工作，并把过程沉淀为事件、记忆、配置和 Skill。

每个 Agent 默认按单线程方式工作：同一时间只处理一个 Task。这个设计不是性能限制，而是刻意模拟人的工作方式。人通常也不是同时认真处理多件复杂事情，而是在一个时间段专注完成一件事；如果要并行推进不同方向，应该通过多个 Agent 分工，而不是让同一个 Agent 同时执行多个任务。

专业术语说明：

- **Agent**：智能体。它有自己的配置、工具权限、Skill、记忆视角和运行状态，可以接收任务并调用模型与工具。
- **Runtime**：运行时。这里指负责调度 Agent、执行 Task、调用模型、处理工具、写入事件和恢复任务的后端系统。
- **Local-first**：本地优先。核心状态默认保存在本机 `.my-agent/` 目录中，而不是依赖远程 SaaS 平台。
- **单线程**：同一个执行主体同一时间只处理一个任务。这里指一个 Agent 同一时间只运行一个 Task，任务之间排队执行。
- **Task**：任务。Agent 的最小执行单元，所有 Web、飞书、委派等输入最终都会落成 Task。
- **Event**：事件。运行时审计日志，记录系统发生过什么，例如任务开始、工具调用、记忆写入、远程 Skill 更新。
- **Skill**：技能说明文件。通常是 `SKILL.md`，用于告诉 Agent 在某类任务中应该遵循什么流程和规则。
- **Tool**：工具。Agent 可以调用的能力接口，例如读文件、写文件、查记忆、创建 Skill、安装 Skill。
- **Memory**：记忆。系统长期保存的用户偏好、项目事实、任务经历和未来计划等信息。

一句话概括：

> `my-agent` 是一个以个人 Agent 为核心、记忆系统类比人类认知、可扩展到多 Agent 分工的本地后端运行时。

## 2. 当前能力概览

当前项目已经具备这些核心能力：

- 多会话聊天：支持 Web 会话、消息持久化和历史恢复。
- 多 Agent 基础：支持 default Agent，以及创建、读取、更新更多 Agent。
- 任务队列：所有 Agent 输入都会转成 Task，并按 Agent 串行执行。
- Task 可靠性：支持重试、租约、卡死恢复、最大执行次数、幂等创建和审计事件。
- 工具系统：支持文件、记忆、Skill、Agent 配置等工具，并有审批机制。
- 长期记忆：支持向量检索、文本检索、记忆写入、更新、遗忘、去重和整理。
- 情景记忆：完成的 Task 会形成 Episode，用于回答“做过什么”。
- Dream Worker：支持后台记忆整理、每日摘要、冲突合并和审计决策。
- Skill 系统：支持系统内置 Skill、Agent 自写 Skill、远程 GitHub Skill 安装和更新。
- 渠道系统：Web 已可用，飞书 WebSocket 长连接 MVP 已接入，微信目前是 stub。
- Agent 委派：Agent 可以把任务异步交给另一个 Agent，再由父 Agent 整理结果。
- Runtime API：支持查看 Agent、Task、事件、重试、取消等运行状态。
- Gateway 命令：支持用一行命令后台启动、停止、重启和查看服务状态。

## 3. 技术栈

后端：

- Bun：主要运行时和测试运行器。
- Hono：HTTP API 框架。
- Vercel AI SDK：模型调用、流式输出和工具调用协议。
- DeepSeek：当前默认模型提供方。
- SQLite：本地结构化数据库。
- LanceDB：本地向量数据库，用于长期记忆语义检索。
- Zhipu AI embedding-3：文本向量化模型。

前端：

- React：工程控制台 UI。
- React Router：前端路由。
- Zustand：前端状态管理。
- Tailwind CSS 4：样式系统。
- Vite：前端开发和构建工具。

专业术语说明：

- **SQLite**：轻量本地关系型数据库，适合存任务、事件、消息、配置索引等结构化数据。
- **LanceDB**：向量数据库，用于保存文本 embedding，并做语义相似度搜索。
- **Embedding**：把文本转换成数字向量，方便系统判断两段文本语义是否接近。
- **Streaming**：流式输出，模型生成一点内容就立刻发给前端，而不是等全部完成。
- **WAL**：SQLite 的 Write-Ahead Logging 模式，能提升读写并发稳定性。

## 4. 顶层目录

```text
.
├── src/                  # 后端源码
├── web/                  # React 工程控制台
├── .my-agent/            # 本地运行时数据，不应提交
├── docs/                 # 项目文档
├── skills/builtin/       # 系统内置 Skill，只读、随代码版本发布
├── AGENTS.md             # 给 AI coding agent 的工作约束
├── README.md             # 启动、配置和架构说明
├── package.json          # 后端脚本和依赖
├── bun.lock              # 依赖锁文件
└── web/package.json      # 前端脚本和依赖
```

运行时数据默认在 `.my-agent/`：

```text
.my-agent/
├── agent.sqlite                         # SQLite 数据库
├── agents/<agentId>/agent.json          # Agent 配置
├── agents/<agentId>/soul.md             # Agent 对自己的稳定认知
├── agents/<agentId>/user.md             # Agent 对用户的稳定认知
├── agents/<agentId>/skills/<skillId>/   # Agent 自写或远程安装的 Skill
├── memories.lancedb/                    # LanceDB 向量记忆库
├── runtime/                             # Gateway PID、状态和日志
└── tmp/                                 # 远程 Skill 下载等临时文件
```

`.my-agent/` 是运行时状态，不是源码配置。不要提交生成出来的 `.my-agent/` 内容。

## 5. 后端模块

### 5.1 Core

目录：`src/core/`

职责：

- 读取环境变量和配置。
- 初始化 SQLite schema。
- 提供全局数据库连接。
- 判断当前运行时是 Bun 还是 Node。
- 启动时初始化 default Agent。
- 启动时恢复租约过期的 running Task。

当前启动入口是 `src/main.ts`。它会初始化 runtime、注册记忆 lifecycle hook、启动 Dream Scheduler、启动飞书 WebSocket 服务，并注册所有 API 路由。

### 5.2 Agent

目录：`src/agents/`

Agent 是系统的执行主体。每个 Agent 有自己的：

- 名称和描述。
- 模型配置。
- 工具策略。
- Memory 开关。
- Skill 配置。
- 渠道绑定。
- `soul.md` 和 `user.md`。

核心约束：

- `AgentConfigService` 是 `agent.json` 的唯一业务写入口。
- 不应该直接用文件工具改 `.my-agent/agents/<agentId>/agent.json`。
- 修改 Agent 配置应走 `agent_config_patch` 或 HTTP 配置接口。

Agent 状态：

- `idle`：空闲。
- `running`：正在执行 Task。
- `paused`：暂停，预留状态。
- `error`：异常，预留状态。

### 5.3 Task

目录：`src/tasks/`

Task 是 Agent 的最小执行单元。

生命周期：

```text
queued -> running -> completed
                  -> failed
                  -> canceled
```

当前 Task 可靠性能力：

- **串行执行**：同一个 Agent 同一时间只能运行一个 Task。
- **attempt_count**：记录实际执行过几次。
- **max_attempts**：最大执行次数，默认 3。
- **lease_expires_at**：租约过期时间。
- **idempotency_key**：幂等键，用来避免重复外部消息创建重复 Task。
- **retryTask**：失败或租约过期的 Task 可以重新排队。
- **recoverRunningTasks**：服务启动时恢复租约过期的 running Task。
- **永久失败**：超过最大执行次数后标记为 failed，并写 `task.failed_permanently` 事件。

专业术语说明：

- **租约（lease）**：运行中 Task 的有效期。执行器会定期续租；如果租约过期，说明执行器可能卡死或服务重启。
- **幂等（idempotency）**：同一个请求重复提交时，只产生一次效果。例如同一条飞书消息重复投递，只创建一个 Task。

### 5.4 Runtime

目录：`src/runtime/`

Runtime 负责真正执行 Task。

主要执行器：

- `agent-runtime.ts`：Web 流式聊天任务执行器。
- `internal-runner.ts`：后台内部任务执行器，主要用于 delegation。
- `external-runner.ts` 位于 `src/channels/`，负责飞书等外部渠道完整执行后回发。

执行流程：

1. 检查 Task 是否可运行。
2. 领取 Task，并把 Agent 状态设为 running。
3. 设置 Task 租约。
4. 启动 20 秒一次的租约续约心跳。
5. 构建 system prompt。
6. 构建当前 Agent 可用工具集合。
7. 调用模型。
8. 写入 assistant delta、assistant message、tool event 等事件。
9. 完成、失败或取消时清理租约并释放 Agent。

### 5.5 Events

目录：`src/events/`

Event 是运行时审计日志。它不是聊天消息，也不是长期记忆，而是系统内部发生过什么的证据链。

事件例子：

- `task.started`
- `task.completed`
- `task.failed`
- `task.recovered`
- `task.retry_scheduled`
- `task.lease.renewed`
- `tool.call`
- `tool.result`
- `tool.approval.created`
- `memory.search`
- `memory.remember`
- `skill.installed`
- `skill.remote_updated`
- `channel.inbound.received`

事件用途：

- 前端 Runtime / Events 页面展示。
- 后台 Worker 构造证据链。
- 排查 Task、Tool、Memory、Channel、Skill 的问题。
- 后续做自动总结和审计。

### 5.6 Tools

目录：`src/tools/`

Tool 是 Agent 可以调用的能力外壳。

当前工具集：

- `file`：文件搜索、读取、写入。
- `memory`：记忆搜索、记住、更新、遗忘、证据查询、计划和反思。
- `skill`：Skill 列表、查看、创建、启用、禁用、远程安装、远程更新。
- `agent_config`：Agent 列表、读取、创建、委派、配置读取、配置 patch、配置重置。
- `runtime`：预留工具组。
- `core`：预留工具组。

工具权限策略：

- 只读工具默认允许。
- 写工具默认需要审批。
- `write_file` 可以通过 Agent 的 `allowedPaths` 放行具体路径。
- `skill_install` 和 `skill_update` 默认需要审批。
- 工具策略按 Agent 生效，配置来自 `agent.json`。

专业术语说明：

- **Approval**：审批。高风险工具调用前需要用户确认，系统会记录审批事件和审批结果。
- **Allowlist**：白名单。明确允许的路径或能力，命中后可以减少重复审批。

### 5.7 Skill

目录：`src/skills/` 和 `skills/builtin/`

Skill 系统现在分三类：

| 类型 | 存放位置 | 说明 |
| --- | --- | --- |
| `builtin` | `skills/builtin/<skillId>/SKILL.md` | 系统内置 Skill，随代码发布，只读 |
| `agent_created` | `.my-agent/agents/<agentId>/skills/<skillId>/SKILL.md` | Agent 自己写的 Skill |
| `remote_installed` | `.my-agent/agents/<agentId>/skills/<skillId>/SKILL.md` | 从 GitHub 安装的 Skill，可按远程来源更新 |

Skill 元数据保存在 `agent.json`，正文保存在 `SKILL.md`。

核心字段：

- `origin.type`：来源类型。
- `origin.url`：远程仓库地址，仅远程 Skill 有。
- `origin.branch`：远程分支。
- `origin.subdir`：仓库内 Skill 子目录。
- `origin.commit`：当前安装的远程 commit。
- `readonly`：是否只读，builtin 一律只读。

专业术语说明：

- **origin**：来源信息，描述 Skill 是内置、自写还是远程安装。
- **provenance**：来源证明，比 origin 更强调可审计性，例如 URL、commit、安装时间。
- **commit**：Git 仓库的一次提交 ID。远程 Skill 更新时会比较 commit 是否变化。

当前远程安装能力：

- 支持 GitHub 仓库 URL。
- 默认分支 `main`。
- 默认 `subdir` 为空。
- 安装后默认 disabled。
- 更新时按原 `origin.url + branch + subdir` 拉取。
- commit 未变化时返回 `changed: false`。
- commit 变化时覆盖本地 Skill 并更新 origin。

### 5.8 Memory

目录：`src/memory/`

Memory 是长期认知系统。

主要能力：

- 语义检索：通过 LanceDB 向量搜索。
- 文本检索：通过 TF-IDF 做关键词相关性。
- 混合排序：结合语义相似度和文本匹配。
- 主动记忆：Agent 可用工具写入记忆。
- 自动提取：assistant 消息保存后触发 MemoryExtractionWorker。
- 去重：相似记忆会保留更高置信度的一条。
- 情景记忆：完成 Task 后形成 Episode。
- Dream Worker：周期性整理、合并、反思、生成每日摘要。

记忆提取流程是后端驱动：

1. assistant 消息保存。
2. 触发 `assistant.message.persisted` lifecycle hook。
3. `MemoryExtractionWorker` 入队。
4. Worker 调用 planner 判断要创建或更新哪些记忆。
5. Worker 写入 memory 事件。
6. Worker 把合成 tool part 注入消息内容。
7. 前端轮询并展示这些 tool part。

### 5.9 Profiles

目录：`src/profiles/`

Profile 文件是稳定认知文件：

- `soul.md`：Agent 对自己的稳定认知，包括长期行为原则。
- `user.md`：Agent 对用户的稳定认知，包括用户偏好和项目背景。

这些文件位于每个 Agent 目录下：

```text
.my-agent/agents/<agentId>/soul.md
.my-agent/agents/<agentId>/user.md
```

不要再新增写入 `.my-agent/profiles/` 的逻辑。当前系统已经改为 Agent-scoped profile。

### 5.10 Channels

目录：`src/channels/`

Channel 是外部入口。

当前渠道：

- Web：通过前端控制台输入。
- Feishu：飞书 WebSocket 长连接 MVP。
- WeChat：目前是 stub adapter。

核心规则：

- `ChannelService` 负责入站消息标准化、身份映射、conversation 映射、Task 创建和事件写入。
- Adapter 只处理渠道协议和消息投递，不直接创建 Task。
- 飞书绑定保存在目标 Agent 的 `agent.json` 中。
- 飞书扫码创建机器人由 `FeishuOnboardingService` 处理，不向 API 返回明文 secret。

### 5.11 Delegations

目录：`src/delegations/`

Delegation 是 Agent 间异步委派。

例子：

> default Agent 把“分析代码结构”交给 researcher Agent，researcher 完成后，default Agent 再整理结果给用户。

流程：

1. 父 Agent 创建 delegation。
2. 系统创建子 Agent 的 child task。
3. 子 Agent 执行并保存结果。
4. 系统创建父 Agent 的 callback task。
5. 父 Agent 整理子任务结果并回复。

### 5.12 Realtime

目录：`src/realtime/`

Realtime 用 WebSocket 通知前端“状态发生变化”。

它不替代 HTTP API。前端收到通知后，通常再调用 HTTP API 拉取最新状态。

专业术语说明：

- **WebSocket**：浏览器和后端之间的长连接，适合推送实时状态变化。
- **Polling**：轮询。前端定期请求后端，用于确认 Worker 是否写入了新消息片段。

## 6. HTTP API

后端 API 统一挂在 `/api` 下。

主要路由：

- `/api/chat`：聊天和模型流式响应。
- `/api/sessions`：Web 会话和消息。
- `/api/agents`：Agent 列表、创建、配置读取和更新。
- `/api/channels`：渠道列表、飞书绑定和飞书 onboarding。
- `/api/delegations`：Agent 异步委派。
- `/api/memories` 和 `/api/memory`：记忆相关 API。
- `/api/tools`：工具列表、审批、工具策略和兼容白名单接口。
- `/api/skills`：Skill 列表、查看、创建、安装、更新、启用、禁用。
- `/api/runtime`：运行时 Agent、Task、Event 查询和控制。
- `/api/health`：健康检查。
- `/api/ws`：WebSocket 实时通知。

Runtime Task API 示例：

- `GET /api/runtime/tasks`
- `GET /api/runtime/tasks/:id`
- `GET /api/runtime/tasks/:id/events`
- `POST /api/runtime/tasks/:id/retry`
- `POST /api/runtime/tasks/:id/cancel`

Skill API 示例：

- `GET /api/skills`
- `GET /api/skills/index`
- `GET /api/skills/:skillId`
- `POST /api/skills`
- `POST /api/skills/install`
- `POST /api/skills/:skillId/update`
- `POST /api/skills/:skillId/enable`
- `POST /api/skills/:skillId/disable`

## 7. 数据库与持久化

SQLite 表包括：

- `sessions`：Web 会话。
- `messages`：Web 消息。
- `agents`：Agent 运行状态。
- `tasks`：Task 队列和执行历史。
- `events`：运行时事件。
- `tool_approvals`：工具审批记录。
- `working_memory`：Task 级短期工作记忆。
- `conversations`：内部 conversation 映射。
- `channel_identities`：外部渠道用户到内部用户的映射。

Task 表当前包含可靠性字段：

- `attempt_count`
- `max_attempts`
- `lease_expires_at`
- `idempotency_key`
- `canceled_at`

Skill 元数据不在 SQLite 中，而是在每个 Agent 的 `agent.json` 中。这样 Skill 跟 Agent 配置、工具策略、渠道绑定保持在同一个配置源。

长期记忆向量保存在 LanceDB 中；结构化事件、任务、消息和配置索引保存在 SQLite 或文件中。

## 8. 前端控制台

前端在 `web/`，定位是工程控制台。

它用于：

- 聊天和调试模型输出。
- 查看会话和历史消息。
- 查看长期记忆、情景记忆和 Dream Worker 状态。
- 管理 Agent。
- 管理渠道。
- 管理工具和审批。
- 管理 Skill。
- 查看 Task 队列。
- 查看运行时事件。
- 查看架构说明和设置。

主要目录：

- `web/src/pages/`：页面。
- `web/src/layouts/`：控制台布局。
- `web/src/features/`：业务组件。
- `web/src/store/`：Zustand 状态。
- `web/src/lib/`：工具函数。
- `web/src/components/common/`：通用 UI 组件。

前端不是核心业务边界。后端 Runtime、Task、Agent、Memory、Skill、Channel 才是项目主体。

## 9. 启动与运行

安装依赖：

```bash
bun install
cd web && bun install
```

后端开发：

```bash
bun run dev
```

Gateway 后台运行：

```bash
bun run gateway start
bun run gateway status
bun run gateway logs
bun run gateway restart
bun run gateway stop
```

专业术语说明：

- **Gateway**：这里不是独立业务服务，而是本地运行控制命令。它后台启动 `src/main.ts`，并管理 PID、日志和健康检查。
- **PID**：操作系统进程编号。Gateway 用 PID 找到正在运行的后端进程。

生产运行：

```bash
cd web && bun run build
cd ..
bun run start
```

默认端口：

```text
3100
```

健康检查：

```text
GET /api/health
```

## 10. 配置

配置优先级：

```text
环境变量 > config.json > 默认值
```

常见环境变量：

- `DEEPSEEK_API_KEY`：模型调用密钥。
- `ZHIPU_API_KEY`：embedding 调用密钥。
- `PORT`：后端端口，默认 3100。
- `MY_AGENT_DATA_DIR`：运行时数据目录。
- `DREAM_SCHEDULER_ENABLED`：是否启用 Dream Scheduler。

`config.json` 支持 `$ENV_NAME` 形式从环境变量读取 secret。

不要提交 `.env` 或包含真实密钥的配置文件。

## 11. 测试与质量

当前测试使用 Bun test runner。

常用命令：

```bash
bun test
bun run typecheck
bun run lint
bun run check
```

测试模式：

- SQLite 测试通常使用 `new Database(":memory:")`。
- LanceDB 测试使用真实文件 DB，native bindings 不可用时应跳过。
- 后端所有 store/service 函数尽量接受可选 `database` 参数，方便依赖注入测试。

专业术语说明：

- **DI（Dependency Injection）**：依赖注入。测试时把内存数据库传给函数，而不是让函数总是使用全局数据库。
- **Regression test**：回归测试。用于确认新改动没有破坏已有功能。

## 12. 当前架构原则

项目目前最重要的原则：

1. 后端 Runtime 是核心，Web 是控制台。
2. 项目先服务于“一个自己的 Agent”，再扩展到多 Agent 分工。
3. 单个 Agent 应该像人一样单线程工作，同一时间只认真处理一个 Task。
4. 所有输入最终都应该变成 Task。
5. Event 是可观察性和审计的统一基础。
6. Agent 配置只能通过 `AgentConfigService` 写。
7. Agent 的 `user.md`、`soul.md`、Skill 和渠道绑定都必须是 Agent-scoped。
8. Channel adapter 不直接创建 Task，Task 创建归 `ChannelService`。
9. 工具策略按 Agent 生效，不写全局工具白名单。
10. 远程 Skill 默认不信任，安装后默认 disabled。
11. `.my-agent/` 是运行时状态，不是源码。
12. 重构时优先保护行为和测试，再调整文件边界。

## 13. 当前边界和后续方向

当前仍然是本地单机优先架构：

- 还没有多进程分布式 Task claim。
- 还没有远程 Skill marketplace。
- 微信仍是 stub。
- 前端是工程控制台，不是最终产品化 UI。
- Memory、Task、Skill 已经可用，但后端模块还可以继续重构拆分。

建议后续方向：

1. 重构 Task 模块，把 store、lifecycle、lease、retry、recovery 分开。
2. 重构 Skill 模块，把 builtin registry、remote installer、markdown parser、file operations 分开。
3. 瘦身 `AgentConfigService`，拆出 defaults、normalize、patch、validation。
4. 抽出 Runtime runner 公共逻辑，统一处理 lease heartbeat、started/completed/failed 事件。
5. 给 Feishu 外部 message id 接入 `idempotency_key`，避免重复投递创建重复 Task。
6. 继续完善远程 Skill 安全策略和更新策略。

## 14. 项目一句话定义

`my-agent` 当前是一个本地优先、后端驱动、可多 Agent 扩展、可长期记忆、可工具审批、可 Skill 扩展、可多渠道接入的个人 Agent Runtime。
