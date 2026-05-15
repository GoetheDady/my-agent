# M12 Multi-Agent Collaboration

本文档记录 Multi-Agent Collaboration 的模块边界。以后修改 `src/delegations/`、委派任务、回调任务或多 Agent 协作协议时，需要同步更新本文档和 `docs/project-module-map.md`。

专业术语说明：

- **Multi-Agent Collaboration**：多 Agent 协作。这里指多个 Agent 通过任务委派分工，而不是让一个 Agent 同时并发执行多个任务。
- **Delegation**：委派。这里指父 Agent 把一个子任务交给目标 Agent 执行。
- **Callback Task**：回调任务。这里指子 Agent 完成后，系统为父 Agent 创建的整理任务，用来把子结果转成用户能理解的回复。
- **Parent / Child Agent**：父 Agent 和子 Agent。父 Agent 发起委派，子 Agent 执行被委派的子任务。

## 1. 模块定位

Multi-Agent Collaboration 负责把单 Agent 单线程工作模型扩展为多个 Agent 的分工协作。

它应该负责：

- 创建和记录委派关系。
- 为目标 Agent 创建子 Task。
- 子 Task 完成后创建父 Agent 的 callback Task。
- 把子 Agent 结果交还给父 Agent。
- 记录委派创建、完成、失败和回调相关事件。
- 取消未开始的委派任务，并保持 Task / Episode 状态一致。

它不应该负责：

- 绕过 Task System 直接并发执行模型调用。
- 替代 Task Queue 的领取、重试和恢复逻辑。
- 直接写长期 Memory。
- 直接修改 Agent 配置。
- 定义外部渠道协议；外部渠道仍归 Channel System 处理。

## 2. 当前相关代码

```text
src/delegations/
src/delegations/service.ts
src/delegations/store.ts
src/delegations/types.ts
src/delegations/service.test.ts
```

相关依赖模块：

```text
src/tasks/
src/runtime/internal-runner.ts
src/channels/
src/memory/episode-store.ts
```

## 3. 当前状态

当前 Multi-Agent Collaboration 已支持：

- 父 Agent 创建目标 Agent 的异步委派。
- 防止 Agent 把任务委派给自己。
- MVP 阶段阻止递归委派。
- 子 Agent 通过 internal runner 执行子 Task。
- 子 Agent 完成后创建父 Agent 的 callback Task。
- callback Task 可以把子 Agent 结果追加回 Web session，或通过外部 Channel 投递。
- 委派事件包括创建、完成、失败、callback 创建、callback 完成和 callback 失败。
- 取消 queued 状态的委派时，会取消对应子 Task。

本轮 M7 改动对 Multi-Agent Collaboration 的影响：

- 取消 queued 子 Task 时会调用 `finalizeEpisodeForTask()`，为被取消的子任务生成 episode。
- 这样失败或取消的多 Agent 子任务也会成为可检索经历，后续父 Agent、Dream 或诊断工具可以看见“为什么没有完成”。
- episode 生成失败只写 `episode.failed` 事件，不会阻止委派取消流程。

## 4. 当前边界

- 单个 Agent 仍然一次只执行一个 Task；并行来自多个 Agent 分工，而不是单 Agent 内部并发。
- 委派任务复用 Task System 的生命周期、租约、重试和进度字段。
- Episode 只记录任务经历，不把委派结果直接写入长期 Memory。
- 外部渠道投递失败仍归 Channel System 表达，Delegation 只负责发起投递和记录委派失败。

## 5. 后续需要补齐

- 角色模板：让 Agent 能根据能力、工具和职责选择合适的目标 Agent。
- 委派协议：规范输入格式、期望输出、证据要求和失败说明。
- 结果汇总协议：父 Agent 如何判断子 Agent 输出是否足够。
- 多 Agent 任务依赖图：表达多个子任务之间的顺序和依赖关系。
- 协作事件时间线：把父任务、子任务、callback task 和 episode 串起来展示。
- 委派失败后的回退策略：例如重试、换 Agent、降级为父 Agent 自己执行。
- 跨 Agent 的权限边界：避免父 Agent 通过子 Agent 间接获得不该拥有的工具或文件权限。
