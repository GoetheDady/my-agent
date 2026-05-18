# M9 Skill System

本文档记录 Skill System 的模块边界。以后修改 `src/skills/`、Skill 元数据、Skill 工具、Skill 候选或 Skill 使用统计时，需要同步更新本文档和 `docs/project-module-map.md`。

专业术语说明：

- **Skill**：Agent 可复用的方法说明，通常存放在 `SKILL.md`，用于指导以后怎么做一类任务。
- **Provenance**：来源信息。这里指 Skill 从哪个 task、episode 或事件沉淀而来，以及为什么创建。
- **Usage Stats**：使用统计。这里指 Skill 在哪些 task 中使用过，成功/失败次数和最近使用时间。
- **Skill Candidate**：Skill 候选建议。它不是正式 Skill，而是 `skill_candidates` 表中的待审查记录；旧的 review item 仍作为兼容层保留。

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
├── skill-markdown.ts
├── skill-fs.ts
├── candidate-store.ts
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
- `src/skills/candidate-store.ts` 提供正式的 `skill_candidates` 表读写；`src/skills/candidates.ts` 会在生成 Skill 候选时同步写正式表和兼容 review item。

本轮模块拆分重构对 Skill System 的影响：

- `src/skills/skill-markdown.ts` 承接了 `parseSkillMarkdown()`、`buildSkillMarkdown()` 和 `buildFrontmatter()`。这部分主要处理 Skill Markdown 的前置元数据，也就是 frontmatter；frontmatter 指写在 Markdown 顶部、用来保存结构化字段的头部区块。
- `src/skills/skill-fs.ts` 承接了远程 Skill 拉取和目录替换相关的文件系统逻辑，包括 `defaultRemoteSkillFetcher()`、`copyDirectoryExcludingGit()`、`replaceDirectoryAtomically()` 以及相关类型导出。
- `src/skills/service.ts` 现在更聚焦于 Skill 生命周期编排：读取 Agent config 元数据、调度 Markdown 解析、执行远程安装流程和写审计事件。
- 对外 API 保持不变，`service.ts` 继续通过 `export type { ... } from "./skill-fs"` 暴露远程安装相关类型，因此调用方不需要调整 import。
- 这次拆分把“Markdown 解析规则”“文件系统副作用”“业务编排”分成了三个层次，后续如果要替换远程源、增强 Markdown schema 或增加 dry-run 安装，都更容易局部修改和测试。

本轮 P4 Skill 沉淀闭环 v1 改动：

- `SkillMetadata` 新增可选 `provenance`，记录来源 task、episode、source events、创建原因和创建者。
- `SkillMetadata` 新增可选 `usage`，记录成功次数、失败次数、最近使用时间和关联 task ids。
- `SkillService.createSkill()` 支持写入 provenance，并为新建 agent-created / remote skill 初始化 usage。
- `SkillService.recordSkillOutcome()` 可以为 agent-created Skill 记录一次成功或失败使用结果，并写 `skill.usage.recorded` 审计事件。
- `memory_review_items.type` 新增 `skill_candidate`，用于保存 Skill 候选建议。
- 新增 `src/skills/candidates.ts`：从已完成、无明显问题、重要性足够的 Episode 生成 Skill candidate review item。
- Dream Worker 会在 real-run 后为当天高质量 Episode 创建 Skill candidate；它只创建 review item，不直接创建或改写 Skill。
- `createSkillCandidatesFromEpisodes()` 支持按时间窗口批量生成候选，并在创建前检查 pending 候选，避免重复堆积。

本轮 P1 Memory → Skill 闭环正式化改动：

- `skill_candidates` 成为正式候选表，保存候选名称、描述、内容、来源 episode、审查状态和审查备注。
- Skill candidate 路由支持列出 pending 候选、接受后转正式 Skill、拒绝后保留审查记录。
- Dream Worker real-run 会从近期高质量 episode 聚类生成正式 Skill candidate，并继续保留 review item 兼容层，方便旧 UI 或旧流程读取。
- 候选生成默认要求重复出现的高质量 episode，避免把单次偶发经历误写成正式 Skill。

本轮 P3 远程 Skill 内容哈希改动：

- 远程安装和远程更新都会计算目录内容哈希 `contentHash`，并保存在远程 Skill origin 中。
- 更新时如果内容哈希未变，则视为内容未变化并跳过更新；如果内容哈希变化，则写入 `skill.content.changed` 审计事件。
- 这让远程 Skill 的变更审计不只依赖 commit，也能直接反映实际文件内容差异。

## 4. 关键边界

- Skill 是“反复有效的方法”，不是普通任务日志。
- Episode 是经历摘要；Skill candidate 是从经历中提出的建议；正式 Skill 仍需要受控创建或用户审批。
- 失败 episode 可以进入 Memory evidence 和问题复盘，但不会直接生成 Skill candidate。
- 候选生成只做筛选和去重，不负责审查、接收或写入正式 Skill 内容。
- `skill_candidates` 是候选审查状态的正式来源；`memory_review_items.skill_candidate` 只作为旧流程兼容，不再作为新的唯一配置源。
- provenance / usage 保存在 Agent config 的 Skill 元数据里，不新增数据库表。
- usage v1 只记录 Skill outcome，不代表模型一定遵守了 Skill；后续需要结合 prompt/tool audit 做更强证据链。

## 5. 后续需要补齐

- Skill candidate 的 UI 审查体验可以继续打磨，但核心闭环已经有正式表和 API。
- Skill 内容 diff 和远程更新风险审批还可以再细化，例如展示更具体的文件差异。
- 相似 Skill 合并建议，避免重复创建。
- Skill 使用统计自动化：从 `skill_view`、任务结果和 episode 证据自动判断成功/失败。
- Skill 效果评估：对同类任务是否缩短耗时、减少失败、提高可复用性。
