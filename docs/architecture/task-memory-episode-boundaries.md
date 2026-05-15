# Task / Memory / Episode 职责边界

本文档定义 `my-agent` 中 Task、Event、Episode、Memory、Dream、Skill、Profile 的职责分工。目标是避免后续开发时出现“同一类信息到底应该写到哪里”的混乱。

专业术语说明：

- **职责边界**：一个模块应该负责什么、不应该负责什么。
- **事实层级**：数据是在记录原始事实、执行状态、经历摘要、长期知识，还是可复用方法。
- **时间尺度**：数据只对当前任务有用、对最近一段时间有用，还是应该长期保留。
- **写入权限**：哪个模块或服务可以创建、更新某类数据。

## 1. 总原则

本项目的核心链路应该是：

```text
外部输入 / 用户消息
  -> Task
  -> Runtime 执行
  -> Event
  -> Episode
  -> Memory
  -> Dream 整理
  -> Profile / Skill 沉淀
```

每一层只做一类事情：

| 层级 | 本质 | 时间尺度 | 主要问题 |
|---|---|---|---|
| Task | 执行单元 | 当前任务 | 这件事如何被可靠执行 |
| Event | 审计事实 | 当前任务到长期审计 | 过程中真实发生了什么 |
| Episode | 经历摘要 | 最近到长期可查 | 这次任务整体经历是什么 |
| Memory | 长期知识 | 长期 | 以后还值得记住什么 |
| Dream | 后台整理流程 | 批处理 / 周期性 | 哪些经历和记忆应该合并、沉淀或更新 |
| Skill | 可复用方法 | 长期 | 某类事情以后应该怎么做 |
| Profile | 稳定画像 | 长期 | Agent 和用户的稳定认知是什么 |

核心原则：

1. Task 不直接写长期记忆。
2. Event 不做总结，只记录审计事实。
3. Episode 是任务经历摘要，不是长期知识库。
4. Memory 只保存未来仍有价值的信息。
5. Dream 是整理流程，不是新的记忆类型。
6. Skill 是方法，不是单次任务历史。
7. Profile 是稳定认知，不保存任务流水。

## 2. Task

### 定位

Task 是 Agent 的最小执行单元。所有 Web 消息、渠道消息、委派请求最终都应该变成 Task。

Task 只回答：

- 要做什么。
- 由哪个 Agent 做。
- 当前状态是什么。
- 是否正在运行。
- 是否成功、失败或取消。
- 失败后是否能重试。
- 如果服务重启或执行卡住，如何恢复。

### 应该负责

- 状态：`queued`、`running`、`completed`、`failed`、`canceled`。
- 执行归属：`agent_id`、`conversation_id`、渠道来源。
- 可靠性：租约、续约、恢复、重试、最大执行次数。
- 幂等：同一外部输入不重复创建 Task。
- 取消：用户或系统取消 Task。
- 基础结果：成功结果、失败原因、取消原因。
- 结构化失败分类。

专业术语说明：

- **租约（lease）**：运行中 Task 的有效期。执行器会定期续约；过期说明执行器可能卡住或服务已重启。
- **幂等（idempotency）**：同一个外部请求重复提交时，只产生一次效果。
- **结构化失败分类**：用稳定字段描述失败类型，而不是只保存一段错误字符串。

### 不应该负责

- 不直接写长期记忆。
- 不直接生成 Skill。
- 不直接更新 Profile。
- 不保存完整工具调用流水。
- 不承担自然语言复盘。
- 不做跨任务经验总结。

### 当前 outcome 字段

M3 已经用字段保存 Task 当前状态和最终结果。这里的 **outcome** 指任务最终结果，包括成功、失败、取消、失败类型和是否适合重试。

