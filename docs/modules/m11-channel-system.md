# M11 Channel System

本文档记录 Channel System 的模块边界。以后修改 `src/channels/` 时，需要同步更新本文档和 `docs/project-module-map.md`。

专业术语说明：

- **Channel**：外部输入输出渠道，例如 Web、飞书、未来微信。
- **Delivery**：消息投递，把 Agent 结果发回外部渠道。
- **Idempotency Key**：幂等键，用来避免外部重复消息创建重复 Task。

## 1. 模块定位

Channel System 负责把外部消息接入 Runtime，并把结果发回对应渠道。

它应该负责：

- 渠道身份映射。
- 渠道 conversation 映射。
- 调用 `ChannelService` 创建 Task。
- 外部渠道 runner 执行和回发。
- 渠道投递失败事件。

它不应该负责：

- 直接绕过 Task 系统执行模型。
- 直接写长期记忆。
- 直接写 Agent 配置。

## 2. 当前相关代码

```text
src/channels/
```

## 3. 当前状态

当前 Channel System 已支持：

- Web channel。
- Feishu WebSocket MVP。
- Feishu onboarding 和 binding。
- 外部渠道队列 drain。
- 外部渠道最终回复会对空模型输出做兜底，避免飞书收到空消息。
- 外部渠道任务终态 episode 生成（已接入 `finalizeEpisodeForTask()`，覆盖完成、失败、投递失败、任务不可执行、审批后恢复等路径）。
- WeChat stub。

本轮 M3 改动对 Channel 的影响：

- 外部渠道 runner 会写 Task progress。
- 渠道最终投递失败归入 `failure_stage='delivery'`。
- 渠道失败会写入结构化 outcome，方便 Runtime API 解释失败。

本轮 M7 改动对 Channel 的影响：

- 外部渠道 runner（`external-runner.ts`）在所有终态路径接入 `finalizeEpisodeForTask()`：正常完成、失败、投递失败、任务不可执行、审批后恢复完成/失败。
- 飞书等外部渠道任务现在和 Web / internal runner 一样，完成后会生成 episode 经历摘要，记录任务状态、失败分类、关键步骤等信息。
- episode 生成失败时只写 `episode.failed` 审计事件，不会回滚渠道任务的终态或阻碍投递。

本轮飞书空回复修复对 Channel 的影响：

- `external-runner.ts` 不再直接把空的 `generateText().text` 投递给飞书。
- 外部渠道模型调用显式设置 DeepSeek `thinking: disabled`，和 Web 聊天默认行为保持一致，避免只返回 reasoning 而没有最终正文。
- 如果模型执行了工具但没有生成最终文本，会把最近工具结果摘要作为可见回复和 Task result。
- 如果模型没有文本也没有工具结果，会回发明确兜底文案，避免用户看到空白消息。
- 审批恢复后的飞书回复也复用同一空输出兜底逻辑。

## 4. 后续需要补齐

- Feishu message id 全面接入 `idempotency_key`。
- 微信真实接入。
- 附件和富文本处理。
- 多渠道统一错误反馈。
- 外部渠道投递重试后的 episode 更新策略：同一 task 多次投递后 episode 是否需要反映最终投递状态。
