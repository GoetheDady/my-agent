# my-agent

`my-agent` 是一个本地优先的个人 Agent 实验项目。当前目标是做一个类似 OpenClaw / Hermes Agent 的 Agent Runtime：既能通过 Web UI 调试，也能逐步支持记忆、工具调用、任务执行、Profile 文件、Dream Worker、多渠道接入和未来的多 Agent 协同。

专业术语说明：

- **Agent Runtime**：Agent 的运行时系统，负责接收任务、构建提示词、调用模型、执行工具、写入事件和更新状态。
- **Service**：后端内部业务服务层，负责规则和状态变化，例如 `MemoryService`、`AgentConfigService`。
- **Tool**：暴露给 Agent 调用的工具外壳，只负责参数结构、权限和输出格式，业务判断交给 Service。
- **Memory-as-Tool**：长期记忆不直接塞进提示词，而是通过记忆工具按需查询、写入和更新。
- **Lifecycle Hook**：生命周期钩子。某个关键事件发生后触发后台逻辑，例如助手消息保存后触发记忆提取。
- **Dream Worker**：后台记忆整理器，类似“睡觉时整理记忆”，用于总结、去重、合并和沉淀经验。
- **Profile 文件**：稳定认知文件。`user.md` 记录 Agent 对用户的稳定认知，`soul.md` 记录 Agent 对自己的稳定认知。

## 快速启动

后端开发模式：

```bash
bun run dev
```

生产模式：

```bash
cd web && bun run build
cd ..
bun run start
```

前端开发模式：

```bash
cd web
bun run dev
```

验证命令：

```bash
bun test
bun run typecheck
bun run lint
cd web && bun run build
```

## 环境变量

项目依赖以下环境变量或 `config.json` 配置：

- `DEEPSEEK_API_KEY`：DeepSeek 模型调用密钥。
- `ZHIPU_API_KEY`：智谱 Embedding 模型调用密钥。
- `PORT`：后端服务端口，默认通常为 `3000`，也可用 `PORT=3100 bun run dev`。
- `DREAM_SCHEDULER_ENABLED`：是否启用 Dream Worker 自动调度，设置为 `false` 可关闭。
- `MY_AGENT_DATA_DIR`：运行时数据根目录。默认是项目根目录下的 `data/`，里面放 SQLite、LanceDB 和 profile 文件。

注意：根目录 `.env` 是本地私有配置文件，不应该提交密钥内容。

## 顶层目录

```text
.
├── data/                # 本地运行数据，包含 SQLite、LanceDB、profile 文件
├── docs/                # 项目计划、设计文档和验收报告
├── src/                 # 后端 TypeScript 源码
├── web/                 # React 前端工程控制台
├── AGENTS.md            # 给 AI coding agent 的精简工作说明
├── CLAUDE.md            # 项目背景和旧版说明，部分内容已被 AGENTS.md 修正
├── package.json         # 后端依赖和脚本
├── tsconfig.json        # 后端 TypeScript 配置
├── eslint.config.js     # 后端 ESLint 配置
├── bunfig.toml          # Bun 配置
└── bun.lock             # 后端依赖锁文件
```

本地工具和临时目录：

- `.opencode/`：OpenCode 相关本地工具目录。
- `.sisyphus/`：本地任务续跑/工具状态目录。
- `data/profiles/`：运行时生成的 profile 文件目录，包含 Agent 的 `soul.md` 和用户的 `user.md`。
- `data/agents/<agentId>/agent.json`：某个 Agent 的统一配置文件，包含名称、模型、工具策略和 skill 元数据。
- `data/agents/<agentId>/skills/*/SKILL.md`：某个 Agent 的 skill 正文文件；启停状态不写在这里，而是写入同级 Agent 的 `agent.json`。
- `node_modules/`：后端依赖安装目录。
- `.git/`：Git 仓库数据目录。
- `.gitignore`：Git 忽略规则。
- `.env`：本地环境变量文件，包含私有密钥。

## 后端目录总览

