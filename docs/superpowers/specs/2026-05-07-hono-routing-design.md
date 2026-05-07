# Hono 路由重构设计

**日期**: 2026-05-07
**状态**: 待实施

## 目标

将 `src/channels/http.ts` 中手写的 `Bun.serve` + `if url.pathname ===` 路由替换为 Hono 框架，并按功能拆分为独立路由文件。

## 文件结构

```
src/
├── main.ts              # Hono app 入口，组装路由和中间件
├── routes/
│   ├── chat.ts          # POST /api/chat — streamText
│   ├── sessions.ts      # /api/sessions/* CRUD
│   ├── memory.ts        # /api/memory/* + /api/memory/extract
│   └── static.ts        # GET /* — 静态文件 + SPA fallback
├── channels/            # http.ts 删除，session-api.ts/memory-api.ts 保留
```

## 各模块职责

### main.ts
- 创建 `Hono` app
- 注册 `cors()` 中间件
- `app.route()` 挂载子路由
- `serve()` 启动

### routes/chat.ts
- `POST /` — 聊天端点（保持现有 `handleChat` 逻辑，适配 Hono context）
- `GET /api/health` — 内联，简单 JSON 返回

### routes/sessions.ts  
- `GET /` — 列表
- `POST /` — 创建
- `GET /:id/messages` — 消息历史
- `PATCH /:id` — 更新标题
- `DELETE /:id` — 删除

### routes/memory.ts
- memory CRUD（通过 `handleMemoryRequest`）
- `POST /extract` — 记忆提取

### routes/static.ts
- `GET /*` — 静态文件服务 + SPA fallback

## 依赖

- 新增：`hono`

## 不变部分

- `session-api.ts`、`memory-api.ts` 不改
- 聊天、记忆、embedding 业务逻辑不变
- 前端不变

## 删除

- `src/channels/http.ts`（~400 行）
