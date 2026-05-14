# 新对话快速上下文

这份文档给刚进入本项目的新 Agent 使用。目标是在几分钟内理解：这个项目为什么存在、核心架构是什么、改代码时哪些边界不能破坏。

完整说明见 [project-overview.md](./project-overview.md)。

## 1. 项目初心

`my-agent` 的初衷是开发一个属于自己的 Agent，而不是先做一个通用多 Agent 平台。

这个 Agent 应该尽量像人一样工作：

- 有长期记忆，能积累用户偏好、项目事实、任务经历和计划。
- 有稳定认知，能通过 `soul.md` 理解自己，通过 `user.md` 理解用户。
- 有 Skill，能把反复使用的工作方法沉淀成可复用能力。
- 有工具，但工具调用需要权限和审计。
- 一次专注处理一件事，而不是无限并发。

后来的多 Agent 能力，是在这个基础上扩展出来的。它的目的不是让一个 Agent 同时做很多事，而是让不同 Agent 承担不同角色、上下文和任务边界。

专业术语说明：

- **Agent**：智能体。这里指一个有配置、记忆、Skill、工具权限和运行状态的执行主体。
- **多 Agent**：多个智能体协作。这里主要用于角色分工，而不是替代单个 Agent 的深度工作能力。

## 2. 最重要的架构判断

本项目的核心是后端 Runtime，Web 只是工程控制台。

专业术语说明：

- **Runtime**：运行时。这里指后端里负责调度任务、调用模型、执行工具、写事件、恢复失败任务的系统。
- **工程控制台**：用来观察、调试和管理系统状态的界面，不是项目的核心业务形态。

当前架构的关键规则：

1. 所有输入最终都应该变成 Task。
2. 同一个 Agent 同一时间只运行一个 Task。
3. Task 的过程必须写 Event，方便审计和恢复。
4. Agent 配置必须通过 `AgentConfigService` 写，不能直接改 `agent.json`。
5. Agent 的 `soul.md`、`user.md`、Skill、渠道绑定都必须是 Agent-scoped。
6. `.my-agent/` 是运行时数据，不应该提交。

专业术语说明：

- **Task**：任务。Agent 的最小执行单元，Web 对话、飞书消息、委派请求最终都会落成 Task。
- **Event**：事件。系统运行日志，记录任务开始、工具调用、记忆写入、Skill 更新等事实。
- **Agent-scoped**：按 Agent 隔离。每个 Agent 有自己的配置和数据，不写到全局位置。

## 3. 当前项目能力

后端已经具备这些核心能力：

- 多会话聊天和消息持久化。
- 多 Agent 创建、读取、更新。
- 每个 Agent 单线程任务队列。
- Task 可靠性：重试、租约、卡死恢复、最大执行次数、幂等创建。
- 工具系统：文件、记忆、Skill、Agent 配置、审批。
- 长期记忆：向量检索、文本检索、写入、更新、遗忘、去重。
- Skill 系统：系统内置、Agent 自写、GitHub 远程安装和更新。
- 渠道系统：Web 可用，飞书 WebSocket MVP 可用，微信还是 stub。
- Gateway 命令：后台启动、停止、重启、状态查看。

专业术语说明：

- **租约（lease）**：运行中 Task 的有效期。执行器会续约；过期表示任务可能卡死或服务重启。
- **幂等（idempotency）**：同一个外部请求重复提交时，只产生一次效果。
- **stub**：占位实现。接口或模块存在，但功能还没真正完成。

## 4. 代码地图

常用目录：

```text
src/core/       # 配置、数据库、启动初始化
src/agents/     # Agent 服务和 agent.json 配置管理
src/runtime/    # Agent 执行 Task 的运行时
src/tasks/      # Task store、队列、重试、恢复
src/events/     # Runtime 事件审计
src/tools/      # Agent 可调用工具
src/memory/     # 长期记忆、抽取、去重、整理
src/skills/     # Skill 创建、读取、安装、更新
src/channels/   # Web/飞书/微信等外部渠道
src/routes/     # HTTP API
web/            # React 工程控制台
.my-agent/      # 本地运行时数据，不提交
skills/builtin/ # 系统内置 Skill
```

## 5. 开发时优先保护的边界

改后端时，优先保护这些边界：

- 不要把项目改成 Web-first；Web 只是控制台。
- 不要让同一个 Agent 并发执行多个 Task，除非明确重做调度模型。
- 不要绕过 `AgentConfigService` 写 `agent.json`。
- 不要让 Channel adapter 直接创建 Task；应该通过 `ChannelService`。
- 不要把远程 Skill 默认启用；远程 Skill 安装后默认 disabled。
- 不要提交 `.my-agent/` 里的运行时文件。

## 6. 新 Agent 进入项目时建议先读

1. 先读本文件，理解项目初心和边界。
2. 再读 [project-overview.md](./project-overview.md)，理解完整架构。
3. 如果要改具体模块，再读对应目录源码和测试。
4. 如果需要给后续新对话补充长期规则，优先更新 `AGENTS.md` 和本文档。