```text
src/
├── agents/      # Agent 注册、类型和状态
├── channels/    # Web / 未来微信飞书等渠道适配
├── collab/      # 未来多 Agent 协作预留目录
├── core/        # 配置、数据库、运行时兼容层
├── events/      # Runtime 事件系统
├── guards/      # 未来安全边界和守卫逻辑预留目录
├── lifecycle/   # 生命周期 hook 总线
├── memory/      # MemoryService、记忆存储、提取和 Dream Worker
├── plugins/     # 未来插件系统预留目录
├── profiles/    # ProfileService，维护 user.md / soul.md
├── prompts/     # Agent prompt 构建
├── routes/      # HTTP API 路由
├── runtime/     # AgentRuntimeService，编排 Agent 执行
├── sessions/    # SessionService，会话和消息历史
├── tasks/       # 任务队列和任务状态
├── telemetry/   # 未来遥测预留目录
├── tools/       # Agent 工具外壳、注册、权限和工具集
└── main.ts      # 后端入口
```

## `src/main.ts`

- `src/main.ts`：后端入口文件。初始化数据库、默认 Agent、生命周期 hook、Dream Scheduler，并注册 Hono API 路由和静态前端资源。

## `src/core/`

- `src/core/config.ts`：读取配置。配置优先级是环境变量高于 `config.json`，再高于默认值。
- `src/core/database.ts`：SQLite 数据库初始化和 schema 定义。`schema` 指数据库表结构。
- `src/core/database.test.ts`：验证数据库 schema 和基础存储行为。
- `src/core/runtime.ts`：运行时兼容层，用于在 Bun / Node.js 风格 API 之间做隔离。

## `src/agents/`

- `src/agents/agent-types.ts`：Agent、Agent 状态和相关类型定义。
- `src/agents/agent-registry.ts`：Agent 注册表。负责创建、读取和更新默认 Agent。
- `src/agents/agent-registry.test.ts`：覆盖默认 Agent 创建和状态更新。
- `src/agents/config-types.ts`：Agent 配置类型。这里的配置指某个 Agent 怎么工作，不包含任务运行状态。
- `src/agents/config-service.ts`：AgentConfigService。统一读取、校验、局部更新、重置 `data/agents/<agentId>/agent.json`；数组字段支持 add/remove 这类细粒度 patch。
- `src/agents/config-service.test.ts`：覆盖默认配置创建、patch、reset、坏配置恢复和事件记录。
- `src/agents/config-tools.ts`：`agent_config_get`、`agent_config_patch`、`agent_config_reset` 工具外壳。

## `src/runtime/`

- `src/runtime/agent-runtime.ts`：Agent 执行编排层。负责任务领取、prompt 构建、模型调用、工具调用循环和任务收尾。
- `src/runtime/agent-runtime.test.ts`：覆盖 Agent 执行流程、任务状态和异常处理。

## `src/prompts/`

- `src/prompts/agent-prompt.ts`：构建系统提示词。会读取 `soul.md` / `user.md` 这类稳定认知文件。
- `src/prompts/agent-prompt.test.ts`：覆盖 prompt 构建和 profile 注入。

## `src/tools/`

Tool 是暴露给 Agent 调用的外壳；Service 才承载业务规则。工具层只负责 schema、权限、工具集和执行包装。

- `src/tools/registry.ts`：工具注册中心。统一记录工具名称、分类和元信息。
- `src/tools/registry.test.ts`：覆盖工具注册、查询和工具集构建。
- `src/tools/policy.ts`：工具权限策略。决定哪些工具可直接执行，哪些需要审批。
- `src/tools/policy.test.ts`：覆盖工具权限、路径白名单和 allowlist 规则。
- `src/tools/executor.ts`：文件工具执行和路径安全工具。
- `src/tools/executor.test.ts`：覆盖文件路径安全和 `agent.json` 写保护。
- `src/tools/builtin-tools.ts`：内置工具注册，包括文件工具和记忆工具外壳。
- `src/tools/toolsets.ts`：工具分组定义，例如 memory、file、runtime、core。
- `src/tools/service.ts`：工具系统门面。统一导出工具列表、工具集构建、权限评估和执行包装。

## `src/profiles/`

