# 类人记忆系统 Chrome DevTools MCP 验收测试

这份文档用于交给 Claude Code 执行前端验收。要求 Claude Code 必须使用 Chrome DevTools MCP 操作真实浏览器页面，不允许只调用后端 API 或只跑单元测试来替代前端验收。

## 给 Claude Code 的复制提示词

```text
你要在 /Users/gedesiwen/gdsw/my-agent 项目中，使用 Chrome DevTools MCP 对类人记忆系统做完整前端验收。

必须遵守：
1. 只能把单元测试、typecheck、lint、build 当作辅助验证；核心验收必须操作真实前端页面。
2. 必须使用 Chrome DevTools MCP 打开 http://localhost:3100，不能只用 curl 或直接查数据库替代页面测试。
3. 每个跨会话用例都必须新建会话，不能在同一个会话里验证“记忆”，因为同会话有上下文，会误判。
4. 每个用例都要检查 Console 是否有 error，Network 中关键 API 是否 2xx。
5. 每个用例都要记录 session URL 或 session id、测试输入、观察到的工具卡/Runtime 事件、最终回答。
6. 如果 DeepSeek 或外部模型服务失败，要记录为环境失败，不要把它误判为前端失败。
7. 所有测试输入都加同一个唯一测试标识，例如 E2E-HLM-20260509-153000，避免和旧记忆混淆。
8. 测试前备份 data 目录；测试完成后停服务并恢复备份，避免污染真实记忆。

请按本文件的“执行前准备”“全局检查”“测试用例矩阵”“最终报告格式”逐项执行，并输出完整验收报告。
```

## 术语说明

- Chrome DevTools MCP：Claude Code 控制 Chrome 的工具接口，可以查看 DOM、Console、Network、截图并点击页面。
- DOM：浏览器里的页面结构树，用于确认按钮、文本、工具卡是否真实存在。
- Console：浏览器控制台，前端错误通常会出现在这里。
- Network：浏览器网络面板，能看到 `/api/...` 请求是否成功。
- 2xx：HTTP 成功状态码，例如 200、201。
- session：一次前端对话。URL 通常类似 `/sessions/<session-id>`。
- tool card：聊天消息里展示的工具调用卡片，例如“记忆提取”“记忆再巩固”“memory_recall”。
- Runtime Panel：页面左侧或侧栏中的运行事件面板，用来显示 task、tool、memory、episode、dream 事件。
- episode：情景记忆，一次任务/对话/工具调用经历的摘要。
- dry-run：试运行，只展示计划动作，不实际改写长期记忆。

## 执行前准备

### 1. 确认环境变量

必须确认当前终端能访问：

```bash
echo ${DEEPSEEK_API_KEY:+set}
echo ${ZHIPU_API_KEY:+set}
```

预期：都输出 `set`。如果没有，停止测试并报告“环境变量缺失”。

### 2. 备份数据

测试会写入长期记忆、episode 和 runtime events。必须先备份：

```bash
cd /Users/gedesiwen/gdsw/my-agent
BACKUP_DIR=".test-backups/human-memory-$(date +%Y%m%d-%H%M%S)"
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

如果测试目标就是验证真实数据迁移，不要恢复；否则必须恢复。

### 3. 构建并启动服务

推荐使用生产构建，避免 Vite dev proxy 干扰：

```bash
cd /Users/gedesiwen/gdsw/my-agent
cd web && bun run build
cd ..
PORT=3100 bun run start
```

打开：

```text
http://localhost:3100
```

### 4. 测试标识

生成一个唯一标识，后续每条测试消息都带上：

```text
E2E-HLM-<YYYYMMDD-HHmmss>
```

示例：

```text
E2E-HLM-20260509-153000
```

下文用 `$RUN_ID` 表示这个标识。

## 全局检查

每个用例执行前后都做：

1. 使用 Chrome DevTools MCP 获取当前 URL。
2. 使用 DOM snapshot 确认页面不是空白页。
3. 检查页面没有 Vite/React error overlay。
4. 检查 Console：
   - 允许无关 warning，但必须记录。
   - 任何 error 都要截图并归因。
5. 检查 Network：
   - `/api/chat`
   - `/api/sessions`
   - `/api/runtime/events`
   - `/api/memories`
   - `/api/memories/episodes`
   - `/api/memories/dream/run`
   - `/api/memories/reviews`
   这些相关请求不能出现 4xx/5xx，除非用例本来就在测试错误路径。
6. 截图：
   - 每个失败用例必须截图。
   - 每类核心能力至少留一张成功截图。

## 页面操作约定

Claude Code 需要优先使用可见文字定位：

- 新建会话：点击 `新对话`。
- 输入框：placeholder 通常为 `输入消息，Enter 发送，Shift + Enter 换行`。
- 发送：点击 `发送` 或按 Enter。
- 打开记忆面板：点击右上 `记忆`。
- Memory Panel tabs：
  - `长期记忆`
  - `经历`
  - `待审查`
  - `梦整理`
- Runtime Panel：检查左侧最近事件是否出现中文事件名，例如：
  - `记忆检索`
  - `记忆提取开始`
  - `记忆提取完成`
  - `经历记录创建`
  - `梦整理开始`
  - `梦整理完成`
  - `审查建议创建`

## 测试用例矩阵

### Case 0: 基础健康检查

步骤：

1. 打开 `http://localhost:3100`。
2. 等待首页渲染。
3. 记录 URL、title、DOM snapshot。
4. 检查 Console 无 error。
5. 点击 `记忆` 打开 Memory Panel。
6. 依次点击 `长期记忆`、`经历`、`待审查`、`梦整理`。
7. 在 `梦整理` tab 点击 `运行`。

