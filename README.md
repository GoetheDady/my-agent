# my-agent

`my-agent` 是一个本地优先的个人 Agent Runtime 实验项目。它把聊天、任务队列、工具调用、长期记忆、Agent 配置、Skill、多渠道接入和后台记忆整理放在同一个本地运行时里，目标是做一个可以通过 Web 工程控制台调试、也能逐步接入外部渠道的个人 Agent 系统。

专业术语说明：

- **Agent**：可以接收任务、调用模型和工具并产生结果的智能体。
- **Runtime**：运行时系统，负责把一次输入变成任务、模型调用、工具调用、事件和最终回复。
- **Tool**：暴露给 Agent 调用的能力外壳，例如读文件、写文件、查记忆、创建 Agent。工具外壳负责参数、权限和输出格式，业务规则放在 Service 中。
- **Service**：后端业务服务层，例如 `AgentConfigService`、`MemoryService`、`ChannelService`，负责真实状态变化和规则判断。
- **Lifecycle Hook**：生命周期钩子，也就是某个关键事件发生后异步触发的后台逻辑。例如助手消息保存后触发记忆提取。
- **Embedding**：把文本转换成向量的过程，用来做语义相似度搜索。
- **LanceDB**：本项目使用的本地向量数据库，负责存储和搜索长期记忆向量。
- **Dream Worker**：后台记忆整理器，用于每日摘要、去重、合并、冲突更新和整理记录生成。
- **Profile 文件**：稳定认知文件。`user.md` 记录 Agent 对用户的稳定认知，`soul.md` 记录 Agent 对自己的稳定认知。
- **WebSocket**：浏览器和后端之间的实时长连接。本项目用它推送“状态已变化”的通知，前端再通过 HTTP API 拉取最新数据。

## 快速启动

安装依赖：

```bash
bun install
cd web && bun install
```

后端开发模式：

```bash
bun run dev
```

前端开发模式：

```bash
cd web
bun run dev
```

生产模式先构建前端，再由后端托管 `web/dist`：

```bash
cd web && bun run build
cd ..
bun run start
```

常用验证命令：

```bash
bun test
bun run typecheck
bun run lint
bun run check
cd web && bun run build
```

## 配置

配置优先级是：环境变量 > `config.json` > 默认值。

常用环境变量：

- `DEEPSEEK_API_KEY`：DeepSeek 模型调用密钥，后端启动必须有。
- `ZHIPU_API_KEY`：智谱 `embedding-3` 调用密钥，用于记忆向量化。
- `PORT`：后端端口，默认 `3000`。
- `MY_AGENT_DATA_DIR`：运行时数据目录，默认是项目根目录下的 `data/`。
- `DREAM_SCHEDULER_ENABLED`：是否启用 Dream Worker 自动调度，设置为 `false` 可关闭。

`config.json` 可配置模型、模型 base URL、工具默认允许路径等。`base URL` 指模型 API 的基础请求地址。密钥可以写成 `$ENV_NAME` 形式，从环境变量读取。不要提交 `.env` 或包含真实密钥的 `config.json`。

## 顶层结构

```text
.
├── src/             # 后端 TypeScript 源码
├── web/             # React 工程控制台
├── data/            # 本地运行数据，默认生成，不应提交
├── docs/            # 设计、计划和验收文档
├── AGENTS.md        # 给 AI coding agent 的工作说明，优先级高于 CLAUDE.md
├── CLAUDE.md        # 更长的项目背景说明，其中部分旧流程已被 AGENTS.md 修正
├── package.json     # 后端脚本和依赖
├── bunfig.toml      # Bun 配置，当前设置 npm registry
└── bun.lock         # 后端依赖锁文件
```

运行时数据默认在 `data/` 下：

- `data/agents/<agentId>/agent.json`：某个 Agent 的统一配置，包含名称、模型、工具策略、Skill 元数据和渠道绑定。
- `data/agents/<agentId>/skills/*/SKILL.md`：Agent 本地 Skill 正文。Skill 的启停和元数据在 `agent.json` 中。
- `data/agents/<agentId>/soul.md`：Agent 对自己的稳定认知。
- `data/agents/<agentId>/user.md`：Agent 对用户的稳定认知。
- SQLite 和 LanceDB 数据也在运行时数据目录中生成。

