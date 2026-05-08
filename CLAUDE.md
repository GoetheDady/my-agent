# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

这是一个基于 Bun + Hono + Vercel AI SDK 的 AI Agent 系统，包含后端 API 和 React 前端。系统支持多会话对话、长期记忆存储与检索、以及 DeepSeek 模型的 thinking 模式。

## Architecture

### Backend (src/)
- **Runtime**: 优先使用 Bun，兼容 Node.js。运行时检测在 `src/core/runtime.ts`
- **Web Framework**: Hono，路由在 `src/routes/`
- **AI SDK**: Vercel AI SDK (`ai` package) + `@ai-sdk/deepseek`
- **Database**: 
  - SQLite (Bun.sqlite) 用于会话和消息存储 (`data/agent.sqlite`)
  - LanceDB 用于向量记忆存储 (`data/memories.lancedb`)

### Frontend (web/)
- **Framework**: React 19 + Vite + TypeScript
- **State Management**: Zustand
- **Styling**: Tailwind CSS 4
- **AI Integration**: `@ai-sdk/react` 的 `useChat` hook

### Key Modules

**会话管理** (`src/channels/session-api.ts`):
- 会话和消息的 CRUD 操作
- 使用 SQLite 持久化，支持 WAL 模式并发读

**记忆系统** (`src/memory/`):
- `store.ts`: LanceDB 向量存储，支持混合检索（向量相似度 + TF-IDF 文本匹配）
- `embedder.ts`: 智谱 AI embedding-3 模型
- `extract.ts`: 从对话中提取结构化记忆
- `prefetch.ts`: 后台预取记忆，减少对话延迟
- `memory.ts`: 记忆注入到 system prompt，带 prompt injection 防护

**路由** (`src/routes/`):
- `chat.ts`: 流式对话 API，支持 thinking 模式、记忆注入、自动生成会话标题
- `sessions.ts`: 会话列表、创建、删除、消息历史
- `memory.ts`: 记忆提取、列表、统计

**前端状态** (`web/src/store/`):
- `chatStore.ts`: 会话 ID、thinking 开关、记忆提取状态
- `sessionStore.ts`: 会话列表管理
- `memoryStore.ts`: 记忆面板数据

## Development Commands

### Backend
```bash
# 开发模式（热重载）
bun run dev

# 生产运行
bun run start

# 测试
bun test
bun test --watch

# 代码检查
bun run lint
bun run typecheck
bun run check  # lint + typecheck
```

### Frontend
```bash
cd web

# 开发服务器
bun run dev

# 构建生产版本
bun run build

# 预览构建结果
bun run preview
```

### Full Stack Development
后端会自动服务前端构建产物（`web/dist`），因此：
1. 前端开发：`cd web && bun run dev`（独立 Vite 服务器，支持 HMR）
2. 后端开发：`bun run dev`（根目录）
3. 生产部署：先 `cd web && bun run build`，再 `bun run start`

## Configuration

### Environment Variables
必需的环境变量（在 `.env` 文件中配置）：
- `DEEPSEEK_API_KEY`: DeepSeek API 密钥
- `ZHIPU_API_KEY`: 智谱 AI API 密钥（用于 embedding）
- `PORT`: 服务端口（可选，默认 3000）

### Config File
可选的 `config.json`（根目录）：
```json
{
  "provider": {
    "apiKey": "$DEEPSEEK_API_KEY",
    "model": "deepseek-v4-flash",
    "baseURL": "https://api.deepseek.com"
  }
}
```

配置优先级：环境变量 > config.json > 默认值

## Important Patterns

### 会话创建时机
- 前端在发送第一条消息前必须先创建会话（`sessionStore.createSession()`）
- 后端 `/api/chat` 如果收到 `sessionId: null`，会创建新会话但会打印警告
- 避免重复创建：前端已有 `handleNew` 守卫逻辑

### 记忆提取流程
1. 用户发送消息 → 后端流式返回响应
2. `onFinish` 回调触发 `queuePrefetch(assistantText)` 后台预取
3. 前端收到完整响应后，调用 `/api/memory/extract` 提取记忆
4. 提取状态存储在 `chatStore.memoryStatusMap[messageId]`

### Thinking 模式
- 前端通过 `chatStore.thinkingEnabled` 控制
- 后端在 `streamText` 的 `providerOptions.deepseek.thinking` 传递
- 响应中 `type: "thinking"` 的 block 会被前端渲染为折叠的推理过程

### 静态文件服务
- 后端 `src/main.ts` 内联实现静态文件服务（不依赖 `hono/serve-static`）
- 所有非 `/api/*` 路由都会尝试从 `web/dist` 读取文件
- 404 时回退到 `index.html`（支持前端路由）

## Testing

### Backend Tests
- 使用 Bun 内置测试运行器
- 测试文件命名：`*.test.ts`
- 示例：`src/memory/embedder.test.ts`

### Frontend Tests
- 前端测试文件：`web/src/lib/*.test.ts`
- 使用 Bun 测试运行器（不是 Vitest）

## Common Pitfalls

1. **不要在前端直接使用 `sessionId: null`**：会导致后端创建新会话，破坏前端状态同步
2. **记忆提取是异步的**：不要期望立即可用，使用 `memoryStatusMap` 跟踪状态
3. **Thinking 模式需要显式启用**：默认关闭，通过前端开关控制
4. **LanceDB 表初始化**：首次运行会创建表并插入占位记录后立即删除（绕过空表限制）
5. **SQLite WAL 模式**：支持并发读，但写操作仍然串行
6. **前端消息格式**：数据库存储的 `content` 字段是 JSON 字符串，需要用 `parseDbContent` 解析

## Code Style

- 使用 ESLint + TypeScript ESLint
- 优先使用 Bun API（如 `Bun.sqlite`），但保持 Node.js 兼容性
- 注释用中文，代码和变量名用英文
- 避免过度抽象，保持代码直接和可读
