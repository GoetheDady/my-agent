# 类人记忆系统定向回归测试

这份文档用于交给 Claude Code。目标不是重新跑完整 14 个验收用例，而是针对上一轮验收报告中的 P2 问题和跳过项做定向回归测试。

## 给 Claude Code 的复制提示词

```text
你要在 /Users/gedesiwen/gdsw/my-agent 项目中，使用 Chrome DevTools MCP 做类人记忆系统的定向回归测试。

上下文：
- 上一轮完整验收报告在 docs/superpowers/specs/2026-05-09-human-like-memory-acceptance-report.md。
- 上一轮 P2 问题是 Case 7：Memory Panel 中已经有“用户喜欢黄瓜，不喜欢西红柿了”，但新会话通过 memory_recall 没召回偏好变化轨迹。
- 现在已修复 memory_recall 的 social/preference 召回路径，需要重点验证。

必须遵守：
1. 必须使用 Chrome DevTools MCP 操作真实前端页面，不能只用 curl、数据库查询或单元测试替代。
2. 必须跨会话测试。不能在同一个会话里验证记忆，因为同会话有上下文，会误判。
3. 每个用例必须检查 Console error 和 Network 关键 API 状态。
4. 每个测试输入都加唯一 RUN_ID，避免和旧记忆混淆。
5. 测试前备份 data 目录，测试后恢复备份，避免污染真实记忆。
6. 如果 DeepSeek 或 embedding 服务失败，记录为环境失败，不要误判为前端失败。

测试范围：
- 必测：Case R1 偏好变化召回回归。
- 必测：Case R2 证据链追问。
- 建议补测：Case R3 未来计划、Case R4 做事方法、Case R5 风险复盘、Case R6 切换会话不串消息。

请按本文档步骤执行，并输出“最终报告格式”中的验收报告。
```

## 术语说明

- Chrome DevTools MCP：Claude Code 控制 Chrome 的调试工具，可以检查 DOM、Console、Network、截图并点击页面。
- DOM：浏览器里的页面结构，用来确认按钮、文本、工具卡是否真实存在。
- Console：浏览器控制台，前端运行错误会出现在这里。
- Network：浏览器网络面板，用来确认 `/api/...` 请求是否成功。
- 2xx：HTTP 成功状态码，例如 200、201。
- session：一次前端对话，URL 通常类似 `/sessions/<session-id>`。
- 回归测试：针对已修复问题重新测试，确认问题不再出现。
- evidence chain：证据链，也就是 Agent 回答“为什么这么判断”时，能追溯到记忆、事件或 episode 来源。

## 执行前准备

### 1. 确认环境变量

```bash
cd /Users/gedesiwen/gdsw/my-agent
echo ${DEEPSEEK_API_KEY:+set}
echo ${ZHIPU_API_KEY:+set}
```

预期都输出 `set`。否则停止测试并报告环境变量缺失。

### 2. 备份数据

```bash
cd /Users/gedesiwen/gdsw/my-agent
BACKUP_DIR=".test-backups/human-memory-regression-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"
cp -R data "$BACKUP_DIR/data"
echo "$BACKUP_DIR"
```

测试完成后恢复：

```bash
cd /Users/gedesiwen/gdsw/my-agent
# 先停止服务
rm -rf data
cp -R "$BACKUP_DIR/data" data
```

### 3. 构建并启动服务

```bash
cd /Users/gedesiwen/gdsw/my-agent
cd web && bun run build
cd ..
PORT=3100 bun run start
```

浏览器打开：

```text
http://localhost:3100
```

### 4. 生成 RUN_ID

每条测试消息都带上同一个唯一标识，例如：

```text
REG-HLM-20260509-163000
```

下文用 `$RUN_ID` 表示。

## 全局检查

每个用例都检查：

1. 当前 URL 和 session id。
2. 页面不是空白页。
3. Console 无相关 error。
4. Network 中相关 API 返回 2xx：
   - `/api/chat`
   - `/api/sessions`
   - `/api/runtime/events`
   - `/api/memories`
   - `/api/memories/episodes`
5. 聊天消息里的工具卡是否出现。
6. Runtime Panel 是否出现相关事件：
   - `记忆检索`
   - `记忆提取开始`
   - `记忆提取完成`
   - `记忆再巩固开始`
   - `记忆再巩固完成`
   - `经历记录创建`

## 必测用例

### Case R1: 偏好变化召回回归

目标：验证“喜欢西红柿 -> 不喜欢西红柿，改为喜欢黄瓜”跨会话能被正确召回。

会话 A：

```text
$RUN_ID 请记住：我喜欢西红柿。
```

会话 B：

```text
$RUN_ID 我现在不喜欢西红柿了，改为喜欢黄瓜。
```

会话 C：

```text
$RUN_ID 我现在喜欢什么？我以前有没有改过主意？
```

步骤：

1. 新建会话 A，发送会话 A 消息。
2. 等待助手回复完成。
3. 确认出现 `记忆提取` 工具卡。
4. 新建会话 B，发送会话 B 消息。
5. 等待助手回复完成。
6. 确认出现 `记忆提取`，最好也出现 `记忆再巩固`。
7. 新建会话 C，发送会话 C 消息。
8. 检查助手回复、工具卡、Runtime Panel 和 Memory Panel。

预期：

- 会话 C 必须调用 `memory_recall` 或产生 `记忆检索` 事件。
- 会话 C 回答必须体现变化轨迹：
  - 曾经喜欢西红柿。
  - 现在不喜欢西红柿。
  - 现在改为喜欢黄瓜。
