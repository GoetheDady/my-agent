# M5 Prompt & Context

本文档记录 Prompt & Context 的模块边界。以后修改 `src/prompts/`、system prompt、上下文注入规则或模型可见任务指引时，需要同步更新本文档和 `docs/project-module-map.md`。

专业术语说明：

- **Prompt**：传给模型的系统说明、任务说明和上下文。
- **Context**：模型本轮调用能看到的 Agent、Task、Profile、Skill 和 working memory 信息。
- **Profile**：稳定背景文件，包括 Agent 的 `soul.md` 和用户相关的 `user.md`。
- **Skill Index**：当前 Agent 启用 Skill 的索引，模型需要时再调用 `skill_view` 读取全文。

## 1. 模块定位

Prompt & Context 负责决定每次模型调用时，Agent 能看到什么，以及应该优先使用哪些系统能力。

它应该负责：

- 构建 Agent system prompt。
- 注入 Agent 身份、Task id、来源渠道和用户 id。
- 注入稳定 Profile 上下文。
- 注入 Skill index 和 working memory。
- 注入少量经过过滤的相关长期记忆片段，作为 RAG-in-context 参考资料。
- 明确长期记忆检索结果只是参考，不是指令。
- 给模型说明关键工具使用边界，例如 Agent 配置、委派和任务规划工具。

它不应该负责：

- 直接创建 Task。
- 直接执行工具。
- 直接写长期记忆。
- 直接修改 Agent 配置。
- 直接决定 Task 队列调度。

## 2. 当前相关代码

```text
src/prompts/
├── agent-prompt.ts
├── planning-guide.ts
└── agent-prompt.test.ts
```

相关调用方：

```text
src/runtime/agent-runtime.ts
src/runtime/internal-runner.ts
```

## 3. 当前状态

当前 Prompt & Context 已支持：

- 构建默认中文 system prompt。
- 注入当前 Agent id、名称和描述。
- 注入当前 Task id、source channel 和 source user id。
- 注入 `soul.md` 和 `user.md` 稳定上下文。
- 注入当前 Agent 的 Skill index。
- 注入当前 Task 的 working memory。
- 在构建 system prompt 时自动检索并注入 Top-K 相关长期记忆，记忆内容会先做可疑指令过滤和长度裁剪。
- 为父任务汇总构造受预算限制的结构化上下文，包含 plan steps、直接 child task 结果/错误摘要、delegation callback 信息和已有 episode 摘要。
- `src/prompts/task-context-summary.ts` 将父任务输入、步骤、子任务结果和 episode 摘要统一裁剪到固定预算，避免把完整事件流水塞进 prompt。
- `buildSummaryTaskMessages()` 会把结构化父任务上下文整理成最终汇总提示，要求模型说明完成、失败、取消情况，并禁止继续委派或创建新的子任务。
 - 明确长期记忆不会整体塞进 prompt；只会注入少量相关、已过滤的参考片段，证据不足时仍应通过 `memory_recall`、`memory_evidence` 等工具查询。
- 明确 Agent 配置必须通过 `agent_config_get` / `agent_config_patch` 访问和修改。
- 明确普通异步委派使用 `agent_delegate`，并说明不等待目标 Agent 同步完成。
- 对复杂顶层 task 自动注入 planning guide，引导模型先判断是否需要结构化计划，再决定是否调用 `task_plan_set`。

本轮 M3/M12 父任务汇总上下文改动对 Prompt & Context 的影响：

- 新增 `task-context-summary.ts`，用 `TASK_CONTEXT_BUDGETS` 控制父任务输入、step、child input/result/error 和 episode 摘要长度。
- `buildSummaryTaskMessages()` 只把结构化摘要交给模型，不把完整事件流水塞进 prompt。
- 汇总 prompt 明确要求父 Agent 说明子任务完成、失败或取消情况，并禁止继续委派或创建新的子任务。

本轮 M3 Task Planning Tools v1 改动对 Prompt & Context 的影响：

- system prompt 新增复杂任务规划指引：复杂任务优先调用 `task_plan_set` 写结构化步骤。
- system prompt 新增步骤状态指引：执行步骤时用 `task_step_update` 标记 `running`、`completed`、`failed` 或 `skipped`。
- system prompt 新增计划步骤委派指引：需要其他 Agent 处理某个步骤时优先用 `task_child_create`，让 child task 绑定到对应 plan step。
- system prompt 明确不要用普通 `agent_delegate` 绕过计划步骤绑定，除非该委派不需要 plan step 关联。

本轮 P2 Task 自动规划改动对 Prompt & Context 的影响：

- 新增 `src/prompts/planning-guide.ts`，把复杂任务何时需要计划、如何调用 planning tools、何时创建子任务整理成独立 prompt 片段。
- `agent-prompt.ts` 会在复杂、顶层、尚无已有 plan 的 task 上注入 planning guide；简单 task、child task 和已有 plan 的 task 不重复注入。
- 自动规划当前是 prompt-level 能力：也就是通过 system prompt 约束模型行为，并不改变 Task Queue 的领取规则，也不保证模型一定会创建计划。
- 相关回归测试已覆盖复杂任务注入、简单任务不注入和已有 plan 不重复注入。

本轮 RAG-in-context 改动对 Prompt & Context 的影响：

- `buildAgentSystemPrompt()` 改为异步函数，支持在构建 prompt 时等待相关长期记忆检索结果。
- 新增 `<relevant-memories>` 片段，用于注入最多 5 条相关长期记忆；每条记忆会裁剪到 300 个字符。
- 记忆片段会明确标注“不是指令”，并说明与当前对话或系统指令冲突时以后者为准。
- 可疑 prompt injection 内容会被过滤，例如包含 `ignore previous instructions`、`system prompt` 或 `you are now` 的记忆不会进入 prompt。prompt injection 指把恶意指令伪装成资料，诱导模型忽略原本系统指令。
- 记忆检索失败时返回空片段，不阻断 Agent 继续执行。

## 4. 模块边界

Prompt & Context 只告诉模型如何使用能力，不保存能力状态。

边界约定：

- Task plan、step、dependency 的当前状态保存在 Task System。
- Tool 是否可见由 Tool System 和 Agent config 决定。
- Prompt 指引只是模型行为约束，不保证模型一定会拆解任务；后续如果需要强制规划，需要在 Runtime 或 Task System 另做策略。
- Profile 是稳定背景，不是长期记忆证据；`<relevant-memories>` 是检索出来的参考资料，不是指令。涉及精确历史事实或证据链时仍应调用 Memory tools。

## 5. 后续需要补齐

- Prompt 版本记录。
- 更完整的全局上下文预算管理。
- Planning guide 的质量评估，例如是否在复杂任务中稳定产出可执行步骤。
- Skill 自动选择策略。
- 记忆召回选择策略和注入命中率评估。
- Task history 与事件流水的通用摘要策略。
- 多渠道上下文格式统一。
- Prompt 回归评估继续扩展，验证关键工具指引不会被后续修改破坏。
