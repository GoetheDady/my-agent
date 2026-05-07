# 白名单管理任务 (Task 7-8)

## Task 7: 实现白名单管理 API

**Files:**
- Create: `src/routes/tools.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: 创建路由文件并添加导入**

创建 `src/routes/tools.ts`：

```typescript
import { Hono } from "hono";
import { getConfig, saveConfig } from "../core/config";
import { getSessionMessages } from "../channels/session-api";
import { normalizePath } from "../brain/tool-executor";

const app = new Hono();
```

- [ ] **Step 2: 实现 findToolCallById 辅助函数**

```typescript
function findToolCallById(messages: unknown[], toolCallId: string): { args: Record<string, unknown> } | null {
  for (const msg of messages) {
    const message = msg as { role: string; content: string };
    if (message.role !== 'assistant') continue;
    
    try {
      const parts = JSON.parse(message.content) as Array<{
        type: string;
        toolInvocation?: { toolCallId: string; args: Record<string, unknown> };
      }>;
      
      for (const part of parts) {
        if (part.type === 'tool-invocation' && 
            part.toolInvocation?.toolCallId === toolCallId) {
          return { args: part.toolInvocation.args };
        }
      }
    } catch {
      // 忽略解析错误
    }
  }
  
  return null;
}
```

- [ ] **Step 3: 实现 POST /whitelist 端点**

```typescript
app.post("/whitelist", async (c) => {
  const body = await c.req.json().catch(() => ({})) as {
    toolCallId?: string;
    sessionId?: string;
  };
  
  if (!body.toolCallId || !body.sessionId) {
    return c.json({ error: "缺少 toolCallId 或 sessionId" }, 400);
  }
  
  try {
    // 从会话消息中查找工具调用
    const messages = getSessionMessages(body.sessionId);
    const toolCall = findToolCallById(messages, body.toolCallId);
    
    if (!toolCall) {
      return c.json({ error: "工具调用不存在" }, 404);
    }
    
    // 提取路径参数
    const path = toolCall.args.path as string;
    if (!path) {
      return c.json({ error: "工具调用中没有 path 参数" }, 400);
    }
    
    const normalizedPath = normalizePath(path);
    
    // 更新配置
    const config = getConfig();
    if (!config.tools.allowedPaths.includes(normalizedPath)) {
      config.tools.allowedPaths.push(normalizedPath);
      saveConfig(config);
    }
    
    return c.json({ ok: true, path: normalizedPath });
  } catch (error) {
    return c.json({ 
      error: error instanceof Error ? error.message : "更新白名单失败" 
    }, 500);
  }
});

export default app;
```

- [ ] **Step 4: 在 main.ts 中注册路由**

在 `src/main.ts` 中添加导入：

```typescript
import toolRoutes from "./routes/tools";
```

在路由注册部分添加：

```typescript
app.route("/api/tools", toolRoutes);
```

- [ ] **Step 5: 类型检查**

```bash
bun run typecheck
```

预期：无类型错误

- [ ] **Step 6: 启动开发服务器测试**

```bash
bun run dev
```

预期：服务正常启动，路由已注册

- [ ] **Step 7: 测试白名单 API**

使用 curl 测试（需要先创建一个会话和工具调用）：

```bash
curl -X POST http://localhost:3000/api/tools/whitelist \
  -H "Content-Type: application/json" \
  -d '{"toolCallId":"test","sessionId":"test"}'
```

预期：返回 404（因为工具调用不存在，这是正常的）

- [ ] **Step 8: 提交更改**

```bash
git add src/routes/tools.ts src/main.ts
git commit -m "feat(api): add whitelist management endpoint"
```

---

## Task 8: 前端调用白名单 API

**Files:**
- Verify: `web/src/components/ChatView.tsx`

- [ ] **Step 1: 检查 handleApprove 函数中的 API 调用**

确认 `ChatView.tsx` 中的 `handleApprove` 函数已包含白名单 API 调用：

```typescript
const handleApprove = async (toolCallId: string, rememberChoice: boolean) => {
  addToolApprovalResponse({
    toolCallId,
    result: 'approved',
  });
  
  if (rememberChoice && sessionId) {
    try {
      await fetch('/api/tools/whitelist', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ toolCallId, sessionId }),
      });
    } catch (error) {
      console.error('更新白名单失败:', error);
    }
  }
};
```

- [ ] **Step 2: 验证 sessionId 可用性**

确认 `sessionId` 从 store 中正确获取：

```typescript
const { sessionId } = useChatStore();
```

或从其他状态管理中获取

- [ ] **Step 3: 添加错误提示（可选）**

如果需要用户友好的错误提示，可以添加 toast 或 alert：

```typescript
if (rememberChoice && sessionId) {
  try {
    const response = await fetch('/api/tools/whitelist', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ toolCallId, sessionId }),
    });
    
    if (!response.ok) {
      console.error('更新白名单失败:', await response.text());
      // 可选：显示错误提示
    }
  } catch (error) {
    console.error('更新白名单失败:', error);
    // 可选：显示错误提示
  }
}
```

- [ ] **Step 4: 类型检查**

```bash
cd web
bun run build
```

预期：构建成功，无类型错误

- [ ] **Step 5: 如果有修改则提交**

```bash
git add web/src/components/ChatView.tsx
git commit -m "feat(ui): ensure whitelist API integration in approval handler"
```
