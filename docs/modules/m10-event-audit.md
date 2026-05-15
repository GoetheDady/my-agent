# M10 Event & Audit

本文档记录 Event & Audit 的模块边界。以后修改 `src/events/` 时，需要同步更新本文档和 `docs/project-module-map.md`。

专业术语说明：

- **Event**：运行时事件，记录系统在某个时间点发生了什么。
- **Audit**：审计，保留可检查证据，方便恢复、调试和解释。
- **Payload**：事件携带的结构化数据。

## 1. 模块定位

Event & Audit 是系统事实流水。它不替代 Task 状态，也不替代 Episode 摘要。

它应该负责：

- 写入运行时事件。
- 按 Agent、Task、Conversation 查询事件。
- 给 Runtime API、Dream Worker、调试工具提供证据链。

它不应该负责：

- 执行业务逻辑。
- 生成长期记忆。
- 保存完整任务摘要。

## 2. 当前相关代码

```text
src/events/
```

## 3. 当前状态

当前事件系统已支持：

- SQLite 事件表。
- `appendEvent()` 统一写入。
- 实时广播。
- Task、Tool、Memory、Skill、Channel、Dream、Profile 事件。

本轮 M3 改动新增或规范了这些事件类型：

- `task.progress.updated`
- `task.failed.classified`
- `task.cancel.requested`
- `task.cancel.rejected`
- `task.canceled`

## 4. 后续需要补齐

- 事件 payload schema 文档。
- 事件严重等级。
- 事件导出和归档。
- 按 Task 全链路聚合视图。
