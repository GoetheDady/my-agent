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
- WeChat stub。

本轮 M3 改动对 Channel 的影响：

- 外部渠道 runner 会写 Task progress。
- 渠道最终投递失败归入 `failure_stage='delivery'`。
- 渠道失败会写入结构化 outcome，方便 Runtime API 解释失败。

## 4. 后续需要补齐

- Feishu message id 全面接入 `idempotency_key`。
- 微信真实接入。
- 附件和富文本处理。
- 多渠道统一错误反馈。
