# Agent 架构设计 Spec

> 2026-05-08 更新：本文档保留为早期总体设想。当前 MVP 架构以 `docs/superpowers/specs/2026-05-08-agent-runtime-refactor-design.md` 为准。尤其是本文中“记忆注入 System Prompt”的描述已经被替换为 Memory-as-Tool：长期记忆必须通过工具检索和写入，不再由主 Agent loop 自动注入提示词。

## 概述

基于 TypeScript (Bun) 的多 Agent 协作平台。前期通过 Web 页面对话，后期扩展微信/飞书等渠道。单用户起步，可扩展多用户。

---

## 整体架构：七系统 + 两支撑

```
┌─────────────────────────────────────────────────────────┐
│                      面板系统                            │
│       Chat UI │ Agent 管理 │ 任务面板 │ 配置 │ 通知       │
├─────────────────────────────────────────────────────────┤
│                      信道系统                            │
│           HTTP+SSE (流式回复) + WebSocket (状态推送)       │
│          Web  │  微信(后期)  │  飞书(后期)  │  ...        │
├─────────────────────────────────────────────────────────┤
│                      协作系统                            │
│  Agent 注册 │ 任务委派 │ 消息通知 │ 协商 │ Cron │ Heartbeat│
├─────────────────────────────────────────────────────────┤
│                      大脑系统                            │
│  Loop │ Prompt │ Skills │ Planner │ Provider │ Tools │    │
│  MCP │ 上下文压缩 │ Prompt Cache │ Session Pruning       │
├─────────────────────────────────────────────────────────┤
│                      记忆系统                            │
│  短期记忆 │ 工作记忆 │ 长期记忆 │ 向量检索 │ 遗忘曲线 │    │
│  Dreaming (后台巩固)                                     │
├─────────────────────────────────────────────────────────┤
│                   基础设施 (Core)                         │
│    Config │ Database │ Logger │ 可观测性 │ Hooks (生命周期) │
└─────────────────────────────────────────────────────────┘
                            │
              ┌─────────────┴─────────────┐
              │         插件系统           │
              │  Toolset Registry 等       │
              └───────────────────────────┘
                            │
                  安全护栏 (横切)
              (输入审查 / 工具拦截 / 输出过滤)
```

---

## 系统一：大脑系统

Agent 的"思考 → 行动"循环，是系统的核心引擎。

### 1.1 Agent Loop

```text
收到用户消息
  │
  ▼
┌─ 循环 ───────────────────────────────────┐
│  1. 构建 System Prompt                    │
│     (人格 + 记忆 + 限定条件 + 工具列表)     │
│  2. 拼装消息历史 + 新消息                  │
│  3. 调用 LLM（流式消费事件）               │
│     ├─ text_delta    → 推给前端显示         │
│     ├─ thinking      → 推给前端 (灰色)      │
│     └─ tool_use      → 执行工具 → 继续循环  │
│  4. 无 tool_use → 循环结束                 │
└──────────────────────────────────────────┘
```

关键约束：
- thinking 内容必须回传到下一轮消息（含 signature），否则 API 400
- 工具调用 JSON 只在 `content_block_stop` 时才能 parse（partial_json 不完整）
- 空工具数组不传给 API
- 最大循环轮数由配置控制，防止死循环
- Loop 不关心调用来源（Web/微信/CLI），只关心消息进、事件出

### 1.2 System Prompt 构建器

组装优先级从上到下：

1. **角色人格**（soul.md）：你是谁、擅长什么、语气风格
2. **行为约束**（agent.md）：回复简洁度、语言、格式
3. **记忆注入**（从记忆系统检索）：相关历史、用户偏好
4. **Skills 注入**（渐进式披露）：匹配到的 skill 指令
5. **工具列表**（动态生成）：当前可用的工具 schema（含 MCP 工具）
6. **上下文文件**（AGENTS.md 等）：当前工作区信息

