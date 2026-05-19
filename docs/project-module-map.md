# my-agent 完整模块地图

这份文档用于回答一个问题：如果要把 `my-agent` 做成一个完整、可长期使用的个人 Agent Runtime，整体需要哪些模块。

它不是某个模块的详细开发计划，而是后续讨论和排期的总索引。后面可以按本文档里的模块逐个展开，分别写更细的方案、接口、数据结构和测试计划。

相关架构边界文档：

- [Task / Memory / Episode 职责边界](./architecture/task-memory-episode-boundaries.md)

专业术语说明：

- **Agent Runtime**：Agent 运行时。这里指后端负责接收输入、创建 Task、调用模型、执行工具、写入事件、更新记忆和恢复失败任务的系统。
- **模块**：一组职责边界明确的代码和数据能力。模块不一定等于一个目录，也不一定等于一个服务。
- **闭环**：系统完成一次任务后，会把过程和结果反馈回记忆、Skill、Profile 或配置，让下一次做得更好。
- **控制面**：管理和观察系统状态的接口，例如查看 Task、重试任务、启停渠道、查看事件。
- **数据面**：真正承载用户输入、Agent 执行、工具调用、记忆写入和渠道收发的链路。

## 1. 完整项目的目标形态

`my-agent` 的完整形态不是“一个带聊天框的 Web 应用”，也不是“一个泛化多 Agent 平台”。它应该是一个本地优先、以后端为核心的个人 Agent 系统：

1. 用户可以从 Web、飞书、微信或其他渠道发起任务。
2. 所有输入都会进入统一 Task 系统。
3. 每个 Agent 像人一样一次专注处理一个 Task。
4. Agent 能调用工具、读取记忆、使用 Skill，并在必要时请求审批。
5. 任务过程可审计、可恢复、可重试。
6. 任务完成后能沉淀经历、记忆、Profile 和 Skill。
7. 多个 Agent 可以分工协作，但每个 Agent 仍保持自己的上下文边界。
8. 本地数据可备份、迁移、恢复，不依赖单一前端页面。

完整项目的一句话标准：

> 输入能可靠变成任务，任务能可靠完成或解释失败，完成后的经验能可靠进入记忆和 Skill，下一次同类任务能明显受益。

## 2. 模块总览

