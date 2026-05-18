# M2 Agent Identity & Config

本文档记录 Agent Identity & Config 的模块边界。以后修改 `src/agents/`、Agent 配置结构、Agent-scoped 配置读写或 `agent.json` 迁移逻辑时，需要同步更新本文档和 `docs/project-module-map.md`。

专业术语说明：

- **Agent Identity**：Agent 身份，包括 id、名称、描述和工作目录。
- **Agent Config**：Agent 配置，当前保存在 `.my-agent/agents/<agentId>/agent.json`。
- **Agent-scoped**：按 Agent 隔离。工具策略、Skill 元数据、渠道绑定和 profile 都属于某个具体 Agent。
- **Patch**：局部更新。这里指通过 `AgentConfigService.patchAgentConfig()` 精准修改配置，而不是整体覆盖文件。

## 1. 模块定位

Agent Identity & Config 负责定义 Agent 是谁、能做什么、启用哪些工具和 Skill，以及绑定哪些渠道。

它应该负责：

- 初始化默认 Agent。
- 创建、读取、更新 Agent。
- 统一读写 Agent-scoped `agent.json`。
- 管理 Agent 的工具策略、记忆开关、Skill 元数据和渠道绑定。
- 做配置校验、规范化和 legacy 数据迁移。

它不应该负责：

- 直接执行 Task。
- 直接调用模型。
- 直接写 Skill 文件内容。
- 绕过 `AgentConfigService` 修改 `agent.json`。
- 把 Agent-scoped 数据写回旧的全局配置源。

## 2. 当前相关代码

```text
src/agents/
```

相关运行时数据：

```text
.my-agent/agents/<agentId>/agent.json
.my-agent/agents/<agentId>/soul.md
.my-agent/agents/<agentId>/user.md
.my-agent/agents/<agentId>/skills/
```

## 3. 当前状态

当前 Agent Identity & Config 已支持：

- `ensureDefaultAgent()` 在启动时创建 fallback `default` Agent。
- `AgentService` 支持创建、读取、列出和更新 Agent。
- `AgentConfigService` 统一管理 `.my-agent/agents/<agentId>/agent.json`。
- Agent config 包含名称、描述、模型、工具策略、记忆开关、Skill 元数据和渠道绑定。
- 工具策略按 Agent 隔离，包括 `enabledToolsets`、`requiresApproval` 和 `allowedPaths`。
- Skill 元数据按 Agent 隔离，Skill 内容由 Skill System 写入 Agent 的 skills 目录。
- Feishu channel binding 保存在目标 Agent 的 `agent.json` 中。
- legacy skills registry 和 legacy profile 文件只作为迁移来源，不作为新配置源。

本轮 P4 Skill 闭环改动对 Agent Config 的影响：

- `AgentConfigSkill` 新增可选 `provenance`，用于保存 Skill 来源 task、episode、source events、创建原因和创建者。
- `AgentConfigSkill` 新增可选 `usage`，用于保存 Skill 成功/失败次数、最近使用时间和关联 task ids。
- `AgentConfigService` 会在读取 `agent.json` 时规范化 `provenance` / `usage`，避免坏数据破坏 Skill 列表。
- `patchAgentConfig()` 支持保留或更新 Skill 的 provenance / usage，但仍通过 AgentConfigService 写入，不允许工具直接改 `agent.json`。

## 4. 模块边界

- Agent config 是 Agent-scoped 能力状态的真相。
- Skill 文件内容属于 Skill System；Skill 元数据属于 Agent Config。
- Channel binding 属于 Agent Config；渠道协议和收发逻辑属于 Channel System。
- Runtime 每次执行前读取最新 Agent config，但执行状态仍属于 Task / Runtime。
- 所有配置写入都应走 `AgentConfigService`，而不是 `write_file` 直接改 JSON。

## 5. 后续需要补齐

- Agent config schema 版本和迁移记录。
- 配置 diff、回滚和审计 UI。
- Agent 模板，例如个人助手、研究员、工程师、审阅者。
- Agent 删除、归档、导出和导入策略。
- 更细的配置校验报告。