约束：
- 记忆注入按相关性排序 + 截断，不超过配置的 token 上限
- 工具列表对齐 Anthropic tool schema（事实标准）
- 同一轮对话中 System Prompt 不更新，保护 prompt cache

### 1.3 Skills 渐进式披露（后期实现）

让 Agent 根据当前任务**按需加载**领域知识，而不是把所有指令塞进 system prompt。

```
用户: "帮我写个前端页面"
  │
  ▼
Prompt Builder 检测上下文 / 关键词 / 用户显式调用
  │
  ├─ 匹配到 frontend-design skill
  ├─ 加载 skill 指令注入 System Prompt
  └─ Agent 获得前端设计领域的专用知识
```

核心机制：
- **触发方式**：用户显式调用（`/skill frontend-design`）+ 自动匹配（Prompt Builder 根据上下文判断是否激活）
- **注入位置**：skill 内容注入到 System Prompt 的工具列表之前（比工具列表优先级更高，因为 skill 可能影响工具使用方式）
- **生命周期**：一次对话中注入的 skill 可以保持激活，也可按需卸载
- **skill 来源**：项目级（`.opencode/skills/`）、Agent 级（`agents/<id>/skills/`）、用户级（`~/.agent/skills/`）

**为什么不在 system prompt 里写死？**
- 减少 context window 占用：只有相关 skill 才加载
- 可组合：不同 skill 组合应对不同场景，不用写一个超长的万能 prompt
- 可扩展：新增 skill 不需要改核心代码

### 1.4 Planner 动态规划

面对复杂任务时，先制定计划再执行，执行中偏离方向时重新规划。

```
用户: "把这个项目从 JS 迁移到 TS，并跑通所有测试"

Planner:
  │
  ├─ 制定宏观计划：
  │   1. 分析现有文件结构
  │   2. 安装 TypeScript 依赖
  │   3. 逐个文件迁移（约 20 个文件）
  │   4. 修复类型错误
  │   5. 跑测试验证
  │
  ├─ 执行步骤 1-3 ...
  │
  ├─ 步骤 4 发现大量类型错误 → Plan 偏离
  │   重新规划步骤 4-5 为更细的子步骤
  │
  └─ 继续执行直到完成
```

核心机制：
- **Plan → Execute → Reflect → Replan** 循环
- 计划粒度可配置：宏观规划 vs 逐步细化
- 偏离检测：实际执行结果与计划预期对比，LLM 判断是否需重规划
- **多 Agent 场景**：Planner 是协作系统的关键——主控 Agent 制定顶层计划，子 Agent 各自规划自己的子任务

### 1.5 Provider 抽象

多厂商兼容，统一为流式事件接口。前期适配 DeepSeek。

```ts
interface Provider {
  sendMessage(params: {
    model: string;
    system: string;
    messages: Message[];
    tools?: ToolDef[];
    maxTokens: number;
  }): AsyncIterable<ChatEvent>;
}

type ChatEvent =
  | { type: "text_delta"; content: string }
  | { type: "thinking_delta"; content: string }
  | { type: "thinking_done"; signature: string }
  | { type: "tool_use_start"; id: string; name: string }
  | { type: "tool_use_delta"; id: string; partialJson: string }
  | { type: "tool_use_done"; id: string; input: Record<string, unknown> }
  | { type: "text_done" }
  | { type: "error"; message: string };
```

### 1.6 工具注册与调度

- 使用注册表模式：`Map<string, ToolDef>` 存储
- 工具定义对齐 Anthropic tool schema（name, description, input_schema）
- 工具按"工具集 (Toolset)"分组，不同 Agent 可启用不同工具集
- 工具执行错误不抛异常，转为字符串返回给 LLM
- 内建工具：read_file、write_file、execute_command、search_code、web_search、web_fetch

### 1.7 MCP 集成（后期实现）

Model Context Protocol，让工具不再只能内建，而是可以对接外部 MCP Server。