不要把 `data/` 当成源码配置提交。它是用户使用系统后产生的本地状态。

## 后端架构

后端入口是 `src/main.ts`。启动时会初始化数据库、默认 Agent、工具注册、记忆生命周期 hook、Dream Scheduler、飞书 WebSocket 长连接和 Hono HTTP 路由。

主要目录：

- `src/core/`：配置、SQLite 初始化、Bun/Node 兼容运行时。
- `src/agents/`：Agent 创建、状态、注册表和 `agent.json` 配置管理。
- `src/runtime/`：Agent 执行编排，包括普通任务执行和内部任务执行。
- `src/tasks/`：任务表和队列。同一个 Agent 同一时间只跑一个任务。
- `src/events/`：运行时事件日志。事件用于审计和前端 Runtime / Events 页面展示。
- `src/tools/`：工具注册、工具集、权限策略、审批和文件工具执行。
- `src/memory/`：长期记忆、工作记忆、情景记忆、记忆提取、Dream Worker 和记忆工具。
- `src/profiles/`：`user.md` / `soul.md` 的读取、迁移和同步。
- `src/channels/`：Web、飞书、微信占位适配，以及外部用户和会话映射。
- `src/delegations/`：异步 Agent 委派。Agent A 可以把任务交给 Agent B，B 完成后创建回调任务让 A 整理结果。
- `src/realtime/`：浏览器 WebSocket 通知服务。
- `src/skills/`：Agent 本地 Skill 的创建、读取和启停。
- `src/prompts/`：系统提示词构建，包含 Agent 配置、Profile 和上下文。
- `src/routes/`：HTTP API 路由。

## 前端架构

前端在 `web/`，使用 React、React Router、Zustand、Tailwind CSS 4 和 Vite。

专业术语说明：

- **React Router**：前端路由库，根据 URL 切换页面。
- **Zustand**：轻量前端状态管理库，用来保存聊天、会话、记忆、运行时和 Agent 状态。
- **Tailwind CSS**：工具类 CSS 框架，通过类名直接组合样式。
- **Vite**：前端开发和构建工具，开发模式下会把 `/api` 代理到后端。

主要目录：

- `web/src/App.tsx`：路由树。
- `web/src/layouts/AppShell.tsx`：工程控制台外壳和导航。
- `web/src/pages/`：页面级组件，包括聊天、记忆、Profile、Agent、渠道、工具、Skill、任务、事件、架构和设置。
- `web/src/features/`：业务组件，例如聊天消息、工具审批卡、记忆面板、运行时摘要、会话侧栏。
- `web/src/store/`：Zustand store，例如 `chatStore`、`sessionStore`、`memoryStore`、`runtimeStore`、`agentStore`、`realtimeStore`。
- `web/src/lib/`：前端工具函数，例如 session 路由、session 解析、tool part 解析。
- `web/src/styles/globals.css`：Tailwind CSS 4 主题和全局样式。

当前主要页面：

- `/`：新聊天入口。
- `/sessions/:sessionId`：已持久化会话。
- `/memory`：长期记忆、情景记忆、Dream Worker 和整理记录。
- `/profiles`：`user.md` / `soul.md` 相关信息。
- `/agents`：Agent 状态和管理入口。
- `/channels`：Web / 飞书 / 微信渠道状态，飞书支持扫码创建、手动绑定、启停和删除绑定。
- `/tools`：工具集、审批策略、路径白名单和审批记录。
- `/skills`：Agent 本地 Skill 管理。
- `/tasks`：任务队列和执行历史。
- `/events`：运行时事件。
- `/architecture`：系统架构和执行流程说明。
- `/settings`：设置入口。

## 核心数据流

Web 聊天主链路：

