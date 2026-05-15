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
- Episode v1：终态 Task 可生成经历摘要，并写入 `episode.created` / `episode.updated` / `episode.failed` 事件。
- Prospective memory 基础工具能力，用于记录未来计划或待办。

本轮改动对 Memory System 的影响：

- Episode 记录现在保存 task 派生状态，包括 `task_status`、`attempt_count`、`failure_type`、`failure_stage` 和 `retriable`。
- Episode 记录新增 `key_steps`，用于表达一次任务经历里的关键步骤。
- Episode 搜索参数扩展了 `taskId`、`taskStatus` 和 `failureType`，为按任务结果或失败类型回看经历打基础。
- Runtime 启动时会为缺失或状态过期的终态 task 补齐/刷新 episode，保证 retry 后仍维护同一条 episode。
- 数据库 schema 已在 Core Runtime 初始化阶段补齐兼容迁移，老数据会获得默认值。

## 4. 后续需要补齐

- Episode 摘要需要更稳定地区分成功、失败、取消和可重试失败。
- Episode 与长期事实记忆的边界需要继续清晰化：经历摘要不应直接变成稳定事实。
- 记忆冲突处理策略需要更明确，例如同一用户偏好发生变化时如何保留证据链。
- 记忆导出、备份和恢复能力需要补齐。
- 记忆质量评估需要可观察指标，例如命中率、重复率和用户纠正率。