| 编号 | 模块 | 核心问题 | 当前状态 | 完整目标 |
|---|---|---|---|---|
| M1 | [Core Runtime](./modules/m1-core-runtime.md) | 系统如何启动、配置和初始化 | 已有基础，启动 Task Watchdog 和记忆提取重试调度器，注册 Workbench Git 控制面，支持 Task Plan/Dependency 与 Skill candidate schema，已有 SQLite 备份基础，已有模块文档 | 可诊断、可迁移、可恢复 |
| M2 | [Agent Identity & Config](./modules/m2-agent-identity-config.md) | Agent 是谁、允许做什么 | 已有基础，配置规范化逻辑已拆分，远程 Skill origin 可保留 contentHash，已有模块文档 | 配置边界清晰、可版本化 |
| M3 | [Task System](./modules/m3-task-system.md) | 所有输入如何变成可靠执行单元 | 已有可靠性、可观察性、Watchdog 自愈、Task Plan/Dependency v1、Agent planning tools 和 prompt-level 自动规划，任务领取的实时推送已移出事务，已有模块文档 | 增强复杂依赖、计划质量评估和 Episode 输入契约 |
| M4 | [Runtime Execution](./modules/m4-runtime-execution.md) | Agent 如何执行 Task | 已可执行，审批续跑 continuation、工具审计事件和 RAG-in-context 记忆检索已补齐，已有模块文档 | 执行上下文、失败分类和恢复更完整 |
| M5 | [Prompt & Context](./modules/m5-prompt-context.md) | 每次执行带哪些上下文 | 已有 prompt builder、Task planning tools 指引、复杂任务 planning guide、父任务汇总上下文预算、结构化摘要消息和相关长期记忆注入，已有模块文档 | 上下文预算、记忆选择和 Skill 选择更稳定 |
| M6 | [Tool System](./modules/m6-tool-system.md) | Agent 如何安全调用能力 | 已有工具、审批、工具调用审计和 Runtime planning tools，已有模块文档 | 权限更细、工具失败更可恢复 |
| M7 | [Memory System](./modules/m7-memory-system.md) | Agent 如何长期记住和整理 | 已有长期记忆、记忆提取持久化重试、Dream Worker、Episode v1 和 Memory → Skill candidate 触发点；Dream Worker 全局锁已由 finally 保护，Episode 可消费工具审计事件，已有模块文档 | 人类式记忆分层和质量评估更完整 |
| M8 | Profile System | Agent 如何稳定理解用户和自己 | 已有 `user.md` / `soul.md` | 更新策略、冲突处理和版本记录更完整 |
| M9 | [Skill System](./modules/m9-skill-system.md) | Agent 如何沉淀可复用做法 | 已有三类 Skill、provenance/usage 元数据、正式 skill_candidates 表、候选审查 API 和远程 Skill contentHash，已有模块文档 | 生命周期、安全、统计和推荐完整化 |
| M10 | [Event & Audit](./modules/m10-event-audit.md) | 系统如何知道发生过什么 | 已有事件表、Watchdog 审计事件、工具调用审计、Skill candidate 事件和 Skill 内容变更事件，已有模块文档 | 事件规范、查询、诊断和回放更强 |
| M11 | [Channel System](./modules/m11-channel-system.md) | 外部消息如何进入和回复 | Web/飞书可用，外部渠道 runner 已接入 RAG-in-context，队列 drain 已修复 missed-wakeup 竞态，微信 stub，已有模块文档 | 多渠道生产化 |
| M12 | [Multi-Agent Collaboration](./modules/m12-multi-agent-collaboration.md) | 多 Agent 如何分工 | 已有异步委派，支持 plan step child task 和 child task 依赖，已有模块文档 | 协作协议、角色边界和结果汇总完整化 |
| M13 | Safety & Trust | 如何避免越权和污染 | 已有审批和路径限制 | 远程内容、敏感信息和注入攻击防护 |
| M14 | Data Reliability | 本地数据如何长期可靠 | 基础数据库可用 | 备份、恢复、导出、迁移 |
| M15 | [Runtime Control API](./modules/m15-runtime-control-api.md) | 如何管理运行时 | 已有部分 API，支持 Watchdog、Task timeline、Task Plan/Dependency 控制面、Workbench Git 分支控制面和异步 Chat RAG 上下文准备，已有模块文档 | 控制面完整化 |
| M16 | [Web Console](./modules/m16-web-console.md) | 如何观察和调试 | 已有工程控制台，展示 Watchdog、Task timeline、plan/dependency 详情和开发工作台；Watchdog 状态提醒会列出可定位任务明细并支持本地忽略；Runtime Store 当前任务推导已补 JSDoc，已有模块文档 | 继续作为控制台，不成为核心 |
| M17 | Evaluation & Testing | 如何知道 Agent 变好了 | 单元测试较多 | 行为评估和端到端场景测试 |
| M18 | Documentation & Onboarding | 新 Agent 如何理解项目 | 已有基础文档 | 模块文档和开发路线成体系 |

## 3. M1 Core Runtime

### 职责

Core Runtime 负责系统最底层的启动和初始化。

当前相关目录：

```text
src/core/
src/main.ts
src/scripts/
```

它应该负责：

- 读取配置。
- 初始化 SQLite。
- 初始化默认 Agent。
- 注册工具、路由和生命周期钩子。
- 启动后台调度器。
- 恢复异常中断的 Task。
- 提供 Gateway 启停和健康检查。

### 当前已有

- 配置加载：环境变量、`config.json`、默认值。
- SQLite schema 初始化。
- `.my-agent/` 运行时目录。
- Gateway start / stop / restart / status / logs。
- 启动时恢复租约过期 Task。
- 启动 Task Watchdog 调度器，运行期间持续巡检异常 Task 和 Agent 状态。
- Task Plan/Dependency v1 的 `tasks` 新字段、`task_steps`、`task_dependencies` schema 初始化和兼容迁移。
- `memory_extraction_retries` schema 初始化，以及进程内 60 秒重试扫描器启动。