```
Agent 启动
  │
  ├─ 扫描配置的 MCP Server 列表
  ├─ 通过 stdio / HTTP 连接 MCP Server
  ├─ 拉取 tool schema → 注册到 ToolRegistry
  └─ 跟内建工具一样使用
```

核心机制：
- **协议**：MCP 标准协议（JSON-RPC over stdio / HTTP SSE）
- **发现**：从配置文件读取 MCP Server 列表，启动时自动连接
- **工具注册**：MCP Server 暴露的工具 schema 自动注册到 ToolRegistry，对 Agent Loop 透明
- **生命周期**：连接池管理，断线重连，健康检查

**与内建工具的关系：**
- 内建工具：代码直接实现，适合高频、核心操作（读写文件、执行命令）
- MCP 工具：外部进程提供，适合低频、专用操作（数据库查询、第三方 API）
- Agent 不区分来源，统一通过 ToolRegistry 调用

### 1.8 上下文压缩

当对话历史过长超出 context window 时，自动压缩中间轮次。

```
原始对话：
  [turn1] [turn2] [turn3] ... [turn18] [turn19] [turn20]
                                  ↑ 超出窗口

压缩后：
  [turn1] [turn2] [压缩摘要(turn3-train17)] [turn18] [turn19] [turn20]
               ↑ 保留头和尾，中间压缩为摘要
```

核心机制：
- **触发条件**：消息总 token 数超过配置阈值（如窗口的 80%）
- **压缩策略**：保留首尾 N 轮完整内容，中间轮次由 LLM 生成摘要替代
- **摘要包含**：关键决策、工具调用及结果、未完成的任务状态
- **会话血统**：压缩后生成子会话，记录 parent 关系，可追溯完整历史
- **多 Agent 场景**：子 Agent 执行长任务时自己的会话也需要压缩

### 1.9 Prompt 缓存

利用 LLM 提供商的 prompt 缓存能力，减少重复 token 消耗。

核心机制：
- **缓存断点**：在 System Prompt 中标记缓存边界（Anthropic 的 `cache_control`）
- **缓存策略**：固定内容（人格 + 约束 + 工具列表）放缓存区，动态内容（记忆 + 消息历史）放非缓存区
- **缓存失效**：仅在用户切换 Agent / 开关工具 / 修改配置时系统提示变化，自然触发缓存刷新
- **多厂商适配**：Anthropic / OpenAI / DeepSeek 均有各自的缓存 API，Provider 层统一封装

### 1.10 Session Pruning

定期清理对话中的冗余工具结果，控制 token 膨胀。

核心机制：
- **剪枝对象**：旧的 tool_result 内容（文件内容等可能很大的文本块）
- **剪枝策略**：TTL 模式——超过 N 小时的工具结果自动裁剪，仅保留"执行成功 / 失败"的状态摘要
- **保留原则**：最近 N 轮工具结果不裁剪，保留对话连贯性
- **多 Agent 场景**：Agent 间委派任务产生的中间结果更容易膨胀，需要更激进的剪枝策略

### 1.11 对话存储

- 主存储：SQLite（WAL 模式支持多进程并发读）
- 存储粒度为 Message（role + content blocks）
- 支持加载历史、追加消息、会话列表
- 接口不变，未来可扩展 PostgreSQL

---

## 系统二：记忆系统

让 Agent 记住用户偏好、历史决策、项目上下文，跨会话持久化。

### 2.1 三层记忆模型

| 层级 | 存活时间 | 存储 | 作用 |
|------|----------|------|------|
| 短期记忆 | 当前会话 | 消息历史（上下文窗口内） | LLM 直接看到的内容 |
| 工作记忆 | 数小时~数天 | 向量索引 + 时间衰减 | "用户刚说想重构项目" |
| 长期记忆 | 永久 | SQLite + 向量索引 + 遗忘曲线 | "用户是前端开发，偏好 React" |

### 2.2 记忆生命周期