- `src/profiles/files.ts`：读取和更新 `data/profiles/agents/default/soul.md`、`data/profiles/users/default/user.md`。
- `src/profiles/files.test.ts`：覆盖 profile 文件读写和结构化 Markdown 更新。
- `src/profiles/classifier.ts`：判断一条记忆是否应该沉淀到 `user.md` 或 `soul.md`。
- `src/profiles/sync.ts`：profile 同步主流程。根据记忆类型和分类结果更新稳定认知文件，并写入事件。
- `src/profiles/sync.test.ts`：覆盖记忆写入后自动同步 profile 文件。

## `src/sessions/`

- `src/sessions/service.ts`：会话和消息存储服务，供 routes、workers 和工具审批流程调用。

## `src/channels/`

- `src/channels/service.ts`：ChannelService。统一把 Web、未来微信/飞书等外部消息转换成内部 identity、conversation、task 和 events。
- `src/channels/types.ts`：渠道输入、输出、adapter、identity 和 conversation 类型定义。
- `src/channels/identity-store.ts`：封装 `channel_identities` 表，维护外部用户到内部 userId 的映射。
- `src/channels/conversation-store.ts`：封装 `conversations` 表，维护外部会话到内部 conversation 的映射。
- `src/channels/web-channel.ts`：Web 渠道轻量适配器；Web 出站仍通过 HTTP stream 返回。
- `src/channels/feishu-channel.ts`、`src/channels/wechat-channel.ts`：飞书/微信占位适配器，MVP 暂不接真实 SDK。
- `src/channels/service.test.ts`：覆盖 ChannelService 入站、identity/conversation 复用、事件和 adapter 注册。
- `src/channels/message-parts.ts`：消息内容 part 的解析和序列化。`part` 指一条消息中的文本块、工具块、推理块等子结构。
- `src/channels/message-parts.test.ts`：覆盖消息 part 解析、工具卡解析和历史消息兼容。

## `src/events/`

- `src/events/event-types.ts`：Runtime 事件类型定义，例如任务、工具、记忆、Dream Worker、profile 同步事件。
- `src/events/event-log.ts`：事件写入和查询。Runtime 面板的数据来自这里。
- `src/events/event-log.test.ts`：覆盖事件追加、过滤和查询。

## `src/lifecycle/`

- `src/lifecycle/hooks.ts`：生命周期 hook 总线。支持注册和触发类似 `assistant.message.persisted` 的事件。

## `src/tasks/`

- `src/tasks/task-types.ts`：任务类型、状态和 payload 类型。
- `src/tasks/task-store.ts`：任务表读写逻辑。
- `src/tasks/task-queue.ts`：单 Agent 串行任务队列。确保同一个 Agent 同时只处理一个任务。
- `src/tasks/task-queue.test.ts`：覆盖任务排队、串行执行、失败和取消逻辑。

## `src/routes/`

- `src/routes/chat.ts`：聊天 API。接收用户消息、创建任务、保存助手回复并触发记忆生命周期 hook。
- `src/routes/chat.test.ts`：覆盖聊天请求、会话创建和消息持久化。
- `src/routes/memory.ts`：记忆 API。提供记忆列表、手动写入、Dream Worker dry-run / real-run、整理记录等接口。
- `src/routes/runtime.ts`：运行时 API。提供 Agent 状态、任务队列和事件流。
- `src/routes/runtime.test.ts`：覆盖 runtime 状态和事件接口。
- `src/routes/sessions.ts`：会话 API。提供会话列表、会话消息、创建和删除会话。
- `src/routes/tools.ts`：工具 API。提供工具白名单授权接口。
- `src/routes/agents.ts`：Agent 配置 API，提供读取、局部更新和重置 `agent.json` 的受控入口。
- `src/routes/agents.test.ts`：覆盖 Agent 配置 API。
- `src/routes/skills.ts`：Skill API。创建和启停 skill 时只写 `SKILL.md` 正文与 `agent.json` 元数据。
- `src/routes/skills.test.ts`：覆盖 Skill API。

## `src/memory/`

记忆系统是当前项目最核心的模块。它包含长期记忆、工作记忆、情景记忆、程序记忆、反思记忆、未来计划、Dream Worker 和 profile 同步触发。