预期：

- 页面 title 为 `My Agent` 或合理项目标题。
- 页面出现 `My Agent`、`Runtime`、`Chat`、输入框。
- Memory Panel 四个 tab 都可见。
- dream dry-run 显示 `试运行结果`，包含 `经历数`、`重复组`、`待审查`。
- `/api/memories/dream/run` 返回 2xx。
- Runtime Panel 出现 `梦整理开始`、`梦整理完成`。

### Case 1: Semantic / Social Memory 跨会话回忆

会话 A：

```text
$RUN_ID 请记住：我正在开发 my-agent 项目，我偏好浅色、舒服、密度适中的 Web UI。
```

步骤：

1. 新建会话 A，发送上面消息。
2. 等待助手回复完成。
3. 确认助手消息下方出现 `记忆提取` 工具卡。
4. 确认 Runtime Panel 出现 `记忆提取开始` 和 `记忆提取完成`。
5. 记录会话 A URL。
6. 新建会话 B。
7. 发送：

```text
$RUN_ID 我现在在开发什么项目？我偏好什么样的 UI？
```

预期：

- 会话 B 不能依赖会话 A 的上下文，因为 URL/session id 已变化。
- 助手应调用 `memory_recall` 或显示 `记忆检索` 相关工具/事件。
- 回答包含：
  - `my-agent`
  - `浅色`
  - `舒服`
  - `密度适中`
- Console 无 error。
- Network 关键 API 2xx。

失败判定：

- 只回答“当前会话里没有记录”。
- 不调用记忆检索。
- 回答与 `$RUN_ID` 无关的旧项目或旧偏好。

### Case 2: Episodic Memory 跨会话回忆

会话 A：

```text
$RUN_ID 帮我总结一下当前类人记忆系统第一阶段还缺什么。
```

步骤：

1. 新建会话 A，发送上面消息。
2. 等待助手完整回复。
3. 确认 Runtime Panel 出现 `任务完成`。
4. 等待或刷新 Runtime Panel，确认出现 `经历记录创建` 或 `episode.created` 对应中文事件。
5. 新建会话 B。
6. 发送：

```text
$RUN_ID 刚才我们做了什么？
```

预期：

- 助手通过 episodic recall 回答刚才的总结任务。
- 回答应提到“总结类人记忆系统第一阶段缺口/后续事项”。
- 应出现 `memory_recall`、`记忆检索`、episode 相关工具卡或 Runtime 事件。
- 不应回答“我没有当前会话上下文所以不知道”。

### Case 3: 刷新后历史工具卡仍存在

步骤：

1. 在 Case 2 的会话 B 中，确认已经出现工具卡或 Runtime 事件。
2. 使用 Chrome DevTools MCP 刷新页面。
3. 等待页面恢复。
4. 确认 URL 仍是会话 B。
5. 检查历史消息中仍能看到助手回复和相关工具卡。
6. 发送：

```text
$RUN_ID 你刚才查到了什么记录？
```

预期：

- 页面刷新后历史消息没有丢失。
- 工具卡不消失。
- 助手能基于持久化历史回答刚才查到的记录。
- 不依赖前端内存状态。

### Case 4: Prospective Memory 未来计划

会话 A：

```text
$RUN_ID 请记住：这个项目后续要接入飞书和微信渠道。
```

步骤：

1. 新建会话 A 并发送。
2. 等待 `记忆提取` 完成。
3. 新建会话 B。
4. 发送：

```text
$RUN_ID 这个项目后续还要做什么？
```

预期：

- 助手使用 `memory_recall` 或 `memory_plan`。
- 回答包含 `飞书` 和 `微信`。
- 如果页面显示工具名，应能看到 prospective/plan 相关调用。