```
对话结束
  │
  ▼
异步触发记忆提取（fire-and-forget，不阻塞用户）
  │
  ▼
LLM 审视对话 → 提取值得记住的事实 → Embedding → 向量库
  │
  ▼
下一次对话：
  当前消息 → Embedding → 向量搜索 → 找到相关记忆
  → 按遗忘曲线计算权重 → Top-N 注入 System Prompt
```

### 2.3 遗忘机制

- 基于艾宾浩斯遗忘曲线：最近使用的记忆权重高，长期不用逐渐衰减
- 不是真删除，而是降低向量检索的排序权重
- 定期由 Memory Worker 执行衰减计算

### 2.4 Memory Worker 独立进程

- 负责记忆提取、向量化、衰减计算
- 与主进程共享 SQLite/LanceDB
- 支持轮询模式和 `--once` 模式
- 主进程写入 job 后立即返回，Worker 异步处理

### 2.5 记忆反思

- 记忆提取时隐含反思能力：LLM 审视对话，提取经验教训
- 好的实践沉淀为长期记忆（"这种写法更容易维护"）
- 失败的尝试也记下来（"上次用 xx 方式出错了，因为 yy"）

### 2.6 Dreaming 后台记忆巩固（后期实现）

比"提取即写入"更结构化的记忆处理流水线，分阶段执行：

```
对话结束
  │
  ▼
Memory Worker 触发 Dreaming 流程（异步，不阻塞用户）
  │
  ├─ Light 阶段：暂存本对话的所有记忆候选项，按重要性初排
  │
  ├─ Deep 阶段：LLM 对候选项评分，决定提升为长期记忆 or 丢弃
  │    评分维度：可复用性、特异性、与已有记忆的冲突/互补
  │
  └─ REM 阶段：对近期记忆做主题聚类，发现跨会话的模式
       "用户连续 3 次询问性能优化 → 记下'用户关注性能'"
  │
  ▼
产出 Dream Diary（可审查日志），用户可查看/编辑/回滚
```

**与简单记忆提取的区别：**
- 简单提取：对话结束 → 直接写向量库（一步到位）
- Dreaming：暂存 → 评分 → 聚类 → 写库 + 日志（多步处理，更精准）
- Dream Diary 让用户对记忆有控制权（审核/删除）

### 2.7 多 Agent 场景下的记忆隔离

- 每个 Agent 有独立的向量库和记忆空间
- 可选的"共享记忆"：团队笔记类信息写入公共空间，可被其他 Agent 检索

---

## 系统三：信道系统

将不同外部入口统一适配为大脑系统能理解的标准请求。

### 3.1 两个通道

| 通道 | 用途 | 协议 |
|------|------|------|
| 流式回复通道 | 用户发消息 → Agent 流式返回打字机效果 | HTTP POST → SSE |
| 状态推送通道 | 服务端主动推状态变更 | WebSocket |

**为什么不是单一 WebSocket？**
- SSE 天然适配请求-响应模型：一次 POST 对应一个 SSE 流，流结束连接释放
- WebSocket 长连接适合服务端主动推送（Agent 状态、配置变更、通知）
- 两者职责不同，混在一起反而复杂

### 3.2 SSE 流式回复

```
POST /api/chat  { message, sessionId }
  →
  SSE stream:
    event: text_delta
    data: {"content":"好的"}

    event: tool_use
    data: {"name":"read_file","input":{"path":"..."}}

    event: thinking
    data: {"content":"这里是思考过程..."}

    event: done
    data: {"sessionId":"xxx"}
```

### 3.3 WebSocket 状态推送

```
WS /ws
  ← server push:
    { type: "agent_status", agentId: "coder", status: "busy" }
    { type: "task_completed", taskId: "xxx", result: "..." }
    { type: "config_updated", agentId: "reviewer" }
    { type: "notification", message: "Memory 提取完成" }
```

前端通过 WebSocket 收到事件后，需要更多数据时再发 HTTP 请求查询（不通过 WS 做请求-响应）。

### 3.4 Channel Adapter 接口