- `failure_type`：失败类型，例如 `model_error`、`tool_error`、`permission_denied`、`timeout`、`lease_expired`、`context_missing`。
- `failure_stage`：失败阶段，例如 `claim`、`prompt_build`、`model_call`、`tool_call`、`persist_result`。
- `retriable`：是否适合自动或手动重试。
- `progress_status`：运行中阶段，例如 `waiting`、`preparing`、`calling_model`、`using_tool`、`persisting_result`。
- `progress_message`：给 CLI、API 和控制台展示的中文短状态。
- `last_progress_at`：最后一次可观察进展时间。

## 3. Event

### 定位

Event 是运行时审计事实。它记录系统中真实发生过的动作。

Event 只回答：

- 什么时候发生了什么。
- 由哪个 Agent、Task、Conversation 触发。
- 关联了哪个工具、记忆、Skill 或渠道。
- 当时携带了什么结构化 payload。

专业术语说明：

- **审计**：保留可检查记录，用来说明系统在什么时候做了什么。
- **payload**：事件携带的结构化数据。

### 应该负责

- Task 生命周期事件。
- Tool 调用事件。
- Memory 读写事件。
- Skill 安装、启用、更新事件。
- Dream 运行事件。
- Profile 同步事件。
- Channel 收发事件。
- 调试和恢复需要的原始证据链。

### 不应该负责

- 不替代 Task 状态。
- 不替代 Episode 摘要。
- 不替代长期 Memory。
- 不存储大量正文快照，除非确实是审计必需。
- 不做业务判断。

### 写入规则

- 每个关键状态变化都应该写 Event。
- Event payload 应该结构化，便于后续查询。
- Event 允许冗余记录少量上下文，但不能成为另一个数据仓库。

## 4. Episode

### 定位

Episode 是一次任务经历摘要。它从 Task、Event、消息内容和最终结果中提炼出“这次经历是什么”。

Episode 主要回答：

- 这次任务的目标是什么。
- 实际做了哪些关键步骤。
- 使用了哪些关键工具。
- 结果是什么。
- 遇到了什么问题。
- 这次经历是否重要。

专业术语说明：

- **Episode**：情景记忆的一次经历摘要，类似“我记得那次做了什么”。
- **情景记忆**：关于具体经历的记忆，区别于事实记忆和方法记忆。

### 应该负责

- 成功 Task 的经历摘要。
- 失败 Task 的失败经历摘要。
- 取消 Task 的取消原因摘要。
- 工具使用概览。
- 涉及文件、关键决策和问题。
- 给 Dream 提供整理材料。
- 支持用户跨会话询问“刚才做了什么”“昨天做了什么”。

### 不应该负责

- 不负责 Task 调度。
- 不负责重试和恢复。
- 不直接写长期 Memory。
- 不直接更新 Profile。
- 不直接创建 Skill。
- 不保存完整事件流水。

### 与 Task 的关系

Task 是执行控制，Episode 是执行后的经历摘要。

```text
Task: 这件事现在是什么状态，能不能重试
Episode: 这件事整体发生了什么，有什么结果和经验
```

### 与 Event 的关系

Event 是原始事实，Episode 是摘要。

```text
Events: task.started, tool.called, task.completed, episode.created
Episode: 本次任务读取了哪些文件、修改了什么、最终完成了什么
```

### 建议增强方向

当前 Episode 已经存在，但后续应该增强：

- 支持 `failed` 和 `canceled` Task。
- 增加 `failure_type`、`failure_stage`。
- 增加 `steps` 或 `key_steps`。
- 增加 `reusable_lessons`，表示可复用经验。
- 增加 `memory_candidate`，表示是否值得后续整理成长期记忆。
- 增加 `skill_candidate`，表示是否值得后续整理成 Skill。

这些字段只是给 Dream 或人工复盘提供材料，不代表 Episode 自己直接写 Memory 或 Skill。

## 5. Memory

### 定位

Memory 是长期可用知识。它不应该保存所有发生过的事情，而应该保存未来还值得使用的信息。

Memory 主要回答：