- `src/memory/service.ts`：记忆服务层。`service layer` 指统一业务入口，负责记忆写入、查询、去重、强化、事件和 profile 同步。
- `src/memory/service.test.ts`：覆盖统一写入、重复复用、强化、更新和工具调用入口。
- `src/memory/store.ts`：记忆存储兼容导出，底层实现已拆到 `src/memory/storage/`。
- `src/memory/memory.ts`：旧路径兼容导出，主流程不应该新增依赖它。
- `src/memory/prefetch.ts`：旧路径兼容导出，用于过渡历史调用。
- `src/memory/extract.ts`：旧路径兼容导出，用于过渡历史调用。
- `src/memory/memory-tools.ts`：底层记忆工具实现，例如记忆搜索、获取、更新、忘记、主动记住。
- `src/memory/memory-tools.test.ts`：覆盖底层记忆工具行为。
- `src/memory/human-memory-tools.ts`：人类式记忆工具兼容入口，主实现已拆到 `src/memory/tools/`。
- `src/memory/human-memory-tools.test.ts`：覆盖 `memory_recall`、`memory_remember`、`memory_plan`、`memory_evidence` 等工具。
- `src/memory/working-memory.ts`：工作记忆。用于保存当前任务的临时状态。
- `src/memory/working-memory.test.ts`：覆盖工作记忆读写。
- `src/memory/embedder.ts`：Embedding 调用。`Embedding` 指把文本转换成向量，用于相似度搜索。
- `src/memory/dedupe.ts`：长期记忆去重逻辑。
- `src/memory/dedupe.test.ts`：覆盖重复记忆识别和停用行为。
- `src/memory/duplicate.ts`：重复判断工具函数。
- `src/memory/canonical.ts`：生成规范化记忆 key，用于把同义表达识别成同一事实。
- `src/memory/episode-store.ts`：情景记忆存储。情景记忆记录一次经历、任务或对话摘要。
- `src/memory/episode-store.test.ts`：覆盖 episode 创建、更新和查询。
- `src/memory/decision-store.ts`：记忆整理决策存储。决策记录 Agent 自动整理了什么、为什么整理、能否撤销。
- `src/memory/decision-store.test.ts`：覆盖 decision 创建、状态更新和撤销记录。
- `src/memory/review-store.ts`：旧 review item 存储兼容层。当前主流程已转向 memory decision。
- `src/memory/dream-run-store.ts`：Dream Worker 运行记录存储，避免同一天重复自动整理。
- `src/memory/dream-scheduler.ts`：Dream Worker 调度器。服务启动后按时间检查是否需要自动运行。
- `src/memory/dream-scheduler.test.ts`：覆盖每日调度、补跑和禁用逻辑。
- `src/memory/dream-worker.ts`：Dream Worker 兼容入口，主实现已拆到 `src/memory/dream/`。
- `src/memory/dream-worker.test.ts`：覆盖 Dream Worker dry-run、real-run、decision 和撤销。
- `src/memory/extraction-worker.ts`：记忆提取 Worker 兼容入口，主实现已拆到 `src/memory/extraction/`。
- `src/memory/extraction-worker.test.ts`：覆盖助手回复后后台提取、合成工具卡和再巩固。
- `src/memory/lifecycle-hooks.ts`：注册记忆相关生命周期 hook。当前监听 `assistant.message.persisted`。
- `src/memory/test-utils.ts`：记忆相关测试辅助工具。

### `src/memory/storage/`

- `src/memory/storage/types.ts`：记忆存储类型定义。
- `src/memory/storage/table.ts`：LanceDB 表初始化和底层表操作。
- `src/memory/storage/search-scoring.ts`：搜索结果排序和打分。结合向量相似度和文本匹配。
- `src/memory/storage/store.ts`：长期记忆 CRUD。`CRUD` 指 create、read、update、delete，也就是增删改查。

### `src/memory/extraction/`