```ts
interface ChannelAdapter {
  readonly channelType: string;

  // 渠道原始消息 → 标准请求
  parseIncoming(raw: unknown): Promise<ChannelRequest>;

  // 流式事件推给用户
  sendEvent(session: ChannelSession, event: ChatEvent): Promise<void>;

  // 发送最终回复
  sendResponse(session: ChannelSession, response: AgentResponse): Promise<void>;
}
```

### 3.5 Gateway

管道的统一入口进程：

- 注册所有 ChannelAdapter，统一启动
- 统一消息路由：渠道消息 → 解析 → 大脑系统 → 流式返回
- 后期扩展微信/飞书：只需实现 ChannelAdapter，Gateway 不变

### 3.6 会话管理

- 跨渠道用户会话绑定：同一个用户在不同渠道看到同一对话历史
- 支持多会话：用户可以同时开多个对话
- 会话与 Agent 绑定：每个会话指定由哪个 Agent 处理

---

## 系统四：协作系统

让多个 Agent 可以委派任务、互相通知、协商讨论。

### 4.1 Agent 工作区

每个 Agent 是独立的"人格体"：

```
agents/
├── coder/                    # 编程助手
│   ├── soul.md              # "你是一个资深前端工程师..."
│   ├── agent.md             # 行为约束
│   ├── config.json          # model, toolsets, maxTokens
│   ├── data.sqlite          # 独立会话存储
│   └── memory-lancedb/      # 独立向量索引
│
├── reviewer/                 # 代码审查员
│   ├── soul.md
│   ├── agent.md
│   ├── config.json
│   ├── data.sqlite
│   └── memory-lancedb/
│
└── researcher/               # 技术研究员
    └── ...
```

**为什么每个 Agent 独立存储？**
- 记忆隔离：每个 Agent 的专长领域不同，记忆不应混杂
- 并发安全：多 Agent 同时运行不互相锁表
- 独立生命周期：增删 Agent 不影响其他

### 4.2 Agent 注册中心

- 扫描 `agents/` 目录发现 Agent
- 维护 Agent 状态（idle / busy / offline）
- 提供能力标签（skills）供任务匹配

### 4.3 三种协作模式

#### 任务委派（wait 模式）

Agent A 把子任务派给 Agent B，等结果后继续：

```
Agent A                          Agent B
  │                                │
  ├─ 创建任务 {target: "B",        │
  │    instruction: "...",         │
  │    mode: "wait"}               │
  │                                │
  │──→ 写入任务队列 ──────────────→ │
  │                                ├─ AgentRunner 唤醒
  │                                ├─ 执行任务
  │                                └─ 写结果
  │ ←── 轮询等待 ───────────────── │
  │   status: completed            │
  │   result: "..."                │
  ├─ 拿到结果，继续自己的 Loop      │
```

#### 消息通知（notify 模式）

Agent A 告诉 Agent B 某件事发生了，不等回复：

```
Agent A ──→ AgentInbox.send({to: "B", type: "deploy_success", ...})
                                                 │
Agent B (下次被唤醒时) ←── AgentInbox.poll() ─────┘
  └─ 看到通知，记入自己的记忆
```

#### Agent 协商

多个 Agent 在共享上下文中轮流发言，达成共识：

```
Orchestrator 指定参与方和轮次上限
  │
  ▼
轮流给每个 Agent 发言机会：
  [所有历史发言 + 讨论目标] → Agent Loop → 新发言
  │
  ▼
达成共识（LLM 判断 / 投票 / 轮次上限）
  │
  ▼
输出共同结论
```

### 4.5 Cron 定时调度

让 Agent 按计划自主执行任务，不依赖用户触发。

```text
配置示例：
  cron:
    - schedule: "0 9 * * *"
      agent: "researcher"
      prompt: "汇总过去24小时的 GitHub Trending 项目"
      deliverTo: "user:web"

    - schedule: "*/30 * * * *"
      agent: "monitor"
      prompt: "检查所有 Agent 是否在线，不在线的尝试重启"

    - schedule: "0 18 * * 5"
      agent: "coder"
      prompt: "生成本周代码提交统计报告"
```