- 用户长期偏好是什么。
- 项目长期事实是什么。
- 哪些经历值得以后召回。
- 哪些方法或原则值得记住。
- 有什么未来待办或提醒。

### 类型

建议长期保持这几类：

| 类型 | 含义 | 示例 |
|---|---|---|
| Semantic Memory | 事实记忆 | 项目默认端口是 3100 |
| Episodic Memory | 情景记忆 | 某天实现了 Codex hook 并同步模块文档 |
| Procedural Memory | 程序性记忆 | 修改模块代码后要同步模块文档和模块地图 |
| Prospective Memory | 前瞻记忆 | 后续要补 M4 Runtime 文档 |
| Reflective Memory | 反思记忆 | 远程 Skill 默认禁用更安全 |

专业术语说明：

- **Semantic Memory**：语义记忆，也就是事实知识。
- **Episodic Memory**：情景记忆，也就是具体经历。
- **Procedural Memory**：程序性记忆，也就是做事方法。
- **Prospective Memory**：前瞻记忆，也就是未来要做的事。
- **Reflective Memory**：反思记忆，也就是经验教训和原则。

### 应该负责

- 长期事实保存。
- 长期偏好保存。
- 重要经历保存。
- 未来计划保存。
- 方法和原则保存。
- 检索、召回、更新、遗忘、去重。

### 不应该负责

- 不保存每条原始消息。
- 不保存每个 Event。
- 不替代 Episode。
- 不控制 Task 执行。
- 不直接负责渠道收发。

### 写入入口

允许写 Memory 的流程应该很少：

1. Message-level Memory Extraction。
2. Memory 工具，例如用户明确要求“记住”。
3. Dream Worker 整理后产生的高置信记忆。
4. 未来的人工确认或审批流程。

不建议 Task、Channel、Runtime 直接写长期 Memory。

## 6. Message-level Memory Extraction

### 定位

Message-level Memory Extraction 是每条 assistant 消息保存后的实时记忆提取。

专业术语说明：

- **Message-level**：消息级，以单条消息为单位处理。
- **Extraction**：抽取，从文本中提取值得保存的信息。

### 应该负责

- 明确的用户偏好。
- 明确的项目事实。
- 明确的长期约束。
- 明确的待办。
- 用户或 Agent 的稳定认知更新。

### 不应该负责

- 不做完整任务复盘。
- 不生成 Task Episode。
- 不沉淀 Skill。
- 不替代 Dream。
- 不从一条消息里过度推断长期结论。

### 与 Episode 的关系

Message extraction 处理单条消息，Episode 处理完整 Task。

```text
消息里说：“以后命令行输出都用中文”
  -> Message extraction 可以写长期偏好

一次任务实现了 gateway、hook 或 skill 安装
  -> Episode 记录完整经历
  -> Dream 后续判断是否沉淀成长期记忆或 Skill
```

## 7. Dream

### 定位

Dream 是后台整理流程，不是数据类型，也不是执行单元。

Dream 主要回答：

- 最近发生的 Episode 中哪些值得长期记住。
- 哪些 Memory 重复了。
- 哪些 Memory 冲突了。
- 哪些经历体现了稳定偏好。
- 哪些重复做法值得沉淀成 Skill。
- 是否需要更新 Profile。

专业术语说明：

- **后台整理流程**：不阻塞当前对话和任务执行，通常定时或手动触发。
- **去重**：合并或停用重复信息。
- **冲突处理**：发现两个记忆互相矛盾时，保留更可信或更新的版本。

### 应该负责

- 消费 Episode。
- 消费已有 Memory。
- 生成每日摘要。
- 执行高置信去重。
- 执行高置信冲突更新。
- 从 Episode 生成长期 Memory。
- 给 Profile 同步提供依据。
- 未来可以生成 Skill 建议。

### 不应该负责