- `src/memory/extraction/types.ts`：记忆提取 Worker 的输入、输出和计划类型。
- `src/memory/extraction/planner.ts`：调用模型分析本轮对话，决定要新增、更新或再巩固哪些记忆。
- `src/memory/extraction/safety.ts`：提取安全规则和再巩固判断，避免把助手建议误当成用户事实。
- `src/memory/extraction/tool-parts.ts`：把后台提取结果写回聊天消息里的合成工具卡。
- `src/memory/extraction/utils.ts`：提取 Worker 的辅助函数。
- `src/memory/extraction/worker.ts`：记忆提取 Worker 主流程。由生命周期 hook 异步触发。

### `src/memory/dream/`

- `src/memory/dream/types.ts`：Dream Worker 类型定义。
- `src/memory/dream/time.ts`：Dream Worker 日期、时区和调度时间计算。
- `src/memory/dream/summary.ts`：每日记忆摘要生成。
- `src/memory/dream/decisions.ts`：记忆整理决策生成和应用，例如确定性去重、语义合并、冲突更新。
- `src/memory/dream/worker.ts`：Dream Worker 编排器，串联 summary、decision、事件和运行记录。

### `src/memory/tools/`

- `src/memory/tools/recall-intent.ts`：识别回忆意图，例如偏好、经历、计划、做事方法、证据追问。
- `src/memory/tools/recall-ranking.ts`：按意图和置信度排序回忆结果。
- `src/memory/tools/serializers.ts`：把记忆对象序列化成工具输出。
- `src/memory/tools/human-memory-tools.ts`：人类式记忆工具主实现，包括 recall、remember、plan、evidence、reflect。

### `src/memory/legacy/`

- `src/memory/legacy/memory.ts`：旧记忆入口兼容文件。
- `src/memory/legacy/prefetch.ts`：旧 prompt 预取记忆兼容文件。
- `src/memory/legacy/extract.ts`：旧前端触发提取兼容文件。

## 预留后端目录

- `src/collab/.gitkeep`：多 Agent 协同目录占位。
- `src/guards/.gitkeep`：安全守卫目录占位。
- `src/plugins/.gitkeep`：插件系统目录占位。
- `src/scripts/`：一次性维护脚本目录，目前主流程没有依赖。
- `src/telemetry/.gitkeep`：遥测目录占位。

## 前端目录总览

```text
web/
├── src/
│   ├── components/  # 通用 UI 组件
│   ├── features/    # 业务模块组件
│   ├── layouts/     # 全局布局
│   ├── lib/         # 前端工具函数
│   ├── pages/       # React Router 页面
│   ├── store/       # Zustand 状态管理
│   ├── styles/      # 全局样式
│   └── types/       # 前端类型
├── index.html       # Vite HTML 入口
├── package.json     # 前端依赖和脚本
├── tsconfig.json    # 前端 TypeScript 配置
├── vite.config.ts   # Vite 配置和 API 代理
└── bun.lock         # 前端依赖锁文件
```

## `web/src/`

- `web/src/main.tsx`：React 前端入口。
- `web/src/App.tsx`：React Router 路由树。`React Router` 指前端按 URL 切换页面的路由库。
- `web/src/vite-env.d.ts`：Vite 类型声明。
- `web/src/types/index.ts`：前端共享类型定义。

## `web/src/layouts/`

- `web/src/layouts/AppShell.tsx`：工程控制台外壳。包含全局导航、顶部栏和页面容器。

## `web/src/pages/`

- `web/src/pages/ChatPage.tsx`：聊天页。负责会话路由、发送消息、展示消息和后台 worker 轮询。
- `web/src/pages/MemoryPage.tsx`：记忆页面。展示长期记忆、情景记忆、Dream Worker 和整理记录。
- `web/src/pages/ProfilesPage.tsx`：Profile 页面。展示 `user.md` / `soul.md` 的定位和同步入口。
- `web/src/pages/ArchitecturePage.tsx`：架构页面。用工程控制台方式展示系统架构和输入到回复流程。
- `web/src/pages/EventsPage.tsx`：事件页面。展示 runtime events。
- `web/src/pages/TasksPage.tsx`：任务页面。展示任务队列和执行历史。
- `web/src/pages/ToolsPage.tsx`：工具页面。展示工具分类、权限和可用状态。
- `web/src/pages/AgentsPage.tsx`：Agent 页面。展示默认 Agent 状态，并为多 Agent 预留。
- `web/src/pages/ChannelsPage.tsx`：渠道页面。展示 Web 渠道和未来微信/飞书入口。
- `web/src/pages/SettingsPage.tsx`：设置页面。为模型、记忆策略、工具权限和 Agent 配置预留。