核心机制：
- **调度格式**：支持 crontab + 自然语言（"每30分钟"、"每周五18点"）
- **执行模式**：fresh（无历史的新会话）、continuation（延续上次会话）
- **结果投递**：推送到指定渠道（Web 通知 / 微信 / 飞书）或写入共享记忆
- **重试与超时**：失败重试 N 次，单次最长执行时间限制
- **与 Heartbeat 配合**：Cron 定时触发任务，Heartbeat 让 Agent 主动检查是否有新任务

### 4.6 Heartbeat 自主心跳

在没有用户输入时，Agent 也能主动检查收件箱、执行 cron 任务、推进长期目标。

```text
Agent 处于 idle 状态时：

每 N 分钟心跳触发：
  │
  ├─ 检查 AgentInbox：有新通知吗？→ 处理
  ├─ 检查 TaskQueue：有给我的待办任务吗？→ 执行
  ├─ 检查 Cron：有到期的定时任务吗？→ 执行
  ├─ 检查 Standing Orders：有什么该做的事？→ 推进
  └─ 无事可做 → 维持 idle
```

核心机制：
- **心跳间隔**：可配置（默认 3 分钟），不同 Agent 不同频率
- **活跃时段**：可配置工作时间（如 9:00-18:00），避免半夜骚扰
- **独立会话**：心跳产生的会话与用户对话平行，不污染主会话历史
- **心跳协议**：`HEARTBEAT_OK`（无事发生）/ `HEARTBEAT_ACTION`（有事执行）

### 4.7 Agent Runner（后台调度器）

常驻进程，每 N 秒扫描：

1. 任务队列：有 pending 任务 → 拉起目标 Agent Loop
2. 收件箱：有未读通知 → 推送给对应 Agent
3. 协商空间：有 active 协商 → 轮到谁发言就拉起谁

---

## 系统五：插件系统

让工具、渠道、记忆提供者等能力可按需扩展。

### 5.1 插件类型

- **工具插件**：注册新工具 schema + handler
- **工具集**：一组工具的命名集合，Agent 通过 config 声明启用哪些
- **Memory Provider 插件**：替换记忆后端（默认 LanceDB，可换其他向量库）
- **Channel 插件**：新增渠道适配器

### 5.2 注册机制

- 工具：显式注册到 ToolRegistry
- 渠道：通过 Gateway.register(adapter)
- 记忆：单槽位，同时只有一个 MemoryProvider 激活

---

## 系统六：安全护栏

横切关注点，嵌在关键路径上。

### 6.1 三个拦截点

```
用户输入
  │
  ▼
[输入审查] ← 注入检测、敏感词过滤
  │
  ▼
大脑系统 ──→ 工具调用
              │
              ▼
         [工具拦截] ← 危险操作二次确认、权限检查
              │
              ▼
LLM 输出
  │
  ▼
[输出过滤] ← 敏感信息脱敏、有害内容拦截
  │
  ▼
返回给用户
```

### 6.2 规则

- 敏感操作（删文件、执行命令、调外部付费 API）需用户确认
- 单次任务限制：最大 token 消耗、最多工具调用轮数、最长执行时间
- 权限模型初版简单：单用户全权，多用户时引入 ACL
- 安全规则不硬编码，通过配置或 hook 注入

---

## 支撑一：可观测性

### 7.1 埋点

| 埋点位置 | 记录内容 |
|----------|----------|
| LLM 调用 | 耗时、token 消耗、模型名、是否重试 |
| 工具调用 | 工具名、参数摘要、执行耗时、成功/失败 |
| Agent Loop | 轮次、总耗时、结束原因 |
| 记忆提取 | 提取条数、embedding 耗时 |
| 任务委派 | 源/目标 Agent、等待时间、结果状态 |

### 7.2 Trace

- 每个请求生成唯一 traceId，贯穿整个调用链
- 结构化日志（JSON），支持导出
- 预留 OpenTelemetry 集成点

