# M6 Tool System

本文档记录 Tool System 的模块边界。以后修改 `src/tools/`、工具审批、工具策略、工具执行审计或对 AI SDK 暴露的工具集合时，需要同步更新本文档和 `docs/project-module-map.md`。

专业术语说明：

- **Tool**：Agent 可调用的能力，例如读文件、写文件、搜索记忆、创建 Skill 或委派 Agent。
- **Toolset**：工具组。Agent 配置通过工具组控制可见能力，例如 `file`、`memory`、`skill`、`agent_config`。
- **Policy**：工具策略。这里指某个 Agent 是否启用工具组、哪些工具需要审批、哪些路径允许写入。
- **Approval**：审批。写入或高风险工具执行前需要用户批准，审批结果会进入审计事件。
- **Tool Audit**：工具审计。记录工具调用开始和结束，作为 Task 时间线和 Episode 摘要的事实来源。

## 1. 模块定位

Tool System 负责决定 Agent 能调用哪些能力、调用前是否需要审批，以及工具调用过程如何留下审计事实。

它应该负责：

- 注册内置工具和工具元数据。
- 按 Agent 配置构建对 AI SDK 暴露的工具集合。
- 执行工具策略判断，包括只读默认允许、写工具审批和路径 allowlist。
- 记录工具审批和工具执行审计事件。
- 保持工具返回值和异常行为不被审计包装改变。

它不应该负责：

- 直接调度 Task。
- 直接生成长期记忆或 Episode。
- 直接写 `agent.json`；Agent 配置应通过 `AgentConfigService` 或 `agent_config_patch` 修改。
- 绕过 Runtime 的单 Agent 单线程模型。

## 2. 当前相关代码

```text
src/tools/
├── audit.ts
├── approval-service.ts
├── builtin-tools.ts
├── executor.ts
├── policy.ts
├── registry.ts
└── service.ts
```

相关调用方：

```text
src/runtime/agent-runtime.ts
src/runtime/internal-runner.ts
src/routes/tools.ts
src/agents/config-tools.ts
src/agents/tools.ts
src/memory/memory-tools.ts
src/memory/human-memory-tools.ts
src/tasks/task-tools.ts
src/skills/
```

相关数据表：

```text
tool_approvals
events
tasks
```

## 3. 当前状态

当前 Tool System 已支持：

- `registerTool()` 保存工具元数据，用于权限策略、控制台展示和测试。
- `buildAgentTools(context)` 为每次 Agent run 构建 context-aware 工具集合，并传入 `agentId`、`taskId`、`conversationId` 和测试数据库连接。
- `enabledToolsets` 按 Agent 配置控制工具组可见性。
- 读工具默认允许；写工具默认需要审批，除非当前 Agent 策略明确放行。
- `write_file` 支持 Agent-scoped `allowedPaths` 和单次审批上下文里的临时 approved path。
- `write_file` 禁止直接修改 `.my-agent/agents/<agentId>/agent.json`，Agent 配置必须通过受控工具修改。
- `ApprovalService` 持久化审批记录，并写入 `tool.approval.*` 审计事件。
- Skill、Memory、AgentConfig、Agent Delegation 工具都通过同一工具策略入口暴露给 Agent。
- Runtime planning tools 通过 `runtime` toolset 暴露：`task_plan_get`、`task_plan_set`、`task_step_update`、`task_child_create`、`task_dependency_add`、`task_dependency_remove`。
- Planning tools 写的是当前 Task 的运行时计划和依赖状态，不写文件、不改 Agent 配置；默认不加入 `requiresApproval`。
- 所有暴露给 AI SDK 的工具统一经过 `withToolAudit()` 包装。

本轮改动对 Tool System 的影响：

- 新增 `src/tools/audit.ts`，统一记录工具执行事实。
- 工具执行前写入 `tool.call`，payload 包含 `toolName`、`toolCallId`、`args` 和 `startedAt`。
- 工具执行后写入 `tool.result`，payload 包含 `toolName`、`toolCallId`、`success`、`durationMs`、`outputPreview` 或 `error`。
- 工具抛错时仍会写入 `tool.result(success=false)`，然后原样 rethrow。
- 审计包装会调用 `updateTaskProgress()`，把运行中任务进度更新为“正在执行工具：<toolName>”，并通过 progress metadata 暴露当前工具、tool call id 和最近输出摘要。
- 审计包装不改变工具权限、审批、返回值和异常行为。

## 4. 模块边界

Tool System 应该保存工具执行事实，但不保存完整 Task 历史。

边界约定：

- `tool.call` / `tool.result` 是 Event & Audit 的事实流，供 Runtime timeline、Episode 和调试页面消费。
- Task 只保存轻量进度字段和 progress metadata，不保存完整工具流水。
- Episode 可以从工具审计事件提取 `tools_used` 和 `key_steps`，但 Episode 不替代原始工具事件。
- 工具审批事件只表示用户是否批准某次工具调用，不表示工具本身已经执行成功。
- `task_child_create` 属于 Runtime planning 工具，但底层复用 Multi-Agent Delegation；工具层只负责当前 Task 的作用域校验和工具返回格式。

## 5. 后续需要补齐

- 工具输入输出 schema 文档。
- 工具失败的结构化错误标准，例如权限失败、IO 失败、模型工具参数错误。
- 工具调用超时、取消和资源限制。
- 工具安全等级：只读、写入、网络、执行命令、敏感数据。
- 工具使用统计：调用次数、失败率、平均耗时和高风险工具占比。
- Agent 工具权限模板，方便创建不同角色 Agent。
- 审批等待状态和 Runtime Task 暂停/恢复语义的进一步打通。