### Case 5: Procedural Memory 做事方法

会话 A：

```text
$RUN_ID 请记住：以后修改记忆系统时，要同步更新计划文档，并运行 bun test、bun run typecheck、bun run lint、cd web && bun run build。
```

步骤：

1. 新建会话 A 并发送。
2. 等待记忆提取完成。
3. 新建会话 B。
4. 发送：

```text
$RUN_ID 以后修改记忆系统应该注意什么？
```

预期：

- 助手应查 procedural 或 semantic memory。
- 回答包含：
  - 同步更新计划文档
  - `bun test`
  - `bun run typecheck`
  - `bun run lint`
  - `cd web && bun run build`
- 不应只返回 UI 偏好或项目事实。

### Case 6: Reflective Memory / Review Item 风险复盘

会话 A：

```text
$RUN_ID 这次重复记忆问题说明：只做整条文本去重是不够的，还要处理 fact 包含 preference 的情况。请把它作为后续复盘风险记录。
```

步骤：

1. 新建会话 A 并发送。
2. 等待助手回复和记忆提取完成。
3. 打开 Memory Panel。
4. 点击 `梦整理`，点击 `运行`。
5. 点击 `待审查`。
6. 新建会话 B。
7. 发送：

```text
$RUN_ID 我们之前在记忆系统上踩过什么坑？
```

预期：

- 若当前实现只记录 active memory：助手应通过 reflective/semantic recall 提到“整条文本去重不够”和“fact 包含 preference”。
- 若生成 review item：Memory Panel 的 `待审查` 中应出现相关建议。
- 高风险抽象总结不应无提示地覆盖重要 active memory。

允许结果：

- 当前第一阶段 `review item` 自动生成能力还不是完整实现，因此如果没有 review item，但回答能通过记忆检索找回风险事实，可以记为“部分通过”。

### Case 7: Conflict / Reconsolidation 偏好变化

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

1. 按 A/B/C 三个新会话依次发送。
2. 每轮都等待助手完成和记忆提取卡完成。
3. 在 B 中确认是否出现 `记忆再巩固` 工具卡，或 Runtime Panel 出现 `记忆再巩固完成`。
4. 在 C 中检查最终回答。
5. 打开 Memory Panel 搜索 `$RUN_ID` 或 `西红柿`。

预期：

- C 的回答应体现变化轨迹：
  - 曾经喜欢西红柿
  - 现在不喜欢西红柿
  - 现在喜欢黄瓜
- active memory 不应留下两条互相冲突且没有解释的偏好。
- 如果 reconsolidation 被执行，应能看到 `memory_reconsolidate` 或 `记忆再巩固` 证据。

失败判定：

- 简单回答“你喜欢西红柿”。
- 简单回答“你喜欢西红柿和黄瓜”，没有说明变化。
- 重复生成多个同义 active memory，且没有合并/停用。

### Case 8: Evidence Chain 证据追问

步骤：

1. 在 Case 7 的会话 C 后继续新建会话 D。
2. 发送：

```text
$RUN_ID 你为什么这么判断？依据是什么？
```

预期：

- 助手调用 `memory_evidence` 或通过 `memory_recall` 返回来源证据。
- 回答说明依据来自之前的会话、事件、记忆或 episode。
- 不应编造“我记得你在某天某时说过”但没有工具证据。

### Case 9: Memory Panel 长期记忆筛选和搜索

步骤：

1. 打开 Memory Panel。
2. 点击 `长期记忆`。
3. 搜索 `$RUN_ID`。
4. 依次点击类型 tab：
   - `事实`
   - `偏好`
   - `计划`
   - `流程`
   - `复盘`
   - `协作`

预期：

- 搜索框可输入。
- 列表不会视觉错乱。
- 类型 tab 切换不会白屏。
- Network `/api/memories?...` 返回 2xx。
- 如果某类为空，应展示空态，不应报错。

### Case 10: Episodes 列表

步骤：

1. 打开 Memory Panel。
2. 点击 `经历`。
3. 查找与 `$RUN_ID` 相关的 episode。
4. 记录展示内容。

预期：

- 能看到经历卡片，或明确空态。
- 若之前 case 已完成任务，应至少有相关 episode。
- episode 卡片显示标题、摘要、时间、重要度。
- `/api/memories/episodes` 返回 2xx。

失败判定：

- task 已完成但完全没有 episode，且 Runtime Panel 没有 `episode.failed`。

### Case 11: Dream Worker Dry-run

步骤：

1. 打开 Memory Panel。
2. 点击 `梦整理`。
3. 点击 `运行`。
4. 观察试运行结果。
5. 检查 Runtime Panel。
6. 检查 Network `/api/memories/dream/run`。

预期：