---

## 支撑二：基础设施

### 8.1 Config
- JSON 配置文件，支持 `$ENV_VAR` 环境变量替换
- 配置校验（zod schema）
- Agent 级别覆盖：每个 Agent 的 config.json 覆盖全局默认值

### 8.2 Database
- 统一数据库接口，单用户 SQLite，预留 PostgreSQL
- WAL 模式支持并发
- 连接池（多 Agent 场景）

### 8.3 Logger
- 结构化日志（JSON），支持级别过滤
- 线上环境脱敏（不输出 API key、用户消息内容等）

### 8.4 Hooks 生命周期

横切的事件系统，允许插件在关键节点注入逻辑。

```text
Agent 生命周期中的钩子点：

  agent:beforeStart    → Agent Loop 启动前
  agent:afterStart     → Agent Loop 启动后
  llm:beforeCall       → 调用 LLM 前（可修改 messages）
  llm:afterCall        → LLM 返回后（可修改响应）
  tool:beforeExecute   → 工具执行前（可拦截/替换参数）
  tool:afterExecute    → 工具执行后（可修改结果）
  turn:beforeCompress  → 上下文压缩前
  turn:afterCompress   → 上下文压缩后
  memory:beforeExtract → 记忆提取前
  memory:afterExtract  → 记忆提取后
  agent:beforeStop     → Agent Loop 结束前
  agent:afterStop      → Agent Loop 结束后
```

核心机制：
- **注册方式**：插件通过 `hooks.register(event, handler)` 注册
- **执行顺序**：多个 handler 注册同一事件时按优先级顺序执行
- **可中断**：handler 可返回 `{ abort: true, reason: "..." }` 阻止后续流程
- **与安全护栏的关系**：安全护栏通过 hooks 实现（`tool:beforeExecute` 拦截危险操作）

---

## 系统七：面板系统

Web 前端界面，这本身就是产品的核心形态，不只是"管理后台"。

### 7.1 对话页

- SSE 流式打字机效果：text/thinking/tool_use 分类型渲染
- 消息历史 + Markdown 渲染 + 代码高亮
- 多会话切换（侧边栏会话列表）
- 消息操作：重新生成、编辑后重发、复制、分享
- /agent 切换命令：切换当前对话使用的 Agent
- /skill 激活命令：手动激活 skill

### 7.2 Agent 管理

- Agent 列表 + 状态（idle/busy/offline）：WebSocket 实时更新
- 新增/删除/配置 Agent（编辑 soul.md / agent.md / config.json）
- 工具集开关：按 Agent 启用/禁用工具集
- 模型切换：按 Agent 切换模型和参数
- Agent 间对比：并排查看多个 Agent 的能力和状态

### 7.3 任务面板

- 任务队列视图：pending / running / completed / failed
- 任务详情：源 Agent、目标 Agent、指令、上下文、执行耗时
- 任务手动干预：重试失败任务、取消 pending 任务
- Agent 间消息流：可视化任务委派链

### 7.4 记忆面板

- 记忆列表：按 Agent、时间、类型筛选
- 记忆详情：原文、向量相似度、遗忘权重
- Dream Diary：查看 Dreaming 各阶段产出，审核/删除记忆
- 记忆手动添加/编辑

### 7.5 配置页

- 全局模型切换
- Providers 管理（API key 等敏感信息脱敏展示）
- Cron 任务管理（新增/暂停/删除）
- Heartbeat 配置
- 安全护栏规则配置

### 7.6 通信

- **SSE**：`POST /api/chat` → `EventSource` 消费打字机流
- **WebSocket**：`/ws` → 接收状态变更事件，UI 被动刷新
- **REST API**：查询类操作走 HTTP（会话列表、Agent 配置等）
- 前端收到 WS 事件后，如需详细数据再发 HTTP 请求——WS 不承担请求-响应职责

---

## 关键设计原则

