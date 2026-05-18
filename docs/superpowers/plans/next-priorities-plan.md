# my-agent 下一阶段实现方案

> 排除渠道扩展后的核心开发优先级。目标：让 Agent 数据安全、能从经验中自动沉淀 Skill、能自主规划复杂任务。
> 本文是设计方案，不是执行记录。

---

## 总览

| 优先级 | 模块 | 目标 | 预估工时 |
|--------|------|------|----------|
| P0 | 数据备份 (M14) | 数据不丢，可恢复 | 2-3天 |
| P1 | Memory → Skill 闭环 (M7+M9) | Agent 越用越好 | 5-7天 |
| P2 | Task 自动规划 (M3) | 复杂任务自主拆解 | 3-5天 |
| P3 | 远程 Skill 内容哈希 (M13) | 供应链安全 | 1-2天 |

---

## P0：数据备份

### 问题

SQLite + LanceDB 没有任何恢复手段。数据库损坏或误操作后，所有记忆、Episode、Skill 配置、事件历史全部丢失。

### 方案

#### 新增文件

```
src/core/backup.ts              ← 备份逻辑
src/core/backup.test.ts         ← 测试
```

#### 修改文件

```
src/routes/runtime.ts           ← 新增 backup/export 路由
```

#### backup.ts 设计

```typescript
interface BackupResult {
  path: string;
  size: number;
  createdAt: number;
}

interface DatabaseExport {
  version: number;
  exportedAt: number;
  agents: AgentRecord[];
  tasks: TaskRecord[];
  sessions: SessionRecord[];
  memories: { count: number; note: string };  // 记忆只导出元数据，向量数据太大
}

// SQLite 热备份（使用 Bun 的 .backup() API，不锁表）
export async function backupDatabase(targetPath: string): Promise<BackupResult>

// JSON 导出（结构化元数据，用于跨版本迁移）
export function exportDatabaseJson(database: Database): DatabaseExport

// 清理旧备份（保留最近 N 个）
export function pruneBackups(backupDir: string, keepCount?: number): void
```

#### 路由设计

```
POST /api/runtime/backup        → 触发热备份到 {dataDir}/backups/agent-{timestamp}.sqlite
GET  /api/runtime/export        → 返回 JSON 导出
GET  /api/runtime/backups       → 列出已有备份文件
```

#### 自动备份（可选）

在 `src/main.ts` 启动时检查上次备份时间，超过 24 小时则自动备份一次。

#### 验证

- 调用 `POST /api/runtime/backup`，检查 `backups/` 目录有新 `.sqlite` 文件
- 新文件可被 `new Database(path)` 打开且表结构完整
- 备份超过 5 个时，最旧的被自动删除
- `GET /api/runtime/export` 返回包含 agents/tasks/sessions 的 JSON

---

## P1：Memory → Skill 沉淀闭环

### 问题

当前链路：Task 完成 → Episode 生成 → 结束。缺少：从 Episode 中识别可复用模式 → 生成 Skill candidate → 用户审查 → 转正式 Skill。这是"Agent 越用越好"的核心闭环。

### 当前已有

- `src/skills/candidates.ts`：已有 `generateSkillCandidate()` 基础能力
- `src/memory/episode-store.ts`：Episode 包含 `tools_used`、`key_steps`、`outcome`
- Dream Worker：已有后台整理调度器

### 方案

#### 阶段 1：Skill Candidate 生成管线

**新增文件**

```
src/skills/candidate-pipeline.ts       ← 从 Episode 生成 Skill candidate
src/skills/candidate-pipeline.test.ts  ← 测试
```

**设计**

```typescript
interface SkillCandidateInput {
  agentId: string;
  episodes: EpisodeRecord[];       // 最近 N 个相似 Episode
  existingSkills: SkillRecord[];   // 避免重复
}

interface SkillCandidateOutput {
  shouldCreate: boolean;
  reason: string;
  candidate?: {
    name: string;
    description: string;
    category: string;
    content: string;               // SKILL.md 正文
    sourceEpisodeIds: string[];
  };
}

// 调用模型判断是否值得沉淀 Skill
export async function evaluateSkillCandidate(input: SkillCandidateInput): Promise<SkillCandidateOutput>
```

**触发时机**

在 Dream Worker 的每日整理中，扫描最近完成的 Episode：
1. 按 `tools_used` 和 `key_steps` 聚类相似 Episode
2. 同一模式出现 ≥ 2 次时，调用 `evaluateSkillCandidate`
3. 生成的 candidate 写入 `skill_candidates` 表（新表）

#### 阶段 2：Candidate 审查流程

**新增文件**

```
src/skills/candidate-store.ts          ← candidate CRUD
src/skills/candidate-store.test.ts
```

**数据库新表**

```sql
CREATE TABLE IF NOT EXISTS skill_candidates (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  content TEXT NOT NULL,
  source_episode_ids TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | accepted | rejected
  created_at INTEGER NOT NULL,
  reviewed_at INTEGER,
  review_note TEXT
);
```

**路由**