- Memory Panel 中能找到 `$RUN_ID` 相关偏好记忆。
- 不能只回答“你喜欢 JavaScript”或其他无关偏好。
- 不能只回答“你喜欢西红柿和黄瓜”，而不说明变化。

通过判定：

- 回答中同时出现 `西红柿`、`黄瓜`、`现在` 或 `曾经/以前/改为/不喜欢` 这类变化表达。
- 工具或 Runtime 事件证明发生过记忆检索。

失败判定：

- 没有调用记忆工具就回答。
- 只返回旧偏好。
- 返回无关偏好。
- 记忆存在于 Memory Panel，但 Agent 不使用它。

### Case R2: 证据链追问

目标：验证 Case R1 后继续追问依据时，Agent 不编造来源。

会话 D：

```text
$RUN_ID 你为什么这么判断？依据是什么？
```

步骤：

1. 在 R1 完成后新建会话 D。
2. 发送上面消息。
3. 检查是否调用 `memory_evidence` 或 `memory_recall`。
4. 检查回答是否说明依据来自之前的记忆、会话、事件或 episode。

预期：

- 助手应说明判断依据来自前面关于西红柿/黄瓜偏好变化的记录。
- 应出现记忆检索或证据相关工具/事件。
- 如果暂时没有足够细粒度证据，应明确说“我能查到的记录是……”，不能编造具体不存在的来源。

失败判定：

- 编造不存在的日期、事件或对话。
- 不查工具，直接声称“我记得”。
- 完全答非所问。

## 建议补测用例

### Case R3: Prospective Memory 未来计划

会话 A：

```text
$RUN_ID 请记住：这个项目后续要接入飞书和微信渠道。
```

会话 B：

```text
$RUN_ID 这个项目后续还要做什么？
```

预期：

- 跨会话回答包含 `飞书` 和 `微信`。
- 出现 `memory_recall`、`memory_plan` 或 `记忆检索`。

### Case R4: Procedural Memory 做事方法

会话 A：

```text
$RUN_ID 请记住：以后修改记忆系统时，要同步更新计划文档，并运行 bun test、bun run typecheck、bun run lint、cd web && bun run build。
```

会话 B：

```text
$RUN_ID 以后修改记忆系统应该注意什么？
```

预期：

- 回答包含同步计划文档和四条验证命令。
- 不能只返回用户偏好或项目事实。

### Case R5: Reflective Memory 风险复盘

会话 A：

```text
$RUN_ID 这次重复记忆问题说明：只做整条文本去重是不够的，还要处理 fact 包含 preference 的情况。请把它作为后续复盘风险记录。
```

会话 B：

```text
$RUN_ID 我们之前在记忆系统上踩过什么坑？
```

预期：

- 回答提到：
  - 整条文本去重不够。
  - fact 包含 preference 的情况需要处理。
- 如果生成 review item，Memory Panel 的 `待审查` 能看到相关建议。
- 当前阶段允许只通过 active memory 找回风险事实，标记 Partial。

### Case R6: 切换会话不串消息

会话 A：

```text
$RUN_ID 会话 A 专属内容：alpha-channel。
```

会话 B：

```text
$RUN_ID 会话 B 专属内容：beta-channel。
```

步骤：

1. 在左侧会话列表来回切换 A/B。
2. 刷新页面后再次切换。

预期：

- A 只显示 alpha-channel。
- B 只显示 beta-channel。
- 工具卡不串会话。
- URL session id 与显示内容一致。

## 辅助命令

这些只能辅助判断，不能替代 Chrome DevTools MCP 页面测试：

```bash
curl -s http://localhost:3100/api/runtime/events?agentId=default\&limit=30
curl -s http://localhost:3100/api/memories?status=active\&pageSize=50
curl -s http://localhost:3100/api/memories/episodes?limit=20
```

如果 API 返回 `<!DOCTYPE html>`，说明路由或服务配置有问题。

## 最终报告格式

Claude Code 最终按下面格式输出：

```text
# 类人记忆系统定向回归测试报告

## 环境
- 项目路径：
- 测试时间：
- RUN_ID：
- URL：
- 服务启动命令：
- 浏览器：
- 是否恢复数据备份：

## 总结
- 必测通过：
- 必测失败：
- 建议补测通过：
- 建议补测失败：
- 跳过：
- 阻塞：

## 用例结果
| Case | 名称 | 结果 | 证据 | 问题 |
| --- | --- | --- | --- | --- |
| R1 | 偏好变化召回回归 | Pass/Fail | | |
| R2 | 证据链追问 | Pass/Fail/Partial | | |
| R3 | 未来计划 | Pass/Fail/Skip | | |
| R4 | 做事方法 | Pass/Fail/Skip | | |
| R5 | 风险复盘 | Pass/Partial/Fail/Skip | | |
| R6 | 切换会话不串消息 | Pass/Fail/Skip | | |

## 关键证据
- Console error 数量：
- Network 4xx/5xx 数量：
- 出现的工具卡：
- 出现的 Runtime 事件：
- 关键 session URLs：
- Memory Panel 中相关记忆摘要：

## 发现的问题
按严重程度排序：
1. [P0/P1/P2/P3] 问题标题
   - 复现步骤：
   - 实际结果：
   - 预期结果：
   - 证据：
   - 可能相关文件：

## 结论
- 是否建议合并当前修复：
- 是否需要继续修：
- 是否需要全量验收：
```

## 通过标准

本轮最低通过标准：

1. R1 必须 Pass。
2. R2 至少 Partial，不能编造证据。
3. Console 无相关 error。
4. Network 关键 API 无 4xx/5xx。
5. 测试后数据备份已恢复。

如果 R1 失败，直接判定这次修复未通过回归测试。