- UI 显示 `试运行结果`。
- 显示：
  - `经历数`
  - `重复组`
  - `待审查`
- Runtime Panel 出现 `梦整理开始` 和 `梦整理完成`。
- dry-run 不应实际改写 active memory。

### Case 12: Review Item 审批 UI

步骤：

1. 打开 Memory Panel。
2. 点击 `待审查`。
3. 如果存在 pending review item：
   - 点击 `拒绝`。
   - 刷新页面。
   - 确认该 item 不再以 pending 状态出现，或状态持久化为 rejected。
4. 如果不存在 pending review item：
   - 记录“无可审批项，跳过交互审批”。
   - 不要直接判失败，因为当前阶段 review 自动生成仍是部分实现。

预期：

- 有 pending item 时，accept/reject 请求返回 2xx。
- Runtime Panel 出现 `审查建议接受` 或 `审查建议拒绝`。
- 刷新后状态不丢失。

### Case 13: Negative Case 防编造

步骤：

1. 新建会话。
2. 发送：

```text
$RUN_ID 我上个月让你做过什么？
```

预期：

- 如果没有上个月记录，助手应明确说没有查到足够记录。
- 应调用记忆检索。
- 不应编造上个月做过的任务。
- 允许回答“我查到的记录不足以判断”。

失败判定：

- 没有工具检索就直接编造具体任务。
- 把当前测试任务说成上个月发生。

### Case 14: 切换会话不串消息

步骤：

1. 准备两个会话 A/B。
2. A 发送：

```text
$RUN_ID 会话 A 专属内容：alpha-channel。
```

3. B 发送：

```text
$RUN_ID 会话 B 专属内容：beta-channel。
```

4. 在左侧会话列表来回切换 A/B。
5. 刷新页面后再次切换。

预期：

- A 只显示 alpha-channel 相关消息。
- B 只显示 beta-channel 相关消息。
- 工具卡不会从 A 错显示到 B。
- URL session id 与显示内容一致。

## 额外 API 交叉检查

这些只能作为辅助，不能替代页面测试：

```bash
curl -s http://localhost:3100/api/runtime/events?agentId=default\\&limit=20
curl -s http://localhost:3100/api/memories/episodes?limit=20
curl -s http://localhost:3100/api/memories/daily-summaries?limit=7
curl -s http://localhost:3100/api/memories/reviews?status=pending
```

预期：

- 都返回 JSON。
- 不能返回 HTML。如果返回 `<!DOCTYPE html>`，说明路由或代理错了。

## 最终报告格式

Claude Code 最终必须按这个格式输出：

```text
# 类人记忆系统 Chrome DevTools MCP 验收报告

## 环境
- 项目路径：
- 测试时间：
- RUN_ID：
- URL：
- 服务启动命令：
- 浏览器：
- 是否恢复数据备份：

## 总结
- 通过：
- 部分通过：
- 失败：
- 阻塞：

## 用例结果
| Case | 名称 | 结果 | 证据 | 问题 |
| --- | --- | --- | --- | --- |
| 0 | 基础健康检查 | Pass/Partial/Fail | 截图/DOM/Network | |
| 1 | Semantic/Social 跨会话 | Pass/Partial/Fail | | |
...

## 关键证据
- Console error 数量：
- Network 4xx/5xx 数量：
- 出现的工具卡：
- 出现的 Runtime 事件：
- 关键 session URLs：

## 发现的问题
按严重程度排序：
1. [P0/P1/P2/P3] 问题标题
   - 复现步骤：
   - 实际结果：
   - 预期结果：
   - 证据：
   - 可能相关文件：

## 截图
列出关键截图文件或内联截图说明。

## 建议下一步
- 必须修：
- 可优化：
- 暂缓：
```

## 通过标准

必须全部满足才能认为本轮前端验收通过：

1. 页面可打开，Console 无相关 error。
2. 跨会话 semantic/social 回忆通过。
3. 跨会话 episodic 回忆至少部分通过，并能看到 episode 生成事件或 episode 列表。
4. refresh 后历史消息和工具卡不丢失。
5. Memory Panel 四个 tab 可打开。
6. Dream dry-run 可执行并显示结果。
7. Negative case 不编造。
8. Network 关键 API 没有 4xx/5xx。

## 当前阶段允许的 Partial

这些能力在当前第一阶段还没有完全实现，验收时可以标记 `Partial`，但必须记录：

- 自动定时 dream worker：当前还没有每日 03:30 调度，只测手动 dry-run。
- repeated episodes 自动生成 procedural/reflective review item：当前还是后续任务。
- review accept 后真正应用复杂合并/冲突：当前主要验证状态持久化和事件。
- memory strength 强化/衰减：当前还没有落库到 metadata。