## `web/src/features/`

### `web/src/features/chat/`

- `web/src/features/chat/ChatInput.tsx`：聊天输入框。
- `web/src/features/chat/MessageList.tsx`：消息列表。
- `web/src/features/chat/MessageBubble.tsx`：单条消息气泡，包含文本、推理内容、工具卡和记忆 Worker 卡片展示。
- `web/src/features/chat/MarkdownContent.tsx`：Markdown 渲染组件。
- `web/src/features/chat/ToolApprovalCard.tsx`：工具审批卡片，用于需要用户确认的工具调用。

### `web/src/features/memory/`

- `web/src/features/memory/MemoryPanel.tsx`：记忆面板。展示 active memory、episodes、dream runs、memory decisions 等内容。

### `web/src/features/runtime/`

- `web/src/features/runtime/RuntimeSummary.tsx`：运行时摘要组件，展示 Agent 状态、任务队列和事件概览。

### `web/src/features/sessions/`

- `web/src/features/sessions/SessionSidebar.tsx`：聊天页专属会话侧边栏。

### `web/src/features/architecture/`

- `web/src/features/architecture/ArchitectureView.tsx`：架构图和流程说明视图。

## `web/src/components/`

- `web/src/components/common/PageScaffold.tsx`：通用页面骨架，统一页面标题、描述和主体布局。

## `web/src/store/`

- `web/src/store/chatStore.ts`：聊天状态。保存当前 session、thinking 开关、发送消息和 worker 轮询。
- `web/src/store/chatStore.test.ts`：覆盖聊天 store 的状态变化和 session 行为。
- `web/src/store/sessionStore.ts`：会话列表状态。负责创建、加载、删除会话。
- `web/src/store/memoryStore.ts`：记忆页面状态。负责加载记忆、episodes、dream runs 和 decisions。
- `web/src/store/runtimeStore.ts`：运行时状态。负责加载 Agent 状态、任务和事件。
- `web/src/store/runtimeStore.test.ts`：覆盖 runtime store 的请求和状态更新。

## `web/src/lib/`

- `web/src/lib/sessionRoute.ts`：根据 session id 生成聊天 URL。
- `web/src/lib/sessionRoute.test.ts`：覆盖 session URL 生成规则。
- `web/src/lib/sessionResolver.ts`：从 URL 和状态中解析当前 session。
- `web/src/lib/sessionResolver.test.ts`：覆盖 session 解析逻辑。
- `web/src/lib/toolPart.ts`：解析和格式化工具 part。
- `web/src/lib/toolPart.test.ts`：覆盖工具 part 解析、显示名和状态映射。

## `web/src/styles/`

- `web/src/styles/globals.css`：Tailwind CSS 4 全局样式和主题变量。`Tailwind` 是工具类 CSS 框架。

## 认知文件

- `data/profiles/agents/default/soul.md`：Agent 对自己的稳定认知，例如身份定位、表达规则、做事边界和长期协作原则。
- `data/profiles/users/default/user.md`：Agent 对用户的稳定认知，例如用户身份、偏好、长期项目和协作方式。

这两个文件会由 profile sync 自动维护。长期证据仍以记忆系统和事件系统为准，profile 文件只是更稳定、更短的认知摘要。

## 文档目录

### `docs/superpowers/plans/`

计划文档，记录每个阶段准备怎么做：

