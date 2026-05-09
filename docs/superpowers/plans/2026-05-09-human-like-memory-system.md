# 类人记忆系统改造计划

## 目标

把当前“长期事实记忆”升级为类人记忆系统。类人记忆不是只回答“上午/昨天做了什么”，而是能跨会话回忆经历、保持未来计划、总结做事方法、追溯证据、处理偏好变化。

## 记忆分层

- `working`: 当前任务中的临时状态。
- `episodic`: 某次经历、任务、对话、工具调用的摘要。
- `semantic`: 稳定事实、偏好、项目知识。
- `procedural`: 做事方法和流程经验。
- `prospective`: 未来计划、待办、提醒意图。
- `reflective`: 复盘、教训、风险模式。
- `social`: 用户沟通习惯、审美偏好、协作方式。
- `identity`: Agent 对自身角色、能力边界、长期目标的理解。

## 进度看板

| Task | Name | Status | Last Updated |
| --- | --- | --- | --- |
| 1 | Plan document | Done | 2026-05-09 |
| 2 | Schema foundation | Done | 2026-05-09 |
| 3 | Memory router v1 | Done | 2026-05-09 |
| 4 | Episode v1 | Done | 2026-05-09 |
| 5 | Prospective v1 | Done | 2026-05-09 |
| 6 | Procedural / reflective v1 | Partial | 2026-05-09 |
| 7 | Dream worker v1 | Partial | 2026-05-09 |
| 8 | Light UI | Done | 2026-05-09 |
| 9 | Chrome DevTools MCP acceptance matrix | Documented | 2026-05-09 |

## 关键架构

- `events` 是原始事实来源。
- `episodes` 是从 task/events/messages 派生出的情景记忆。
- LanceDB active memories 继续承载 semantic/procedural/prospective/reflective/social 记忆。
- `memory_recall` 是主 Agent 优先使用的统一回忆入口。
- `dream_worker` 只自动执行低风险整理；高风险改写生成 review item。
- 长期记忆仍坚持 Memory-as-Tool，不自动注入 prompt。

## 已落地范围

- 新增 SQLite 表：
  - `episodes`：情景记忆，记录一次任务/对话经历摘要。
  - `daily_summaries`：每日总结，保存梦整理生成的日摘要。
  - `memory_review_items`：待审查建议，承载高风险记忆变更。
- 新增 Runtime 事件：
  - `episode.created`
  - `episode.updated`
  - `episode.failed`
  - `dream.started`
  - `dream.completed`
  - `dream.failed`
  - `memory.review.created`
  - `memory.review.accepted`
  - `memory.review.rejected`
- 新增统一记忆工具：
  - `memory_recall`：统一回忆入口。
  - `memory_remember`：写入类人记忆。
  - `memory_plan`：管理未来计划和待办。
  - `memory_evidence`：查看记忆或 episode 的证据来源。
  - `memory_reflect`：生成程序记忆/反思记忆的待审查建议。
- task 完成后自动生成 episode。
- `memory_recall` 支持按 intent 回忆 semantic、episodic、procedural、prospective、reflective、social。
- dream worker 支持手动 dry-run、每日摘要、确定性去重和串行执行。
- Memory Panel 增加长期记忆、经历、待审查、梦整理四个视图。
- Runtime Panel 增加 episode、dream、review 事件中文展示。

## 未完成范围

- dream worker 还没有接入每日 `03:30 Asia/Shanghai` 自动调度。
- memory strength 强化/衰减还没有落库到 active memory metadata。
- repeated episodes 自动提炼 procedural / reflective review item 还只是后续任务。
- review item 接受后目前只更新审查状态，复杂合并/冲突应用仍需要下一阶段实现。
- Chrome DevTools MCP 验收矩阵已经写入文档，但还没有完整自动执行。

## 验收反馈记录

### 2026-05-09 Chrome DevTools MCP 验收

验收报告：

`docs/superpowers/specs/2026-05-09-human-like-memory-acceptance-report.md`

定向回归测试：

`docs/superpowers/specs/2026-05-09-human-like-memory-regression-test.md`

定向回归报告：