```
GET    /api/skills/candidates              → 列出 pending candidates
POST   /api/skills/candidates/:id/accept   → 转为正式 Skill（调用 SkillService.createSkill）
POST   /api/skills/candidates/:id/reject   → 标记为 rejected
```

**事件**

- `skill.candidate.created`
- `skill.candidate.accepted`
- `skill.candidate.rejected`

#### 阶段 3：去重与相似检测

复用 `src/skills/candidates.ts` 中已有的去重逻辑：
- 新 candidate 生成前，与已有 Skill 做语义相似度比较
- 相似度 > 0.85 时跳过，避免重复

#### 验证

- 手动创建 2 个相似 Episode，触发 Dream Worker，检查 `skill_candidates` 表有新记录
- 调用 `POST /api/skills/candidates/:id/accept`，检查 Skill 被正式创建
- 已有相似 Skill 时，不重复生成 candidate

---

## P2：Task 自动规划

### 问题

目前复杂任务需要 Agent 手动调用 `task_plan_set` 写计划。缺少：模型在识别到复杂任务时自动决定是否拆分步骤/子任务。

### 当前已有

- `src/tasks/task-plan-store.ts`：Plan/Step/Dependency 完整 schema
- `src/tasks/task-tools.ts`：`task_plan_set`、`task_step_update`、`task_child_create` 工具
- `src/prompts/`：system prompt 中已有 planning 指引

### 方案

#### 核心思路

不引入独立的"规划 Agent"，而是在 system prompt 中增强 planning 指引，让模型在第一轮输出时自主判断是否需要拆分。

**修改文件**

```
src/prompts/system-prompt-builder.ts   ← 增强 planning 指引
src/prompts/planning-guide.ts          ← 新增：planning 决策模板
```

#### planning-guide.ts 设计

```typescript
export function buildPlanningGuide(taskInput: string, context: {
  hasParentTask: boolean;
  availableTools: string[];
  recentEpisodes: string[];  // 相关经历摘要
}): string
```

输出一段 prompt 片段，告诉模型：
1. 判断标准：输入超过 N 个步骤、涉及多个工具组、需要中间验证 → 应该先写计划
2. 写计划的格式：调用 `task_plan_set` 写步骤，每步标注预期输出
3. 何时创建子任务：步骤可独立执行且结果可合并时

#### 自动触发条件

在 `src/runtime/agent-runtime.ts` 的 `runAgentTask()` 中：
- 如果 task.input 长度 > 200 字符 且 没有 parent_task_id → 注入 planning guide
- 如果 task 已有 plan steps → 不重复注入

#### 验证

- 发送一个复杂任务（如"分析项目中所有 TODO 并按优先级分类"），检查 Agent 是否自动写了 plan
- 简单任务（如"查看当前时间"）不触发 planning
- 已有 plan 的 task 不重复注入 guide

---

## P3：远程 Skill 内容哈希

### 问题

远程 Skill 安装后无法验证内容完整性，更新时无变更审计。

### 方案

#### 修改文件

```
src/skills/skill-fs.ts           ← 增加 computeDirectoryHash()，返回 contentHash
src/skills/service.ts            ← installSkill/updateSkill 写入和比较 contentHash
src/skills/skill-types.ts        ← SkillOrigin 增加 contentHash 字段
```

#### computeDirectoryHash 设计

```typescript
// 对目录内所有文件按路径排序，拼接内容后计算 SHA-256
export function computeDirectoryHash(directory: string): string
```

#### 流程变更

**安装时**：
1. `defaultRemoteSkillFetcher` 返回结果增加 `contentHash`
2. `installSkill()` 将 `contentHash` 写入 `origin` 字段

**更新时**：
1. 拉取新内容，计算新 `contentHash`
2. 与旧 `origin.contentHash` 比较
3. 若不同：更新 origin，发送 `skill.content.changed` 事件（payload 含旧哈希和新哈希）
4. 若相同：返回 `changed: false`（已有逻辑，基于 commit 判断）

#### SkillOrigin 类型变更

```typescript
interface RemoteInstalledOrigin {
  // ... 现有字段
  contentHash?: string;  // SHA-256，可选（兼容旧数据）
}
```

#### 验证

- 安装远程 Skill 后，`agent.json` 的 `origin.contentHash` 非空
- 更新 Skill 且内容变化时，事件表中有 `skill.content.changed` 记录
- 更新 Skill 但内容未变时，不触发事件

---

## 执行顺序建议

```
P0 数据备份 ──→ P1 Memory→Skill 闭环 ──→ P2 Task 自动规划
                                              ↓
                                         P3 Skill 哈希
```

P0 最先做（止损）。P1 是核心差异化，工作量最大但价值最高。P2 和 P3 可并行，P3 依赖阶段四已完成的 `skill-fs.ts`。

---

## 不做的事

- 不做渠道扩展（用户通过 Web 端交互）
- 不做前端产品化 UI（Web 只是控制台）
- 不做多进程分布式（本地单机优先）
- 不做 Skill marketplace（先把本地闭环跑通）