- `2026-05-05-web-frontend.md`：Web 前端初始建设计划。
- `2026-05-06-session-persistence.md`：会话持久化计划。
- `2026-05-06-memory-system.md`：早期记忆系统计划。
- `2026-05-06-memory-extraction-status.md`：记忆提取状态展示计划。
- `2026-05-07-tool-system-plan.md`：工具系统总体计划。
- `2026-05-07-tool-system-plan-backend.md`：工具系统后端计划。
- `2026-05-07-tool-system-plan-frontend.md`：工具系统前端计划。
- `2026-05-07-tool-system-plan-testing.md`：工具系统测试计划。
- `2026-05-07-tool-system-plan-whitelist.md`：工具白名单计划。
- `2026-05-07-memory-system-redesign.md`：记忆系统重设计计划。
- `2026-05-07-vercel-ai-sdk-migration.md`：Vercel AI SDK 迁移计划。
- `2026-05-08-agent-runtime-refactor.md`：Agent Runtime 重构计划。
- `2026-05-09-human-like-memory-system.md`：人类式记忆系统计划。

### `docs/superpowers/specs/`

规格和验收文档，记录设计细节、测试矩阵和验收结果：

- `2026-05-05-agent-architecture-design.md`：Agent 架构设计。
- `2026-05-05-web-frontend-design.md`：Web 前端设计。
- `2026-05-06-memory-system-design.md`：记忆系统设计。
- `2026-05-06-memory-extraction-status-design.md`：记忆提取状态设计。
- `2026-05-07-hono-routing-design.md`：Hono 路由设计。
- `2026-05-07-memory-system-redesign.md`：记忆系统重设计规格。
- `2026-05-07-tool-system-design.md`：工具系统设计。
- `2026-05-07-vercel-ai-sdk-migration-design.md`：Vercel AI SDK 迁移设计。
- `2026-05-08-agent-runtime-refactor-design.md`：Agent Runtime 重构设计。
- `2026-05-09-human-like-memory-chrome-devtools-acceptance.md`：人类式记忆 Chrome DevTools 验收用例。
- `2026-05-09-human-like-memory-acceptance-report.md`：人类式记忆验收报告。
- `2026-05-09-human-like-memory-regression-test.md`：人类式记忆回归测试文档。
- `2026-05-09-human-like-memory-regression-report.md`：人类式记忆回归报告。

## 根目录文件

- `AGENTS.md`：当前推荐给 AI coding agent 阅读的工作说明。包含真实架构修正和项目约定。
- `CLAUDE.md`：更长的项目说明文件，部分旧流程已过期，应该优先参考 `AGENTS.md` 的修正。
- `package.json`：后端包配置、脚本和依赖。
- `bun.lock`：后端依赖锁文件。
- `bunfig.toml`：Bun 配置，当前主要配置 npm registry。
- `tsconfig.json`：后端 TypeScript 编译配置。
- `eslint.config.js`：后端 ESLint 配置。
- `test-opencode-agents.md`：OpenCode / Agent 测试记录文档。

## 当前主流程

用户在 Web 页面发送消息后的主链路：

1. 前端 `ChatPage` 确保有 session，再调用聊天 API。
2. 后端 `routes/chat.ts` 保存用户消息并创建任务。
3. `task-queue.ts` 按 Agent 串行执行任务。
4. `agent-runtime.ts` 构建 prompt，调用模型，并通过工具系统执行工具。
5. 助手回复保存到 `messages` 表。
6. `routes/chat.ts` 触发 `assistant.message.persisted` 生命周期 hook。
7. `lifecycle-hooks.ts` 投递 `MemoryExtractionWorker` 后台任务。
8. 记忆 Worker 提取新记忆、执行再巩固，并把 `memory_extract` / `memory_reconsolidate` 合成工具卡写回助手消息。
9. `MemoryService` 统一处理记忆写入、去重、强化、事件和 profile 同步。
10. 前端短时间轮询消息，刷新出后台记忆工具卡。
11. Runtime / Events / Memory 页面通过 API 查询事件、任务和记忆状态。

## 当前设计原则

- 主动写长期记忆只走 `memory_remember` / `memory.remember`。
- 不再使用候选记忆写入路径；主动写长期记忆统一走记住工具。
- 长期记忆不自动注入 prompt，过去经历、证据、计划和偏好应通过记忆工具查询。
- 同一个 Agent 同一时间只处理一个任务，保持单线程执行模型。
- Profile 文件是稳定认知摘要，不替代事件和记忆证据链。
- Dream Worker 可以自主整理记忆，但不硬删除用户事实；整理行为需要可审计、可撤销。