`docs/superpowers/specs/2026-05-09-human-like-memory-regression-report.md`

结论：

- 8 条必达标准全部满足。
- Case 7 `Conflict / Reconsolidation` 为 Partial。
- 问题原因：`social` 记忆在写入时映射为 `preference`，但 `memory_recall` 读取时错误查询 `social` 类型；同时对“我现在喜欢什么”这类自然语言问题使用整句 search 过滤，导致已存在的偏好变化记忆没有被召回。
- 已修复：`memory_recall` 的 social intent 现在读取 `preference/social` 两类 active memory，并对偏好变化信号做本地重排，优先返回包含“曾经/现在/改为/不喜欢”等变化轨迹的记忆。
- 已补测试：`memoryRecall maps social intent to preference memories and ranks change traces first`。
- 回归结论：R1 偏好变化召回和 R2 证据链追问均通过，上一轮 P2 已关闭；R3 未来计划补测通过。
- 遗留问题：R1 出现 P3 级别小偏差，把“喜欢黄瓜”和旧记忆“西红柿炒鸡蛋”组合成“黄瓜炒鸡蛋”。这属于召回/表达质量问题，不影响当前修复合并，后续可在记忆冲突合并和回答生成约束中优化。

## 实施任务

### Task 1: Schema Foundation

- 扩展 SQLite schema：
  - `episodes`
  - `daily_summaries`
  - `memory_review_items`
- 保持现有 LanceDB memory 表兼容，不做破坏性迁移。
- Runtime event type 增加 episode、dream、review 事件。

### Task 2: Memory Router v1

- 新增 `memory_recall`，按 intent 查询 semantic、episodic、procedural、prospective、reflective、social。
- 新增 `memory_plan`，用于创建、列出、完成 prospective memory。
- 新增 `memory_evidence`，用于查看记忆或 episode 的证据。
- 更新 prompt：遇到经历、偏好、计划、做法、风险复盘、证据追问时必须查记忆工具。

### Task 3: Episode v1

- task 完成后生成或更新 episode。
- 同一个 task 只保留一个 episode。
- Episode 生成不阻塞主回复。
- 支持按关键词和时间范围搜索 episode。

### Task 4: Prospective v1

- 支持未来计划、待办、提醒意图的写入、查询和完成。
- 第一阶段不做系统级通知。

### Task 5: Procedural / Reflective v1

- dream worker 从 repeated episodes 生成 procedural / reflective review item。
- 不自动写 active memory。

### Task 6: Dream Worker v1

- 默认每天 `03:30 Asia/Shanghai` 运行。
- 支持手动 dry-run。
- 串行运行。
- 自动执行：
  - daily summary
  - deterministic dedupe
  - memory strength reinforcement / decay
- 高风险操作生成 review item。

### Task 7: Light UI

- Memory Panel 增加：
  - kind 过滤
  - episodes
  - prospective 待办
  - review items
  - dream dry-run
- Runtime Panel 展示新增事件。

## Chrome DevTools MCP Acceptance Matrix

所有测试都必须使用 Chrome DevTools MCP 操作真实前端页面，且必须跨会话、刷新、重开页面验证。

完整验收步骤见：

`docs/superpowers/specs/2026-05-09-human-like-memory-chrome-devtools-acceptance.md`

1. Semantic Memory 跨会话回忆。
2. Episodic Memory 跨会话回忆。
3. Refresh 后仍可回忆。
4. Prospective Memory 未来计划。
5. Procedural Memory 做事方法。
6. Reflective Memory 风险复盘。
7. Conflict / Reconsolidation。
8. Evidence Chain 证据追问。
9. Dream Worker Dry-run。
10. Review Item 审批。
11. Negative Case 防编造。
12. UI / Network / Console 基础健康。

## Verification

```bash
bun test
bun run typecheck
bun run lint
cd web && bun run build
```

## Assumptions

- 第一阶段只实现 `default` agent，但所有结构保留 `agent_id`。
- 相对时间默认按 `Asia/Shanghai` 解析。
- 自动写入只允许低风险内容。
- 冲突、抽象总结、行为模式提炼默认进入 review item。
- 完整通知系统不在本阶段。