### 还需要补齐

- 启动诊断报告：配置缺失、端口占用、数据库不可写、模型 key 缺失。
- 数据目录检查：`.my-agent/` 结构是否完整、权限是否正确。
- 运行时版本记录：当前代码版本、数据库 schema 版本、数据目录版本。
- 初始化失败的清晰错误。
- 后续迁移脚本入口。

专业术语说明：

- **schema**：数据库表结构，包括表、字段、索引和约束。
- **健康检查**：用于判断服务是否正常运行的轻量接口或命令。

## 4. M2 Agent Identity & Config

### 职责

这个模块定义 Agent 是谁、拥有什么能力、能访问什么工具、绑定哪些渠道、有哪些 Skill 和记忆开关。

当前相关目录：

```text
src/agents/
.my-agent/agents/<agentId>/agent.json
```

### 当前已有

- `default` Agent 初始化。
- 多 Agent 创建、读取、更新。
- `AgentConfigService` 统一管理 `agent.json`。
- Agent-scoped 的工具策略、Skill 元数据、渠道绑定。
- `soul.md` 和 `user.md` 已经按 Agent 隔离。
- `src/agents/config-normalizer.ts` 已拆出默认配置生成、配置规范化、配置校验和 patch 合并等纯函数；`config-service.ts` 主要保留服务和文件 I/O。

### 还需要补齐

- 配置版本号和迁移记录。
- 配置 diff 和审计。
- Agent 模板：例如个人助手、研究员、工程师、审阅者。
- Agent 能力边界说明：哪些工具、哪些目录、哪些渠道。
- 配置校验报告。
- Agent 删除、归档和导出策略。

专业术语说明：

- **diff**：两份配置之间的差异。
- **归档**：不再活跃使用，但保留数据以便以后恢复。

## 5. M3 Task System

### 职责

Task 是 Agent 的最小执行单元。所有输入最终都应该变成 Task。

模块文档：[docs/modules/m3-task-system.md](./modules/m3-task-system.md)

当前相关目录：

```text
src/tasks/
```

### 当前已有

- Task 生命周期：`queued`、`running`、`completed`、`failed`、`canceled`。
- 同一 Agent 单线程执行。
- `attempt_count`、`max_attempts`。
- 租约、续约、过期恢复。
- 幂等键 `idempotency_key`。
- retry、cancel、recover。
- 失败分类：模型失败、工具失败、权限失败、超时、租约过期、取消、上下文缺失。
- 执行进度：`progress_status`、`progress_message`、`last_progress_at`。
- Task 事件审计。
- Task Watchdog：自动取消 Web 僵尸 queued task、恢复租约过期 running task、修复 Agent running 状态不一致、提醒外部队列和审批超时。
- Task progress event 支持轻量 metadata，用于当前工具、tool call id 和最近输出摘要；完整工具流水仍归 Event。
- Task Plan / Dependency v1：`task_steps` 表达步骤，`task_dependencies` 表达 task-level 依赖；依赖未完成的 queued task 不会被领取。
- Agent 可通过 Runtime planning tools 主动写计划、更新步骤、创建绑定 plan step 的 child task，并维护 child task 之间的依赖。
- `src/tasks/task-failure.ts` 已拆出失败分类纯函数，`task-store.ts` 继续提供兼容导出。
- Prompt builder 现已对复杂顶层 task 自动注入 planning guide，先引导模型判断是否需要写结构化计划。

### 还需要补齐

- Episode 输入契约：Task outcome 和 plan/dependency 如何稳定供 Episode 生成经历摘要。
- 自动 Task planning：复杂任务由模型或系统自动决定何时拆成步骤/子任务。
- 复杂依赖调度和父子任务汇总。
- Task priority 更完整的调度策略。
- 长期任务和暂停恢复。
- 外部渠道消息的幂等键全面接入。

专业术语说明：

- **dependency**：依赖关系。一个任务必须等另一个任务完成后才能运行。
- **priority**：优先级。多个任务排队时，决定谁先执行。

