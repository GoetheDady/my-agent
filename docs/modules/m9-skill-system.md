# M9 Skill System

本文档记录 Skill System 的模块边界。以后修改 `src/skills/`、Skill 元数据、Skill 工具、Skill 候选或 Skill 使用统计时，需要同步更新本文档和 `docs/project-module-map.md`。

专业术语说明：

- **Skill**：Agent 可复用的方法说明，通常存放在 `SKILL.md`，用于指导以后怎么做一类任务。
- **Provenance**：来源信息。这里指 Skill 从哪个 task、episode 或事件沉淀而来，以及为什么创建。
- **Usage Stats**：使用统计。这里指 Skill 在哪些 task 中使用过，成功/失败次数和最近使用时间。
- **Skill Candidate**：Skill 候选建议。它不是正式 Skill，而是一条待审查 review item。

## 1. 模块定位

Skill System 负责保存、读取、安装、更新和审查 Agent 的可复用方法。

它应该负责：

- 管理 Agent-scoped Skill 元数据和 `SKILL.md` 文件。
- 读取内置 Skill、Agent 创建 Skill 和远程安装 Skill。
- 保存 Skill 的启用状态、来源、使用统计和审计事件。
- 从高质量 Episode / Dream 整理结果中生成 Skill 候选建议。
- 保持受控创建：候选建议不等于自动写 Skill。

它不应该负责：

- 直接调度 Task。
- 直接生成 Episode。
- 把失败或噪音经历自动写成 Skill。
- 绕过 AgentConfigService 直接写 `agent.json`。

## 2. 当前相关代码

```text
src/skills/
├── service.ts
├── skill-types.ts
├── candidates.ts
├── tools.ts
└── *.test.ts
```

相关模块：

```text
src/agents/config-service.ts
src/memory/review-store.ts
src/memory/dream/worker.ts
```

## 3. 当前状态

当前 Skill System 已支持：

- 内置 Skill：从项目 `skills/builtin/` 只读加载。
- Agent-created Skill：写入 `.my-agent/agents/<agentId>/skills/<skillId>/SKILL.md`。
- Remote-installed Skill：从 GitHub 安装并保存远程 origin。
- Skill 元数据保存在 Agent-scoped `agent.json`，由 `AgentConfigService` 统一读写。
- Skill index 注入 prompt，模型需要全文时再调用 `skill_view`。
- Skill 创建、启用、停用、安装、远程更新、读取会写入 `skill.*` 审计事件。

本轮 P4 Skill 沉淀闭环 v1 改动：

- `SkillMetadata` 新增可选 `provenance`，记录来源 task、episode、source events、创建原因和创建者。
- `SkillMetadata` 新增可选 `usage`，记录成功次数、失败次数、最近使用时间和关联 task ids。
- `SkillService.createSkill()` 支持写入 provenance，并为新建 agent-created / remote skill 初始化 usage。
- `SkillService.recordSkillOutcome()` 可以为 agent-created Skill 记录一次成功或失败使用结果，并写 `skill.usage.recorded` 审计事件。
- `memory_review_items.type` 新增 `skill_candidate`，用于保存 Skill 候选建议。
- 新增 `src/skills/candidates.ts`：从已完成、无明显问题、重要性足够的 Episode 生成 Skill candidate review item。
- Dream Worker 会在 real-run 后为当天高质量 Episode 创建 Skill candidate；它只创建 review item，不直接创建或改写 Skill。
- `createSkillCandidatesFromEpisodes()` 支持按时间窗口批量生成候选，并在创建前检查 pending 候选，避免重复堆积。

## 4. 关键边界

- Skill 是“反复有效的方法”，不是普通任务日志。
- Episode 是经历摘要；Skill candidate 是从经历中提出的建议；正式 Skill 仍需要受控创建或用户审批。
- 失败 episode 可以进入 Memory evidence 和问题复盘，但不会直接生成 Skill candidate。
- 候选生成只做筛选和去重，不负责审查、接收或写入正式 Skill 内容。
- provenance / usage 保存在 Agent config 的 Skill 元数据里，不新增数据库表。
- usage v1 只记录 Skill outcome，不代表模型一定遵守了 Skill；后续需要结合 prompt/tool audit 做更强证据链。

## 5. 后续需要补齐

- Skill candidate 的 UI 审查、接受、拒绝和转正式 Skill 流程。
- Skill 内容 diff 和远程更新风险审批。
- 相似 Skill 合并建议，避免重复创建。
- Skill 使用统计自动化：从 `skill_view`、任务结果和 episode 证据自动判断成功/失败。
- Skill 效果评估：对同类任务是否缩短耗时、减少失败、提高可复用性。