- 不创建 Task。
- 不执行用户实时请求。
- 不替代每条消息后的记忆提取。
- 不直接处理渠道协议。
- 不绕过审计写入大量不可解释变更。

### Dream 的写入原则

Dream 写入 Memory 或 Profile 时必须满足：

1. 有来源，例如 `episode_id`、`memory_id`、`dream_run_id`。
2. 有理由。
3. 有置信度。
4. 有 before / after 快照。
5. 可审计。
6. 不硬删除用户事实，只做 inactive 或 superseded。

专业术语说明：

- **before / after 快照**：修改前和修改后的数据副本，用于审计和回滚。
- **superseded**：被更新内容替代，但历史仍保留。

## 8. Skill

### 定位

Skill 是可复用方法。它描述某类任务以后应该怎么做。

Skill 主要回答：

- 遇到某类任务时应该按什么流程做。
- 有哪些约束。
- 应该用哪些工具。
- 输出应该长什么样。
- 有哪些常见坑。

### 应该负责

- 稳定操作流程。
- 领域任务方法。
- 工具使用规范。
- 输出格式规范。
- 项目内置或 Agent 自建的可复用能力。

### 不应该负责

- 不记录单次任务历史。
- 不保存用户偏好。
- 不保存原始事件。
- 不替代 Memory。
- 不替代 Profile。

### 与 Episode / Memory / Dream 的关系

```text
Episode: 某次任务怎么做了
Memory: 这次任务中哪些信息以后还值得记住
Dream: 多次经历里是否出现稳定模式
Skill: 稳定模式沉淀成可复用做法
```

Skill 最好由 Dream 或人工复盘提出建议，再由 Agent 或用户确认创建。

## 9. Profile

### 定位

Profile 是稳定画像。本项目里主要是：

- `soul.md`：Agent 对自己的稳定认知。
- `user.md`：Agent 对用户的稳定认知。

Profile 主要回答：

- 用户长期偏好是什么。
- Agent 的长期角色是什么。
- 项目中的长期协作原则是什么。
- 哪些高层约束应该进入每次执行上下文。

专业术语说明：

- **Profile**：稳定画像文件。这里指长期认知，不是头像或账号资料。
- **稳定认知**：相对长期不变、会影响后续行为的理解。

### 应该负责

- 用户长期偏好。
- Agent 自我定位。
- 高层行为原则。
- 长期协作方式。
- 少量重要项目约束。

### 不应该负责

- 不保存每次任务细节。
- 不保存工具调用流水。
- 不保存大量事实数据库。
- 不替代 Memory 检索。
- 不替代 Skill 流程。

### 写入规则

Profile 更新应该来自：

1. 高置信 Memory。
2. Dream 整理结果。
3. 用户明确要求。
4. 受控工具或 API。

不应该由 Task 或 Channel 直接写 Profile。

## 10. 数据写入权限表

| 数据 | 主要写入者 | 可以读取者 | 不建议写入者 |
|---|---|---|---|
| Task | Task Store / ChannelService / DelegationService | Runtime、API、Event、Episode | Memory、Dream、Skill |
| Event | 各业务模块通过 Event Log | 所有观察和整理模块 | 不应直接写 SQLite |
| Episode | Episode Store / Runtime 完成后触发 | Dream、Memory 查询、API | Channel、Tool、Skill |
| Memory | Memory Worker、Memory Tool、Dream | Prompt、Tools、Dream、Profile Sync | Task、Channel、Runtime 直接写 |
| Dream Run | Dream Worker / Scheduler | API、Event、Memory UI | Task、Channel |
| Skill | Skill Service / AgentConfigService | Prompt、Tools、Runtime | Memory Worker 直接写 |
| Profile | Profile Sync / AgentConfigService / 受控工具 | Prompt、Runtime、Agent 管理 API | Task、Channel、普通文件写工具 |

## 11. 典型流程

### 11.1 Web 对话