## 6. M4 Runtime Execution

### 职责

Runtime Execution 负责真正执行 Task。

当前相关目录：

```text
src/runtime/
src/channels/external-runner.ts
```

### 当前已有

- `agent-runtime.ts` 执行 Web 流式任务。
- `internal-runner.ts` 执行内部任务。
- 外部渠道 runner 可处理飞书任务并回发。
- 执行期间续约 Task 租约。
- 成功、失败、取消时释放 Agent。
- 工具调用统一写入 `tool.call` / `tool.result` 审计事件，包含工具名、tool call id、耗时、输出摘要或错误。
- 构建 prompt 前会按 task input 检索相关长期记忆，检索失败时降级为空上下文。

### 还需要补齐

- 统一 runner 基类或公共执行管线。
- started / completed / failed / canceled 事件标准化。
- 模型调用失败和工具调用失败的统一错误结构。
- 任务执行上下文快照。
- 运行中 Task 的可观察状态：当前步骤、当前工具、最近输出。
- 中断后恢复策略：哪些任务可恢复、哪些只能失败。

专业术语说明：

- **执行上下文快照**：某次 Task 执行时使用的 Agent 配置、工具策略、Skill 索引、Profile 摘要等信息的记录。

## 7. M5 Prompt & Context

### 职责

这个模块决定每次模型调用时，Agent 能看到什么。

模块文档：[docs/modules/m5-prompt-context.md](./modules/m5-prompt-context.md)

当前相关目录：

```text
src/prompts/
```

### 当前已有

- system prompt 构建。
- 注入 Agent profile：`soul.md`、`user.md`。
- 注入 Skill index。
- 注入工具说明。
- 避免直接把全部记忆塞进 prompt，只注入少量相关、已过滤的长期记忆片段。
- 指引复杂任务使用 `task_plan_set`、`task_step_update` 和 `task_child_create` 写入结构化计划。
- 父任务汇总上下文会按预算压缩 parent input、plan steps、直接 child task 结果/错误和 episode 摘要，避免把完整事件流水放进 prompt。

### 还需要补齐

- 更完整的全局上下文预算管理。
- Skill 自动选择策略。
- 记忆召回选择策略。
- Task history 与事件流水的通用摘要策略。
- 多渠道上下文格式统一。
- Prompt 版本记录和回归测试。

专业术语说明：

- **上下文预算**：模型一次调用能接收的最大 token 限制。token 可以理解为模型处理文本的基本单位。
- **召回**：从大量记忆或文档中选出当前任务最相关的一小部分。

## 8. M6 Tool System

### 职责

Tool System 决定 Agent 能调用什么能力，以及如何安全调用。

模块文档：[docs/modules/m6-tool-system.md](./modules/m6-tool-system.md)

当前相关目录：

```text
src/tools/
```

### 当前已有

- 工具注册表。
- 工具集。
- Agent-scoped 工具策略。
- 读工具默认允许。
- 写工具默认需要审批。
- 文件路径 allowlist。
- 工具审批事件。
- 工具调用审计事件：`tool.call` 与 `tool.result`。
- `buildAgentTools(context)` 会为每次 Agent run 注入 task/conversation/agent 上下文，并统一包装工具审计。
- 工具审计会更新 Task progress metadata，用于展示当前工具、tool call id 和最近输出摘要。
- 防止 `write_file` 直接改 `agent.json`。

### 还需要补齐

- 工具输入输出 schema 文档。
- 工具失败的结构化错误标准。
- 工具调用超时和取消。
- 工具权限模板。
- 工具使用统计。
- 工具安全等级：只读、写入、网络、执行命令、敏感数据。
- 审批等待状态和 Task 暂停/恢复语义的进一步打通。

专业术语说明：

- **schema**：结构定义。这里指工具参数和返回值应该长什么样。
- **allowlist**：白名单。只有明确列入的路径或能力才允许使用。

## 9. M7 Memory System

### 职责

Memory System 负责让 Agent 长期记住重要信息，并能在需要时找回来。

模块文档：[docs/modules/m7-memory-system.md](./modules/m7-memory-system.md)