1. 前端 `ChatPage` 确保 session 已创建，再调用聊天 API。
2. `src/routes/chat.ts` 保存用户消息并创建 task。
3. `src/tasks/task-queue.ts` 按 Agent 串行领取任务。
4. `src/runtime/agent-runtime.ts` 读取最新 Agent 配置，构建 prompt，调用模型，并通过工具系统执行工具。
5. 工具调用如果需要审批，会写入 `tool_approvals` 并由前端展示审批卡。
6. 助手消息保存到 `messages` 表。
7. `routes/chat.ts` 触发 `assistant.message.persisted` lifecycle hook。
8. `src/memory/lifecycle-hooks.ts` 异步启动 `MemoryExtractionWorker`。
9. Worker 提取记忆，向消息内容注入合成的 `memory_extract` / `memory_reconsolidate` tool part，并执行去重。
10. 前端通过轮询和 WebSocket 通知刷新消息、任务、事件和记忆状态。

外部渠道主链路：

1. 渠道适配器接收外部消息，例如飞书长连接事件。
2. `ChannelService` 负责身份映射、conversation 映射、task 创建和事件写入。
3. 后续执行仍进入统一 task queue 和 Agent Runtime。
4. 渠道适配器只负责渠道协议和出站发送，不直接创建任务。

异步委派主链路：

1. 父 Agent 创建 delegation。
2. 系统为子 Agent 创建 `delegation` channel 的 child task。
3. 子 Agent 独立执行并写回 delegation 结果。
4. 系统为父 Agent 创建 `delegation_callback` task。
5. 父 Agent 把子 Agent 结果整理成用户可读回复。

## Agent 配置

每个 Agent 有独立目录：

```text
data/agents/<agentId>/
├── agent.json
├── soul.md
├── user.md
└── skills/
```

`AgentConfigService` 是 `agent.json` 的唯一业务写入口。不要新增绕过它的直接写文件逻辑。工具里的 `agent_config_patch` 支持对工具数组、Skill 元数据和渠道绑定做精确 add/remove，优先使用 patch，而不是替换整个配置。

`temperature` 暂时不属于 MVP 配置。`temperature` 指模型采样随机性，值越高输出通常越发散；当前项目刻意不把它暴露为 Agent 配置项。

## 工具系统

工具通过 `registerTool({ name, tool, toolset, category })` 注册，并由 `buildAgentTools(context)` 根据 Agent 配置构建。

当前工具集：

- `memory`：长期记忆搜索、获取、更新、忘记、召回、证据、主动记住、计划和反思。
- `file`：项目内文件搜索、读取和写入。
- `skill`：Skill 列表、查看、创建、启用、禁用。
- `agent_config`：Agent 列表、读取、创建、配置读取、局部更新和重置。
- `runtime`、`core`：预留工具集。

权限规则：

- 只读工具默认允许。
- 写工具通常需要审批。
- `write_file` 只能写允许路径，并且不能直接修改 `data/agents/<agentId>/agent.json`。
- 工具审批写入 `tool_approvals`，同时产生 `tool.approval.*` 事件。
- 旧 `/api/tools/whitelist` 只是兼容入口，最终仍更新目标 Agent 的 `agent.json`，不再写全局 `config.json`。

## 记忆系统

记忆系统包含长期记忆、工作记忆、情景记忆、整理决策和 Dream Worker。

专业术语说明：

- **长期记忆**：跨任务保存的稳定事实、偏好、计划、证据和经验。
- **工作记忆**：task 级临时状态，不会跨任务自动复用。
- **情景记忆**：一次任务或对话的经历摘要，用于回答“刚才做过什么”。
- **Hybrid Search**：混合搜索，同时使用向量相似度和文本匹配，提高召回质量。
- **Deduplication**：去重，把语义相近的记忆合并或停用重复项。

当前实现要点：

