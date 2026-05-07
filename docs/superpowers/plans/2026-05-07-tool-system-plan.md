# 工具系统实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现基础工具系统，支持文件读写操作和安全的用户审批机制

**Architecture:** 基于 Vercel AI SDK 6.0 的 needsApproval 机制，后端实现工具定义和执行逻辑，前端显示审批 UI，支持路径白名单配置

**Tech Stack:** Bun + Hono + Vercel AI SDK 6.0 + React + @ai-sdk/react + Zod

---

## 任务概览

本计划分为 4 个主要任务组：

1. **后端基础** - 配置扩展、工具执行器、工具定义
2. **前端 UI** - 审批卡片组件、消息渲染集成
3. **白名单管理** - API 路由、前端集成
4. **测试验证** - 单元测试、集成测试

详细任务步骤见以下文件：
- [任务 1-3: 后端基础](./2026-05-07-tool-system-plan-backend.md)
- [任务 4-6: 前端 UI](./2026-05-07-tool-system-plan-frontend.md)
- [任务 7-8: 白名单管理](./2026-05-07-tool-system-plan-whitelist.md)
- [任务 9-10: 测试验证](./2026-05-07-tool-system-plan-testing.md)

---

## 实现顺序

按照以下顺序执行任务：

1. Task 1: 扩展配置系统
2. Task 2: 实现工具执行器
3. Task 3: 定义工具并集成到聊天路由
4. Task 4: 创建工具审批 UI 组件
5. Task 5: 集成审批 UI 到消息渲染
6. Task 6: 添加审批处理逻辑到 ChatView
7. Task 7: 实现白名单管理 API
8. Task 8: 前端调用白名单 API
9. Task 9: 编写单元测试
10. Task 10: 手动集成测试

---

## 关键文件清单

**后端**：
- `src/core/config.ts` - 扩展配置接口
- `src/brain/tool-executor.ts` - 新建，工具执行逻辑
- `src/brain/tools.ts` - 修改，工具定义
- `src/routes/tools.ts` - 新建，白名单 API
- `src/main.ts` - 注册工具路由

**前端**：
- `web/src/components/ToolApprovalCard.tsx` - 新建，审批 UI
- `web/src/components/MessageBubble.tsx` - 修改，渲染审批卡片
- `web/src/components/ChatView.tsx` - 修改，审批处理逻辑

**测试**：
- `src/brain/tool-executor.test.ts` - 新建，单元测试

---

## 前置条件

- 项目已安装 `ai` 和 `@ai-sdk/react` 包
- 前端已使用 `useChat` hook
- 后端已使用 `streamText` 进行对话流式传输