当前相关目录：

```text
src/memory/
src/memory/extraction/
src/memory/dream/
src/memory/storage/
src/memory/tools/
```

### 当前已有

- 长期记忆写入、搜索、更新、遗忘。
- LanceDB 向量检索。
- TF-IDF 文本检索。
- assistant message persisted 后自动触发记忆提取。
- 记忆提取失败会进入 SQLite 持久化重试队列，后台扫描器按指数退避重试，最多处理 5 次。
- 记忆去重和再巩固。
- Dream Worker。
- 情景记忆 episode 基础能力，包含任务状态、失败分类、可重试性和关键步骤。
- Episode 从 `tool.call` / `tool.result` 提取 `tools_used` 和 `key_steps`，但完整执行链路仍以 Event 为事实源。
- Runtime 启动时会补齐或刷新终态 task 的 episode，保证 retry 后同一 task 仍只有一条经历记录。
- prospective memory 的基础工具能力。

### 还需要补齐

- 更清晰的人类式记忆分层：
  - semantic memory：事实记忆。
  - episodic memory：经历记忆。
  - procedural memory：程序性记忆，和 Skill 关联。
  - prospective memory：未来计划或待办。
  - reflective memory：反思和原则。
- Task 完成后的经验沉淀闭环。
- 记忆置信度和证据链展示。
- 记忆冲突处理策略。
- 记忆导入、导出、备份。
- 记忆质量评估。

专业术语说明：

- **semantic memory**：语义记忆，类似“知道某个事实”。
- **episodic memory**：情景记忆，类似“记得某次经历”。
- **procedural memory**：程序性记忆，类似“知道某类事情怎么做”。
- **prospective memory**：前瞻记忆，类似“记得以后要做某事”。
- **reflective memory**：反思记忆，记录经验教训和长期原则。

## 10. M8 Profile System

### 职责

Profile System 负责保存 Agent 对自己和用户的稳定理解。

当前相关目录：

```text
src/profiles/
.my-agent/agents/<agentId>/soul.md
.my-agent/agents/<agentId>/user.md
```

### 当前已有

- `soul.md`：Agent 对自己的稳定认知。
- `user.md`：Agent 对用户的稳定认知。
- legacy profile 文件迁移。
- 从记忆同步 profile。

### 还需要补齐

- Profile 更新审计。
- Profile 冲突解决。
- Profile 版本历史。
- 用户可编辑区域和系统维护区域更明确。
- 多用户身份映射到不同 profile 视角。

专业术语说明：

- **Profile**：稳定画像文件。这里不是头像，而是对用户或 Agent 的长期理解。

## 11. M9 Skill System

### 职责

Skill System 负责让 Agent 把反复使用的方法沉淀成可复用能力。

当前相关目录：

```text
src/skills/
skills/builtin/
.my-agent/agents/<agentId>/skills/
```

### 当前已有

- `builtin`：系统内置 Skill，代码目录只读扫描。
- `agent_created`：Agent 自己写的 Skill。
- `remote_installed`：GitHub 远程安装 Skill。
- 远程 Skill 保存 origin，用于更新。
- Skill enable / disable / view / create / install / update。
- 内置 `skill-creator`。
- `src/skills/skill-markdown.ts` 已拆出 Markdown/frontmatter 解析与生成逻辑，`src/skills/skill-fs.ts` 已拆出远程拉取与目录替换等文件系统副作用逻辑。
- `skill_candidates` 已作为正式候选表落地，Dream Worker 可生成候选，skills 路由可 accept/reject 并转正式 Skill。
- 远程 Skill origin 现在保存 `contentHash`，远程更新会在内容变化时写入 `skill.content.changed` 事件。

### 还需要补齐

- Skill candidate 的 UI 审查、接受、拒绝和转正式 Skill 流程。
- Skill 内容 diff 和远程更新风险审批。
- Skill 版本历史。
- Skill 安全扫描。
- 相似 Skill 合并建议。
- Skill 重复检测和合并建议。
- 远程 Skill 更新前后的 diff 和审批。
- Skill 生命周期：active、stale、archived。

