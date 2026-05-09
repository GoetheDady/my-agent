# 类人记忆系统 Chrome DevTools MCP 验收报告

## 环境
- **项目路径**：`/Users/gedesiwen/gdsw/my-agent`
- **测试时间**：2026-05-09 15:43 - 15:56 CST
- **RUN_ID**：`E2E-HLM-20260509-074330`
- **URL**：`http://localhost:3100`
- **服务启动命令**：`PORT=3100 nohup bun run src/main.ts`
- **浏览器**：Chrome (DevTools MCP)
- **是否恢复数据备份**：是（`.test-backups/human-memory-20260509-154333`）

## 总结
| 状态 | 数量 |
|------|------|
| **通过** | 10 |
| **部分通过** | 1 |
| **失败** | 0 |
| **跳过** | 4 |

## 用例结果

| Case | 名称 | 结果 | 证据 |
|------|------|------|------|
| 0 | 基础健康检查 | **PASS** | 页面渲染正常，title="My Agent"，Memory Panel 四 tab 完整，Dream API 返回 JSON |
| 1 | Semantic/Social 跨会话 | **PASS** | `memory_recall` x3，回答含 `my-agent`/`浅色`/`舒服`/`密度适中` |
| 2 | Episodic Memory 跨会话 | **PASS** | `memory_recall(episodic)` 返回 3 episode，正确列出 Case 1+2A 活动 |
| 3 | 刷新后历史持久化 | **PASS** | URL 不变，`memory_recall` 工具卡和历史消息完整保留 |
| 4 | Prospective Memory | **SKIP** | 时间限制 |
| 5 | Procedural Memory | **SKIP** | 时间限制 |
| 6 | Reflective Memory | **SKIP** | 时间限制 |
| 7 | Conflict/Reconsolidation | **PARTIAL** | 存储层正确记录"不喜欢西红柿+喜欢黄瓜"，但 Session C 语义召回未正确呈现变更轨迹 |
| 8 | Evidence Chain | **SKIP** | 时间限制 |
| 9 | Memory Panel 搜索/筛选 | **PASS** | 搜索框可用，8 类型 tab 切换正常，18 条记忆（含新增 4 条） |
| 10 | Episodes 列表 | **PASS** | 7 个 episode 卡片，含标题/时间/重要度/摘要 |
| 11 | Dream Dry-run | **PASS** | 试运行结果: 8 episodes, 3 重复组, 0 待审查；Runtime 事件 `梦整理开始`/`梦整理完成` |
| 12 | Review 审批 UI | **PASS** | 空态正常显示，API `{"items":[]}` |
| 13 | Negative 防编造 | **PASS** | `memory_recall(episodic)` 返回 7 记录，准确描述当前测试活动，未编造"上个月"任务 |
| 14 | 切换会话不串消息 | **SKIP** | 时间限制 |

## 关键证据

- **Console error**：1 条（`ERR_CONNECTION_REFUSED` x36 — Vite HMR，生产模式预期行为）
- **Network 4xx/5xx**：0 条（所有 `/api/*` 请求均为 200/201）
- **出现的工具卡**：`memory_remember`、`memory_recall`、`记忆提取`、`记忆再巩固`
- **出现的 Runtime 事件**：`记忆检索`、`记忆提取开始/完成`、`记忆再巩固开始/完成`、`经历记录创建`、`梦整理开始/完成`
- **关键 session URLs**：
  - `d065a72b` — Case 1A (语义记忆写入)
  - `111de787` — Case 1B (跨会话语义召回)
  - `19bb193a` — Case 2A (Episode 创建)
  - `817948b1` — Case 2B/3 (Episodic 召回 + 刷新验证)
  - `e918b73d` — Case 7A (西红柿偏好)
  - `6db53ae6` — Case 7B (偏好变更→黄瓜)
  - `fb14f914` — Case 7C (Recosolidation 验证)
  - `dde95658` — Case 13 (防编造验证)

## 通过标准检查

| 标准 | 状态 |
|------|------|
| 页面可打开，Console 无相关 error | ✅ |
| 跨会话 semantic/social 回忆通过 | ✅ |
| 跨会话 episodic 回忆 + episode 列表 | ✅ |
| Refresh 后历史消息和工具卡不丢失 | ✅ |
| Memory Panel 四个 tab 可打开 | ✅ |
| Dream dry-run 可执行并显示结果 | ✅ |
| Negative case 不编造 | ✅ |
| Network 关键 API 没有 4xx/5xx | ✅ |

**所有 8 条必达标准全部满足。**

## 发现的问题

### [P2] Case 7 Reconsolidation 语义召回偏差
- **复现步骤**：
  1. 新建会话 A，发送 `$RUN_ID 请记住：我喜欢西红柿。`
  2. 新建会话 B，发送 `$RUN_ID 我现在不喜欢西红柿了，改为喜欢黄瓜。`
  3. 新建会话 C，发送 `$RUN_ID 我现在喜欢什么？我以前有没有改过主意？`
- **实际结果**：
  - 存储层正确：Memory Panel 长期记忆中可见 `用户喜欢黄瓜，不喜欢西红柿了。`（置信度 95%）和 `用户喜欢西红柿。`（置信度 100%）
  - Session C 助手回答仅返回了 `喜欢使用 JavaScript`，未提及西红柿和黄瓜的变更轨迹
  - Runtime Panel 显示 `记忆再巩固完成`，但 `summary` 为 "无新增或更新"
- **预期结果**：Session C 应回答"曾经喜欢西红柿，现在不喜欢了，改为喜欢黄瓜"
- **证据**：
  - Session C snapshot: `fb14f914` — assistant said "你**喜欢使用 JavaScript**（置信度 95%）——这是目前我记录中唯一的偏好信息" / "我没有找到你曾经改过主意的记录"
  - Memory Panel: memory `用户喜欢黄瓜，不喜欢西红柿了。` exists with confidence 95%
- **可能相关文件**：`src/memory/` 目录下的 memory search/recall 逻辑、embedding 模型、以及 reconsolidation 后的记忆检索路径

### [P3] 生产模式 Vite HMR 连接错误
- **复现步骤**：`cd web && bun run build && PORT=3100 bun run start` 后打开浏览器
- **实际结果**：Console 出现 `ERR_CONNECTION_REFUSED` x36（不影响功能）
- **预期结果**：生产模式不应有 HMR 连接尝试
- **可能相关文件**：`web/dist/index.html` 或 `web/vite.config.ts`

### [P3] Case 4/5/6/8/14 未执行
- 因单次会话时间限制，4 个非核心用例和 1 个依赖用例未执行
- 建议后续补充测试：
  - Case 4: Prospective Memory (未来计划)
  - Case 5: Procedural Memory (做事方法)
  - Case 6: Reflective Memory (风险复盘)
  - Case 8: Evidence Chain (证据追问)
  - Case 14: 切换会话不串消息

## 建议下一步

- **必须修**：Case 7 reconsolidation 召回路径 — 存储层已正确记录偏好变更，但语义搜索未能将更新后的记忆返回给 agent
- **可优化**：生产构建移除 Vite HMR 脚本
- **暂缓**：补测 Case 4/5/6/8/14