- 长期记忆使用 LanceDB 和智谱 `embedding-3`，向量维度为 2048。
- 记忆搜索结合向量相似度和 TF-IDF 文本打分。TF-IDF 是一种按词频和区分度计算文本相关性的传统检索方法。
- 主动写长期记忆走 `memory_remember` / `memory.remember`。
- 助手消息保存后由 lifecycle hook 后台触发记忆提取，不再由前端直接调用 `/api/memory/extract`。
- Worker 会把 `memory_extract` / `memory_reconsolidate` 合成工具卡写回消息内容，前端轮询展示。
- `MemoryService` 统一处理写入、更新、强化、去重、事件和 Profile 同步。
- Dream Worker 可做 dry-run 或 real-run。`dry-run` 指只预览将要发生的整理，不真正写入状态。

## 渠道系统

`ChannelService` 是外部渠道进入 Runtime 的统一入口。它负责：

- 外部用户到内部 `user_id` 的 identity 映射。
- 外部会话到内部 conversation 的映射。
- task 创建。
- 用户、任务和渠道事件写入。

当前渠道：

- Web：主要由前端 HTTP API 和 WebSocket 通知驱动。
- 飞书：使用 WebSocket 长连接 MVP，不要求公网回调 URL。飞书 app 绑定保存在目标 Agent 的 `agent.json` 的 `channels.feishu.bindings` 中。
- 微信：目前是占位适配器，暂未接真实 SDK。

飞书扫码创建机器人由 `FeishuOnboardingService` 负责：生成二维码 URL、轮询飞书注册结果、通过 `FeishuBindingService` 写入绑定，并且 API 不返回原始 app secret。

## 数据库

数据库使用 Bun SQLite，启用 WAL 和外键。

主要表：

- `sessions`、`messages`：Web 会话和消息。
- `agents`：Agent 运行状态。
- `tasks`：任务队列。
- `events`：运行时事件。
- `tool_approvals`：工具审批和审计。
- `delegations`：异步 Agent 委派记录。
- `working_memory`：task 级短期状态。
- `conversations`、`channel_identities`：渠道会话和用户映射。
- `episodes`：情景记忆。
- `dream_runs`、`memory_decisions`：Dream Worker 运行和整理决策。

测试里通常使用 `new Database(":memory:")`、`initializeDatabaseSchema(db)` 和 `ensureDefaultAgent(db)`。多数 store/service 函数支持传入可选 `database` 参数，这种模式叫 **DI**，也就是依赖注入：测试时传入内存数据库，生产时使用默认数据库。

## 测试约定

- 使用 Bun test runner，不使用 Vitest 或 Jest。
- 测试文件命名为 `*.test.ts`。
- 后端类型检查使用 `bun run typecheck`。
- 后端 lint 使用 `bun run lint`，当前只 lint `src/`。
- 前端类型检查在 `cd web && bun run build` 中执行。
- 需要 LanceDB 的测试使用真实文件型向量库；如果本机 LanceDB native binding 不可用，相关测试可能需要按测试内的 `skipIf` 条件跳过。

## 开发约定

- 优先参考 `AGENTS.md`，再参考 `CLAUDE.md`。
- 不要新增写入 `data/profiles/` 的逻辑；`user.md` 已经是 Agent 级文件，位于 `data/agents/<agentId>/user.md`。
- 不要新增直接写 `agent.json` 的业务路径；通过 `AgentConfigService` 或 `agent_config_patch`。
- 不要把长期记忆自动塞进 prompt；需要过去事实、证据、计划和偏好时通过记忆工具查询。
- 同一个 Agent 同时只执行一个任务。
- Dream Worker 的整理行为必须可审计、可解释，且不能静默硬删除用户事实。
- 新增 runtime 数据文件时默认放在 `data/` 下，并确保不会被提交。

## 常见问题

如果后端启动时报缺少 `DEEPSEEK_API_KEY`，请在环境变量或 `config.json` 中配置模型密钥。

如果生产模式访问页面是 404，先执行：

```bash
cd web && bun run build
cd ..
bun run start
```

如果前端开发模式 API 请求失败，先启动后端，再启动前端。Vite 开发服务器会把 `/api` 代理到 `http://localhost:3000`。

如果记忆搜索不可用，检查 `ZHIPU_API_KEY` 和 LanceDB native binding。`native binding` 指依赖包中与本机系统绑定的二进制组件。