专业术语说明：

- **origin**：来源信息，例如 builtin、agent_created、remote_installed。
- **provenance**：来源证明，通常包括 URL、branch、commit、安装时间和更新时间。
- **stale**：长期未使用或可能过时。

## 12. M10 Event & Audit

### 职责

Event & Audit 记录系统发生过什么，是恢复、调试、解释和评估的基础。

当前相关目录：

```text
src/events/
```

### 当前已有

- 事件写入 SQLite。
- Task、Tool、Memory、Skill 相关事件。
- Watchdog 事件：`task.watchdog.*` 与 `agent.watchdog.repaired`。
- 工具审计事件：`tool.call` 与 `tool.result`。
- 按 Agent、Task、Conversation 查询事件。
- Runtime 页面可展示事件。

### 还需要补齐

- 事件类型注册表。
- 事件 payload schema。
- 事件严重等级和 Watchdog `notificationLevel` 统一规范。
- 事件关联链路：一次外部消息到 Task、Tool、Memory、Channel 回复。
- 事件导出。
- 事件压缩或归档。

专业术语说明：

- **payload**：事件携带的结构化数据。
- **审计**：留下可检查记录，说明谁在什么时候做了什么。

## 13. M11 Channel System

### 职责

Channel System 负责把外部输入接入 Runtime，并把结果发回对应渠道。

当前相关目录：

```text
src/channels/
```

### 当前已有

- Web channel。
- Feishu WebSocket MVP。
- Feishu onboarding 和 binding。
- Channel identity。
- Channel conversation。
- 外部渠道禁用 DeepSeek thinking 并提供空模型输出兜底，避免飞书收到空回复。
- WeChat stub。
- `ChannelMessageInput.idempotency_key` 已接入 `ChannelService` 到 `createTask()` 链路，飞书使用 `messageId` 生成稳定幂等键，降低重复回调导致的重复 Task 风险。

### 还需要补齐

- 为更多渠道统一生成稳定 `idempotency_key`，例如未来微信 message id、webhook event id。
- 附件处理。
- 富文本处理。
- 主动消息和通知。
- 渠道权限隔离。
- 微信真实接入。
- 多渠道统一错误反馈。
- 渠道消息和内部 Task 的完整追踪。

专业术语说明：

- **binding**：绑定关系，例如某个飞书 app 绑定到某个 Agent。
- **identity mapping**：身份映射，把外部用户 ID 映射到内部用户 ID。

## 14. M12 Multi-Agent Collaboration

### 职责

这个模块负责多个 Agent 如何分工，而不是让单个 Agent 无限并发。

当前相关目录：

```text
src/delegations/
src/agents/
src/tasks/
```

模块文档：[docs/modules/m12-multi-agent-collaboration.md](./modules/m12-multi-agent-collaboration.md)

### 当前已有

- Agent A 可以委派任务给 Agent B。
- 子 Agent 完成后创建 callback Task。
- 防止递归委派。
- 子任务结果会回到父 Agent。
- 取消 queued 子任务时会同步生成 canceled episode，保证多 Agent 失败或取消经历可追踪。
- 委派流程复用 Task System 的生命周期、租约和进度字段，不绕过单 Agent 单线程约束。

### 还需要补齐

- 角色模板。
- 委派协议：输入格式、期望输出、失败说明。
- 结果汇总协议。
- 多 Agent 任务依赖图。
- 协作事件时间线。
- 父 Agent 如何判断子 Agent 输出是否足够。
- 委派失败后的回退策略。
- 跨 Agent 的权限边界，避免通过委派绕过工具或文件访问策略。

专业术语说明：

- **委派**：一个 Agent 把某个子任务交给另一个 Agent。
- **回调任务**：子 Agent 完成后，系统为父 Agent 创建的整理任务。

## 15. M13 Safety & Trust

### 职责

Safety & Trust 负责限制 Agent 的危险能力，防止远程内容和外部输入污染系统。

当前相关目录：

```text
src/tools/
src/guards/
src/skills/
```

### 当前已有

