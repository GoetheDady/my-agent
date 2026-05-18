# M7 Memory System

本文档记录 Memory System 的模块边界。以后修改 `src/memory/`、记忆相关生命周期 hook、记忆工具或 episode 结构时，需要同步更新本文档和 `docs/project-module-map.md`。

专业术语说明：

- **Memory System**：记忆系统。这里指长期事实记忆、经历摘要、记忆整理和记忆检索的后端能力。
- **Episode**：情景记忆。这里指一次 Task 结束后生成的经历摘要，记录做了什么、结果如何、用过哪些工具、遇到哪些问题。
- **Deduplication**：去重。这里指发现相似记忆后保留更可信的一条，并把重复项标记为非活跃。
- **Reconstruction / Reconsolidation**：再巩固。这里指根据新信息重新整理已有记忆，使旧记忆和新事实保持一致。

## 1. 模块定位

Memory System 负责让 Agent 把重要事实、用户偏好、任务经历和后续计划沉淀下来，并在后续任务中按需找回。

它应该负责：

- 写入、搜索、更新和遗忘长期记忆。
- 在 assistant message persisted 生命周期事件后触发记忆提取。
- 对相似记忆做去重和再巩固。
- 为终态 Task 生成或更新 episode。
- 记录 memory、episode、dedupe 和 reconsolidate 相关审计事件。

它不应该负责：

- 直接调度 Task。
- 直接写 Agent 配置。
- 处理外部渠道协议。
- 替代 Skill System 保存可复用工作方法。

## 2. 当前相关代码

```text
src/memory/
src/memory/extraction/
src/memory/dream/
src/memory/storage/
src/memory/tools/
src/memory/episode-store.ts
```

## 3. 当前状态

当前 Memory System 已支持：

- LanceDB 向量检索和 TF-IDF 文本检索。
- 长期记忆的写入、搜索、更新和遗忘。
- assistant message persisted 后自动触发记忆提取。
- 记忆提取 worker 注入 `memory_extract` / `memory_reconsolidate` 工具片段。
- 主动去重：保留高置信度记忆，并停用重复记忆。
- Dream Worker：按运行记录做每日整理和反思。
- Dream Worker real-run 会从重复出现的高质量 episode 生成正式 Skill candidate，并保留旧 review item 兼容层。
- Episode v1：终态 Task 可生成经历摘要，并写入 `episode.created` / `episode.updated` / `episode.failed` 事件。
- Episode 会从任务事件流提取工具使用和关键步骤，包括 `tool.call` / `tool.result` 中的工具名。
- Episode 会从 Task Plan / Dependency 事件提取关键步骤，例如计划步骤、步骤状态、依赖阻塞和子任务创建。
- Prospective memory 基础工具能力，用于记录未来计划或待办。
- `memory_review_items` 兼容层支持 `skill_candidate` 类型，供 Skill System 把高质量 episode 转成待审查 Skill 候选。
- `skill_candidates` 正式候选表用于承载 Skill 闭环中的候选、审查和转正流程。

本轮改动对 Memory System 的影响：

- Episode 记录现在保存 task 派生状态，包括 `task_status`、`attempt_count`、`failure_type`、`failure_stage` 和 `retriable`。
- Episode 记录新增 `key_steps`，用于表达一次任务经历里的关键步骤。
- 新增工具审计事实后，Episode 的 `tools_used` 和 `key_steps` 以 `tool.call` / `tool.result` 为主要来源提取工具链路。
- Episode 搜索参数扩展了 `taskId`、`taskStatus` 和 `failureType`，为按任务结果或失败类型回看经历打基础。
- Runtime 启动时会为缺失或状态过期的终态 task 补齐/刷新 episode，保证 retry 后仍维护同一条 episode。
- 数据库 schema 已在 Core Runtime 初始化阶段补齐兼容迁移，老数据会获得默认值。
- Task timeline API 会读取 `getEpisodeByTaskId()`，把 Episode 作为终态经历摘要展示；Episode 不是新的事实源，完整执行链路仍由 Event 提供。
- Task Plan / Dependency v1 不新增 Episode 字段；经历摘要继续写入 `key_steps`、`problems` 和 `source_event_ids`。

本轮 P0 数据备份对 Memory System 的影响：

- `GET /api/runtime/export` 会返回结构化 SQLite 元数据，但当前不导出 LanceDB 向量内容；响应中的 `memories` 只保留数量占位和说明。
- SQLite 热备份可以覆盖 episodes、memory review items、dream runs、memory decisions 等 SQLite 表，但长期记忆正文和 embedding 仍在 LanceDB 目录中。
- 因此当前 P0 只解决 SQLite 侧备份与迁移素材导出，完整 Memory 恢复还需要把 `.my-agent/memories.lancedb/` 纳入统一备份包。

本轮类型边界修复对 Memory System 的影响：

- `MemoryReviewType` 增加 `skill_candidate`，使 `src/skills/candidates.ts` 中已有的 Skill 候选 review item 逻辑和类型声明一致。
- 这只是类型声明补齐，不改变 `memory_review_items` 表结构；`type` 字段仍是 TEXT，旧数据兼容。

本轮 P1 Memory → Skill 闭环对 Memory System 的影响：

- Dream Worker 在每日整理 real-run 中会读取近期高质量 episode，并调用 Skill System 生成正式 `skill_candidates` 记录。
- Memory System 只提供 episode 素材和整理触发点，不直接创建正式 Skill；候选保存、审查和转正仍属于 Skill System。
- 这让 procedural memory，也就是“做事方法记忆”，开始通过 Skill candidate 进入受控审查流程，而不是把一次经历直接写成长期 Skill。

## 4. 后续需要补齐

- Episode 摘要需要更稳定地区分成功、失败、取消和可重试失败。
- Episode 与长期事实记忆的边界需要继续清晰化：经历摘要不应直接变成稳定事实。
- 记忆冲突处理策略需要更明确，例如同一用户偏好发生变化时如何保留证据链。
- 记忆导出、备份和恢复能力需要补齐：SQLite 元数据已有备份/导出基础，LanceDB 向量库和恢复流程仍未完成。
- Memory → Skill candidate 的质量指标还需要补齐，例如重复模式命中率、候选接受率和误报率。
- 记忆质量评估需要可观察指标，例如命中率、重复率和用户纠正率。