1. **入口无关**：大脑系统不关心调用来源，一个 Loop 服务所有渠道
2. **接口隔离**：所有外部依赖（Provider、DB、Embedding、Memory）通过接口抽象，改实现只改初始化
3. **独立存储**：每个 Agent 有独立的 SQLite + 向量库，隔离且并发安全
4. **异步优先**：记忆提取、Dreaming、Cron 执行等耗时操作异步/后台处理
5. **流式优先**：所有 LLM 调用走流式，实时推给前端
6. **安全嵌入**：护栏不在一个独立模块，而是通过 Hooks 嵌入关键路径
7. **渐进增强**：Skills、MCP、Dreaming 等高级功能接口预先定义，实现可后补

---

## 技术选型

| 层面 | 选择 |
|------|------|
| 语言/运行时 | TypeScript + Bun |
| LLM Provider | DeepSeek（前期），接口预留多厂商 |
| 数据库 | SQLite (WAL)，接口预留 PostgreSQL |
| 向量索引 | LanceDB |
| Embedding | 智谱 API（前期），接口可换 |
| 前端 | Web（具体技术栈未定） |
| 通信 | HTTP + SSE (流式回复) + WebSocket (状态推送) |
| Skills | 渐进式披露，Markdown 文件（后期实现） |
| MCP | Model Context Protocol 工具集成（后期实现） |
| Planner | Plan → Execute → Replan 动态规划（后期实现） |
| 上下文压缩 | Lossy 摘要压缩 + Prompt 缓存（后期实现） |
| Dreaming | 三阶段记忆巩固：Light → Deep → REM（后期实现） |
| Cron | 定时任务调度（后期实现） |
| Heartbeat | Agent 自主心跳（后期实现） |
| Hooks | 生命周期事件系统 |

---

## 与当前项目结构的映射

| 当前目录 | 目标系统 |
|----------|----------|
| `agent/` `providers/` `tools/` `conversation/` `runtime/` | → 大脑系统 |
| `memory/` `embeddings/` `memory-worker.ts` | → 记忆系统 |
| `main.ts` `server.ts` | → 信道系统 |
| `agents/` `agent-runner.ts` | → 协作系统 |
| `loader/` `db/` `storage/` | → 基础设施 |
| 新建 | → 面板系统 |
| 新建 | → Hooks 系统（或并入基础设施） |

---

## 重构路径建议

| 阶段 | 内容 | 理由 |
|------|------|------|
| **1. 抽基础设施** | `loader/` `db/` `storage/` → `core/`，引入 Hooks 接口 | 地基不牢上面没法盖 |
| **2. 重构大脑系统** | `agent/` `providers/` `tools/` `conversation/` `runtime/` → `brain/` | 核心引擎，其他系统依赖它 |
| **3. 重构记忆系统** | `memory/` `embeddings/` `memory-worker.ts` → `memory/` | 本身已较独立，改动小 |
| **4. 重构协作系统** | `agents/` `agent-runner.ts` → `collab/`，补 TaskQueue/Inbox | 基于新的大脑系统接口 |
| **5. 重构信道系统** | `main.ts` `server.ts` → `channels/`，补 Gateway + SSE + WS | 外壳，最后做 |
| **6. 搭建面板系统** | 新建 Web 前端，对话页 + Agent 管理 + 配置 | 产品形态 |
| **7. 补安全护栏** | 通过 Hooks 在大脑系统和工具系统中嵌入拦截 | 新增能力 |
| **8. 补可观测性** | Logger + Trace 升级 | 新增能力 |
| **后期迭代** | | |
| **9. Skills 系统** | 渐进式披露机制，Skill 发现/匹配/注入 | |
| **10. MCP 集成** | MCP Server 连接/工具发现/注册 | |
| **11. Planner** | Plan → Execute → Replan 循环 | |
| **12. 上下文压缩** | 压缩 + Prompt Cache + Session Pruning | |
| **13. Dreaming** | 记忆三阶段巩固 | |
| **14. Cron + Heartbeat** | 定时调度 + 自主心跳 | |