```text
用户发送消息
  -> 创建 Task
  -> Runtime 执行 Task
  -> 写 task/tool/message events
  -> assistant message persisted
  -> Message Memory Extraction 提取消息级长期信息
  -> Task completed
  -> Episode 生成经历摘要
  -> Dream 后台整理 Episode 和 Memory
```

### 11.2 外部渠道消息

```text
飞书 / 微信消息
  -> ChannelService 做身份映射和幂等判断
  -> 创建 Task
  -> Runtime 或 external runner 执行
  -> 结果回发渠道
  -> Event 记录完整链路
  -> Episode 记录任务经历
```

### 11.3 多 Agent 委派

```text
父 Agent 创建委派
  -> 子 Agent Task
  -> 子 Agent 单线程执行
  -> 子 Task 完成并生成 Episode
  -> 系统创建 callback Task 给父 Agent
  -> 父 Agent 整理结果
```

### 11.4 Dream 整理

```text
定时或手动触发 Dream
  -> 读取一批 Episode
  -> 读取 active Memory
  -> 生成 daily summary
  -> 去重和冲突处理
  -> 产生 memory_decisions
  -> 必要时同步 Profile
  -> 未来可产生 Skill 建议
```

## 12. 设计约束

后续开发必须遵守这些约束：

1. Task 状态是执行权威来源。
2. Event 是审计权威来源。
3. Episode 是任务经历权威来源。
4. Memory 是长期知识权威来源。
5. Dream 是整理流程，不是实时链路。
6. Skill 是可复用方法，不保存单次历史。
7. Profile 是稳定认知，不承载任务流水。
8. 任何跨层写入都必须有明确来源 id 和事件审计。
9. 不允许为了方便，把同一份信息同时写进多个权威来源。
10. 如果需要冗余展示字段，必须能追溯来源。

专业术语说明：

- **权威来源**：某类信息最终以哪个数据对象为准。
- **冗余展示字段**：为了前端或查询方便复制一份摘要，但它不应该成为真正的数据来源。

## 13. 对当前项目的落地建议

### M3 Task System

优先补：

- 结构化失败分类。
- 运行中进度状态。
- 更清晰的取消语义。
- 外部渠道幂等键全面接入。

不要在 M3 里新建长期记忆逻辑。

### M7 Memory System

优先补：

- Episode 支持 failed / canceled Task。
- Episode 增强 key steps、failure、lessons 字段。
- Dream 消费 Episode 的规则更明确。
- Memory 来源字段更标准，例如 `source_type`、`task_id`、`episode_id`、`message_id`、`dream_run_id`。

### M9 Skill System

优先补：

- Skill 建议机制。
- 从多次 Episode 或 Dream decision 中识别可复用流程。
- 创建 Skill 前的审批或人工确认。

### M8 Profile System

优先补：

- Profile 更新审计。
- 从 Dream decision 到 Profile sync 的明确规则。
- 用户可编辑区和系统维护区。

## 14. 判断一条信息该放哪里的规则

开发时可以用下面的问题判断：

1. 它是在控制当前任务执行吗？
   - 是：放 Task。

2. 它是在记录某个时间点真实发生的动作吗？
   - 是：放 Event。

3. 它是在总结一次完整任务经历吗？
   - 是：放 Episode。

4. 它以后还值得被召回使用吗？
   - 是：放 Memory。

5. 它是在整理一批经历或记忆吗？
   - 是：由 Dream 产生 decision。

6. 它是在描述某类任务以后怎么做吗？
   - 是：放 Skill。

7. 它是在描述用户或 Agent 的长期稳定认知吗？
   - 是：放 Profile。

如果一条信息同时像多个类型，优先按“最原始的权威来源”保存，再由上层整理流程生成衍生产物。

专业术语说明：

- **衍生产物**：从原始数据加工出来的结果，例如从 Event 生成 Episode，从 Episode 生成 Memory。