- 写工具审批。
- 文件路径 allowlist。
- 远程 Skill 默认 disabled。
- `write_file` 禁止直接修改 `agent.json`。

### 还需要补齐

- 远程 Skill 安全扫描。
- prompt injection 检测和隔离。
- 敏感信息保护。
- 工具风险等级。
- 渠道输入可信度标记。
- 高风险工具二次确认。
- 安全事件审计。

专业术语说明：

- **prompt injection**：提示词注入。外部内容试图诱导 Agent 忽略规则、泄露信息或执行危险操作。
- **敏感信息**：密钥、token、私有路径、用户隐私数据等不应随意暴露的内容。

## 16. M14 Data Reliability

### 职责

Data Reliability 负责让 `.my-agent/` 里的长期数据可维护、可备份、可迁移。

当前相关数据：

```text
.my-agent/agent.sqlite
.my-agent/memories.lancedb/
.my-agent/agents/<agentId>/
```

### 当前已有

- SQLite WAL。
- LanceDB 本地存储。
- Runtime 数据统一收口到 `.my-agent/`。
- 部分 legacy 文件迁移。
- `src/core/backup.ts` 已提供 SQLite 热备份、备份列表、旧备份清理和结构化 JSON 导出。
- `src/main.ts` 启动时会检查最近一次备份时间，超过 24 小时则异步创建一次新的 SQLite 备份。

### 还需要补齐

- 一键恢复。
- LanceDB、Agent 文件目录与 SQLite 的统一整包备份。
- 数据导出完整化；当前 JSON 导出只覆盖 SQLite 元数据，不包含向量内容。
- 数据校验。
- schema 迁移版本。
- 坏数据修复工具。
- Agent 级导入导出。
- 加密或敏感字段脱敏策略。

专业术语说明：

- **迁移**：当数据结构升级时，把旧数据转换成新结构。
- **脱敏**：隐藏或替换敏感字段，避免泄露。

## 17. M15 Runtime Control API

### 职责

Runtime Control API 是后端控制面，用于管理和观察系统。

当前相关目录：

```text
src/routes/
```

### 当前已有

- Agent API。
- Task API。
- Event API。
- Watchdog 手动扫描 API。
- Runtime 备份 API。
- Runtime 备份列表 API。
- Runtime JSON 导出 API。
- Task timeline 聚合 API。
- Skill API。
- Tool approval API。
- Channel API。
- Runtime status API。

### 还需要补齐

- API 文档。
- API 错误码规范。
- 管理操作审计。
- 批量操作。
- 诊断接口，包括 Watchdog 最近扫描结果和调度器健康状态。
- 数据导入导出接口。
- 只读观察接口和写入控制接口分层。

专业术语说明：

- **错误码规范**：不同失败情况返回稳定的 code 和 message，方便前端和 Agent 判断下一步。

## 18. M16 Web Console

模块文档：[docs/modules/m16-web-console.md](./modules/m16-web-console.md)

### 职责

Web Console 是工程控制台，用来观察、调试和管理 Runtime。

当前相关目录：

```text
web/
```

### 当前已有

- Chat。
- Memory。
- Profile。
- Agents。
- Channels。
- Tools。
- Skills。
- Tasks。
- Events。
- Architecture。
- Settings。
- Runtime Snapshot 会跟随当前选中的 Agent 拉取状态。
- Task Queue 优先展示排队任务，并按新到旧展示最近历史任务。
- Runtime Events 支持 Watchdog 事件中文展示。
- Runtime Snapshot 支持 P0/P1 Watchdog 提醒、可定位任务明细、本地忽略和 Task 自动取消/失败原因展示。
- Tasks 控制台支持选中单个任务并展示 Task timeline、当前工具、最近输出和 episode 摘要。

### 还需要补齐

- 不是优先做产品化 UI，而是补观察能力。
- Task timeline 更完整，例如事件 payload 展开、过滤和父子任务串联。
- Watchdog 提醒跳转到对应任务或事件时间线。
- 直接进入控制台时的实时订阅或 fallback 轮询。
- 控制台显式 Agent 切换器。
- Memory evidence 展示。
- Skill diff / update / provenance 展示。
- Channel message tracing。
- Agent config diff。
- 数据诊断面板。

