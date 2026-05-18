# 下一步开发优先级

本文档记录当前 `my-agent` 在完成 Task timeline、Task Plan / Dependency v1、Agent planning tools 之后的开发顺序。它用于排期和拆下一轮计划，不替代各模块文档。

## 当前判断

项目现在已经具备：

- 统一 Task 生命周期、队列、租约、恢复和 Watchdog。
- Task timeline、工具审计和 Runtime 控制面。
- Task Plan / Dependency v1，支持 steps、child tasks 和 task-level dependencies。
- Agent 可通过 Runtime planning tools 主动写计划、更新步骤、创建绑定 plan step 的 child task，并维护 child task 依赖。
- Episode v1 能从 Task、工具审计、plan/dependency 事件里提取经历摘要素材。

当前最明显的缺口不是“能不能拆任务”，而是复杂任务拆出去后，父任务如何等待、汇总、收口并形成稳定结果。

## P0：M3 / M12 父任务汇总与收口

目标：让复杂任务从“能拆、能派、能跑”进入“能等、能汇总、能完成”的闭环。

应该实现：

- 父任务能读取所有直接 child task 的状态、结果和失败原因。
- 父任务能判断哪些 plan steps 已完成、失败、取消或仍阻塞。
- child task 全部进入终态后，系统能创建或触发父 Agent 的汇总任务。
- 父 Agent 汇总 child task 结果后，能更新父任务结果、剩余 step 状态和 episode。
- Runtime timeline 能清楚解释父任务、child task、callback task 的关系。

不做：

- 完整 DAG 调度。
- 自动取消依赖失败的任务。
- 多层递归委派。
- 新的 Web 规划编辑器。

成功标准：

- 一个复杂任务可以被拆成多个 child tasks。
- child tasks 完成后，父 Agent 能生成最终用户可读结果。
- 父任务不会长期停在“已派发但未收口”的状态。
- Episode 能记录父任务的关键步骤、子任务结果和问题。

## P1：M11 外部渠道幂等，先做飞书 message id 幂等

目标：避免外部渠道重复投递导致重复 Task、重复回复和重复记忆。

应该实现：

- Feishu incoming message 使用稳定 idempotency key 创建 Task。
- ChannelService 将外部 message id、channel id、conversation id 组合成幂等键。
- 重复事件命中已有 Task 时，不重复入队。
- 事件审计记录重复输入被复用或忽略的原因。

成功标准：

- 同一飞书消息重复送达，只产生一个 Task。
- 重复事件不会触发重复回复。
- 相关测试覆盖正常消息、重复消息和缺失 message id 的降级路径。

## P2：M5 Prompt / Context 上下文预算与任务历史摘要

目标：随着 Task plan、child task、timeline 和 episode 增多，控制模型上下文规模和质量。

应该实现：

- 为 prompt builder 增加明确的上下文预算策略。
- 将 Task history、child task result、episode 摘要压缩成可控长度。
- 明确哪些内容进 system prompt，哪些内容必须通过工具读取。
- 增加 prompt 回归测试，避免后续修改破坏关键工具指引。

成功标准：

- 长任务不会把完整事件流水直接塞进 prompt。
- 父任务汇总时能看到足够的 child task 摘要，但不会超过预算。
- Prompt 中的 memory、skill、task planning 指引保持稳定。

## P3：M15 / M16 Runtime 控制台操作增强

目标：让控制台更适合诊断复杂任务，但不把 Web Console 变成架构中心。

应该实现：

- 在 Task 详情里更清楚展示父子任务关系。
- 增加 child task 的重试、取消、跳转入口。
- 支持展开事件 payload，用于调试工具审计和 dependency blocked。
- 对 blocked / failed / canceled task 给出明确诊断提示。

不做：

- 完整产品化仪表盘。
- 拖拽式任务规划编辑器。
- 替代 Runtime API 的业务控制面。

## 推荐下一轮

下一轮优先做 **P0：M3 / M12 父任务汇总与收口**。

原因：

1. 刚完成的 Task planning tools 已经让 Agent 能写计划和创建 child task。
2. 如果不补父任务收口，复杂任务会停留在“派发出去但最终结果不稳定”的阶段。
3. 父任务汇总完成后，Episode、Memory、Web Console 和外部渠道都会有更稳定的输入。
4. 这一步能自然验证 M3、M12、M7、M15、M16 是否真的形成闭环。
