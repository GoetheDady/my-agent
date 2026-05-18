# 前端重构设计

## 目标

将前端从"全局侧边栏导航"重构为"对话为中心 + 独立控制台"的双布局架构。

## 布局架构

两个独立 React Router layout，不使用全局 AppShell。

### ChatLayout（对话区）

路由：`/` 和 `/sessions/:sessionId`

| 区域 | 内容 |
|------|------|
| 顶部栏 | 极简，仅右侧「⚙ 控制台」入口按钮 |
| 侧边栏 | Agent + 会话树（见下方详述） |
| 对话区 | MessageList + ChatInput，现有逻辑不变 |

侧边栏 Agent 会话树：
- 按 Agent 分组展示，每组显示：Agent 名称 + 状态指示灯（●空闲 / ●忙碌 / ○离线）
- 每个 Agent 右侧 `[+]` 创建该 Agent 的新对话
- 下方缩进展示该 Agent 的会话列表
- 点击会话切换对话，当前会话高亮
- 设有「+ 新建对话」按钮，创建时选择目标 Agent

### ConsoleLayout（控制台）

路由：`/console/*`

| 区域 | 内容 |
|------|------|
| 顶部栏 | 「← 返回对话」按钮 + 当前子页面标题 + Agent 状态 |
| 侧边子导航 | 总览/Agents/Tasks/Tools/Skills/Memory/Events/渠道/设置 |
| 内容区 | `<Outlet />` 渲染子页面 |

子导航项目：总览（Dashboard）、Agents、Tasks、Tools、Skills、Memory、Events、渠道（Channels）、设置（Settings）

Dashboard 作为 `/console` 默认首页，展示 Runtime 概览（运行中/已完成/失败任务数、最近事件），复用现有 RuntimeSummary。

## 路由树

```
/                          → ChatPage (ChatLayout)
/sessions/:sessionId       → ChatPage (ChatLayout)
/console                   → ConsoleDashboard (ConsoleLayout)
/console/agents            → AgentsPage
/console/tasks             → TasksPage
/console/tools             → ToolsPage
/console/skills            → SkillsPage
/console/memory            → MemoryPage
/console/events            → EventsPage
/console/channels          → ChannelsPage
/console/settings          → SettingsPage
```

旧路由（`/agents`、`/tasks` 等）不再存在，统一收进 `/console/*`。

## 组件复用

| 现有代码 | 处理 |
|---------|------|
| `features/chat/*` | 原样复用 |
| `features/sessions/SessionSidebar` | 重写为 Agent 分组 + 会话树 |
| `features/memory/MemoryPanel` | 移入 `/console/memory`，不变 |
| `features/runtime/RuntimeSummary` | 移入 ConsoleDashboard，不变 |
| `features/architecture/*` | 可直接移除 |
| `components/common/*` | 控制台内继续使用 |
| `pages/*` | 路由路径改到 `/console/*`，组件内逻辑无需改动 |
| `layouts/AppShell` | 废弃，拆为 ChatLayout + ConsoleLayout |

## Store 变更

六个 Zustand store（agent、chat、session、runtime、memory、realtime）**均不需要改动**。WebSocket 初始化提升到应用顶层，两个 layout 共享连接。

## 不在范围内

- 后端 API 改动
- 新功能开发
- 视觉主题/样式重构（沿用现有 Tailwind 变量和主题）
- 认证/授权系统