专业术语说明：

- **timeline**：时间线，把同一个任务或事件链按时间顺序展示。

## 19. M17 Evaluation & Testing

### 职责

这个模块负责回答：系统是不是真的变好了。

当前已有

- 后端单元测试较多。
- 路由测试。
- 部分前端 store/lib 测试。
- Task、Memory、Skill、Channel 都有基础测试。

### 还需要补齐

- 端到端测试。
- Agent 行为评估。
- 记忆质量评估。
- Skill 使用效果评估。
- 多 Agent 协作场景测试。
- 渠道重复投递和异常场景测试。
- 长期运行稳定性测试。

专业术语说明：

- **端到端测试**：从输入到最终输出的完整链路测试。
- **评估集**：一组固定测试任务，用来比较系统修改前后的表现。

## 20. M18 Documentation & Onboarding

### 职责

文档模块负责让新对话、新 Agent、新开发者快速理解项目。

当前已有

- `AGENTS.md`。
- `README.md`。
- `docs/project-overview.md`。
- `docs/agent-quick-context.md`。
- 本文档。
- `docs/modules/m1-core-runtime.md`。
- `docs/modules/m3-task-system.md`。
- `docs/modules/m4-runtime-execution.md`。
- `docs/modules/m10-event-audit.md`。
- `docs/modules/m11-channel-system.md`。
- `docs/modules/m15-runtime-control-api.md`。
- `docs/architecture/task-memory-episode-boundaries.md`。
- `.codex/hooks/ensure_module_docs.py` 文档同步 hook。

### 还需要补齐

- 每个核心模块一份设计文档。
- 数据模型文档。
- API 文档。
- 运行维护手册。
- 故障排查手册。
- 开发路线图。
- 决策记录。
- 继续补齐其他核心模块的 `docs/modules/m*.md` 文档。

### 文档同步规则

每次修改模块代码后，需要同步更新：

1. 对应的 `docs/modules/m*.md` 模块文档。
2. 本文档 `docs/project-module-map.md`。

Codex Stop hook 会在本轮回复结束前做基础检查。Stop hook 是 Codex 准备结束本轮工作时执行的校验脚本；如果代码改了但模块文档没改，它会阻止结束并提示需要补哪些文档。

专业术语说明：

- **决策记录**：记录为什么采用某个架构选择，避免以后反复争论同一个问题。
- **hook**：自动触发脚本，用于在特定时机执行检查或动作。

## 21. 推荐后续讨论顺序

建议按下面顺序逐模块讨论和开发，不要一次铺太多：

1. **Task + Runtime**：先把执行单元和执行管线做扎实。
2. **Memory + Profile**：让 Agent 真正能长期学习和稳定理解用户。
3. **Skill**：把经验沉淀成可复用能力。
4. **Tool + Safety**：确保能力越强，边界越清晰。
5. **Channel**：把输入来源扩展到更多真实渠道。
6. **Multi-Agent**：在单 Agent 能力稳定后，再强化分工协作。
7. **Data Reliability**：保证长期使用不丢数据。
8. **Evaluation**：建立评估集，避免主观感觉驱动开发。
9. **Web Console**：围绕观察和调试补 UI，不让前端反向绑架架构。

## 22. 判断模块是否完整的标准

一个模块可以认为“基本完整”，至少要满足：

1. 有清晰职责边界。
2. 有明确数据归属。
3. 有 Service 层承载业务规则。
4. 有事件审计。
5. 有失败处理。
6. 有测试。
7. 有文档。
8. 不破坏 Agent-scoped 边界。
9. 不把运行时数据提交进仓库。
10. 能被新对话里的 Agent 快速理解。

## 23. 当前最值得优先细化的模块

如果后续开始逐模块讨论，建议先从这些模块写详细计划：

1. `M3 Task System`
2. `M4 Runtime Execution`
3. `M7 Memory System`
4. `M9 Skill System`
5. `M13 Safety & Trust`
6. `M14 Data Reliability`

原因是它们最直接决定这个项目是否能长期作为个人 Agent 使用。
