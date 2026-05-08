# 工具系统设计文档

## 概述

为 AI Agent 实现基础工具系统，支持文件读写操作，并提供安全的用户审批机制。基于 Vercel AI SDK 6.0 的官方工具审批流程，确保危险操作需要用户明确批准。

## 目标

1. 实现 `read_file` 和 `write_file` 两个基础工具
2. 提供路径白名单机制，保护系统安全
3. 危险操作（覆盖文件、访问白名单外路径）需要用户审批
4. 用户可以"记住"审批决策，自动添加到白名单
5. 结构化错误处理，便于 LLM 做出智能决策

## 技术栈

- 后端：Bun + Hono + Vercel AI SDK 6.0 (`streamText`)
- 前端：React + `@ai-sdk/react` (`useChat` hook)
- 当前项目已使用 `useChat`，消息通过 SSE 流式传输

## 架构设计

### 核心模块

```
src/brain/
├── tools.ts              # 工具定义（符合 Vercel AI SDK 格式）
└── tool-executor.ts      # 工具执行逻辑和路径验证

src/core/
└── config.ts             # 配置扩展（添加 allowedPaths）

src/routes/
└── tools.ts              # 白名单管理 API

web/src/components/
├── ToolApprovalCard.tsx  # 工具审批 UI 组件
└── MessageBubble.tsx     # 扩展以支持审批卡片
```

### 数据流

```
用户消息 → LLM 决策 → 调用工具
                        ↓
                needsApproval 检查
                        ↓
        需要审批？ ← 是 → 返回 approval-requested 状态
            ↓ 否              ↓
        直接执行          前端显示审批卡片
            ↓                  ↓
        返回结果          用户批准/拒绝
            ↓                  ↓
        继续对话          addToolApprovalResponse
                              ↓
                          自动继续执行工具
                              ↓
                          返回结果 → 继续对话
```

## 详细设计

### 1. 工具定义

**文件**：`src/brain/tools.ts`

```typescript
import { tool } from 'ai';
import { z } from 'zod';
import { readFileContent, writeFileContent, isPathInWhitelist, fileExists } from './tool-executor';

export const tools = {
  read_file: tool({
    description: '读取指定路径的文件内容',
    inputSchema: z.object({
      path: z.string().describe('文件路径（相对或绝对）'),
    }),
    needsApproval: async ({ path }) => {
      // 路径不在白名单时需要审批
      return !isPathInWhitelist(path);
    },
    execute: async ({ path }) => {
      return await readFileContent(path);
    },
  }),
  
  write_file: tool({
    description: '写入内容到指定文件',
    inputSchema: z.object({
      path: z.string().describe('文件路径'),
      content: z.string().describe('文件内容'),
      mode: z.enum(['overwrite', 'append', 'create']).describe('写入模式：overwrite=覆盖, append=追加, create=仅创建新文件'),
    }),
    needsApproval: async ({ path, mode }) => {
      // 路径不在白名单 或 覆盖模式且文件存在时需要审批
      return !isPathInWhitelist(path) || 
             (mode === 'overwrite' && await fileExists(path));
    },
    execute: async ({ path, content, mode }) => {
      return await writeFileContent(path, content, mode);
    },
  }),
};
```

**工具参数说明**：

**read_file**：
- `path`: 文件路径（相对或绝对）

**write_file**：
- `path`: 文件路径
- `content`: 文件内容
- `mode`: 写入模式
  - `overwrite`: 覆盖现有文件（需要审批）
  - `append`: 追加到文件末尾（自动执行）
  - `create`: 仅当文件不存在时创建（文件存在则返回错误）

---

### 2. 工具执行器

**文件**：`src/brain/tool-executor.ts`

```typescript
import { resolve } from 'path';
import { readFile, writeFile, appendFile, stat } from 'fs/promises';
import { realpathSync } from 'fs';
import { getConfig } from '../core/config';

const projectRoot = resolve(import.meta.dir, '../..');

// 结构化返回类型
type ToolResult = {
  success: boolean;
  data?: unknown;
  error?: {
    type: 'not_found' | 'permission_denied' | 'path_forbidden' | 
          'file_exists' | 'read_error' | 'write_error';
    message: string;
    suggestion?: string;
  };
};

// 路径规范化
function normalizePath(inputPath: string): string {
  try {
    // 1. 解析相对路径为绝对路径
    const absolutePath = resolve(projectRoot, inputPath);
    
    // 2. 解析软链接
    const realPath = realpathSync(absolutePath);
    
    return realPath;
  } catch (error) {
    // 文件不存在时 realpathSync 会抛错，返回绝对路径
    return resolve(projectRoot, inputPath);
  }
}

// 检查路径是否在白名单内
export function isPathInWhitelist(path: string): boolean {
  const normalizedPath = normalizePath(path);
  const config = getConfig();
  
  return config.tools.allowedPaths.some(allowedPath => {
    const normalizedAllowed = normalizePath(allowedPath);
    return normalizedPath.startsWith(normalizedAllowed);
  });
}

// 检查文件是否存在
export async function fileExists(path: string): Promise<boolean> {
  try {
    const normalizedPath = normalizePath(path);
    await stat(normalizedPath);
    return true;
  } catch {
    return false;
  }
}

// 读取文件内容
export async function readFileContent(path: string): Promise<ToolResult> {
  try {
    const normalizedPath = normalizePath(path);
    
    // 安全检查（双重验证）
    if (!isPathInWhitelist(normalizedPath)) {
      return {
        success: false,
        error: {
          type: 'path_forbidden',
          message: `路径不在允许访问的范围内: ${path}`,
          suggestion: '请联系管理员添加此路径到白名单',
        },
      };
    }
    
    const content = await readFile(normalizedPath, 'utf-8');
    
    return {
      success: true,
      data: { content, path: normalizedPath },
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {
        success: false,
        error: {
          type: 'not_found',
          message: `文件不存在: ${path}`,
          suggestion: '请检查文件路径是否正确',
        },
      };
    }
    
    if ((error as NodeJS.ErrnoException).code === 'EACCES') {
      return {
        success: false,
        error: {
          type: 'permission_denied',
          message: `没有权限读取文件: ${path}`,
          suggestion: '请检查文件权限',
        },
      };
    }
    
    return {
      success: false,
      error: {
        type: 'read_error',
        message: `读取文件失败: ${(error as Error).message}`,
      },
    };
  }
}

// 写入文件内容
export async function writeFileContent(
  path: string,
  content: string,
  mode: 'overwrite' | 'append' | 'create'
): Promise<ToolResult> {
  try {
    const normalizedPath = normalizePath(path);
    
    // 安全检查（双重验证）
    if (!isPathInWhitelist(normalizedPath)) {
      return {
        success: false,
        error: {
          type: 'path_forbidden',
          message: `路径不在允许访问的范围内: ${path}`,
          suggestion: '请联系管理员添加此路径到白名单',
        },
      };
    }
    
    const exists = await fileExists(normalizedPath);
    
    // create 模式：文件存在则报错
    if (mode === 'create' && exists) {
      return {
        success: false,
        error: {
          type: 'file_exists',
          message: `文件已存在: ${path}`,
          suggestion: '使用 overwrite 模式覆盖，或使用 append 模式追加',
        },
      };
    }
    
    // 执行写入
    if (mode === 'append') {
      await appendFile(normalizedPath, content, 'utf-8');
    } else {
      await writeFile(normalizedPath, content, 'utf-8');
    }
    
    return {
      success: true,
      data: {
        path: normalizedPath,
        bytesWritten: Buffer.byteLength(content, 'utf-8'),
        mode,
      },
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EACCES') {
      return {
        success: false,
        error: {
          type: 'permission_denied',
          message: `没有权限写入文件: ${path}`,
          suggestion: '请检查文件权限',
        },
      };
    }
    
    return {
      success: false,
      error: {
        type: 'write_error',
        message: `写入文件失败: ${(error as Error).message}`,
      },
    };
  }
}
```

---

### 3. 配置扩展

**文件**：`src/core/config.ts`

扩展现有的 `AppConfig` 接口：

```typescript
export interface AppConfig {
  provider: ProviderConfig;
  embedding: EmbeddingConfig;
  tools: ToolsConfig;  // 新增
}

export interface ToolsConfig {
  allowedPaths: string[];  // 允许访问的路径列表
}
```

修改 `loadConfig` 函数，添加默认值：

```typescript
export function loadConfig(): AppConfig {
  // ... 现有代码 ...
  
  return {
    provider: { /* ... */ },
    embedding: { /* ... */ },
    tools: {
      allowedPaths: fileConfig.tools?.allowedPaths ?? [getProjectRoot()],
    },
  };
}
```

添加配置保存函数：

```typescript
export function saveConfig(config: AppConfig): void {
  const root = getProjectRoot();
  const configPath = resolve(root, 'config.json');
  
  writeFileSync(
    configPath,
    JSON.stringify(config, null, 2),
    'utf-8'
  );
}
```

**配置文件示例** (`config.json`)：

```json
{
  "provider": {
    "apiKey": "$DEEPSEEK_API_KEY",
    "model": "deepseek-v4-flash"
  },
  "tools": {
    "allowedPaths": [
      "/Users/gedesiwen/gdsw/my-agent"
    ]
  }
}
```

---

### 4. 后端路由集成

**文件**：`src/routes/chat.ts`

导入工具定义：

```typescript
import { tools } from '../brain/tools';

// 在 streamText 调用中使用
const result = streamText({
  model,
  system: enhancedPrompt,
  messages: modelMessages,
  tools,  // 添加工具
  stopWhen: stepCountIs(5),
  abortSignal: c.req.raw.signal,
  providerOptions: {
    deepseek: { thinking: thinkingEnabled ? { type: "enabled" } : { type: "disabled" } },
  },
  // ... 其他配置
});
```

---

### 5. 白名单管理 API

**文件**：`src/routes/tools.ts`

```typescript
import { Hono } from "hono";
import { getConfig, saveConfig } from "../core/config";
import { getSessionMessages } from "../channels/session-api";
import { normalizePath } from "../brain/tool-executor";

const app = new Hono();

// POST /api/tools/whitelist
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

// 辅助函数：从消息中查找工具调用
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

export default app;
```

在 `src/main.ts` 中注册路由：

```typescript
import toolRoutes from "./routes/tools";

app.route("/api/tools", toolRoutes);
```

---

### 6. 前端审批 UI

**文件**：`web/src/components/ToolApprovalCard.tsx`

```typescript
import { useState } from 'react';

interface ToolApprovalCardProps {
  toolName: string;
  args: Record<string, unknown>;
  toolCallId: string;
  onApprove: (rememberChoice: boolean) => void;
  onDeny: () => void;
}

export function ToolApprovalCard({
  toolName,
  args,
  toolCallId,
  onApprove,
  onDeny,
}: ToolApprovalCardProps) {
  const [rememberChoice, setRememberChoice] = useState(false);
  const [processing, setProcessing] = useState(false);
  
  const description = getOperationDescription(toolName, args);
  const riskLevel = getRiskLevel(toolName, args);
  
  const handleApprove = () => {
    setProcessing(true);
    onApprove(rememberChoice);
  };
  
  const handleDeny = () => {
    setProcessing(true);
    onDeny();
  };
  
  return (
    <div className={`tool-approval-card risk-${riskLevel}`}>
      <div className="tool-header">
        <span className="tool-icon">🔧</span>
        <span className="tool-name">{toolName}</span>
      </div>
      
      <div className="tool-description">{description}</div>
      
      <div className="tool-args">
        {Object.entries(args).map(([key, value]) => (
          <div key={key} className="arg-item">
            <span className="arg-key">{key}:</span>
            <span className="arg-value">{String(value)}</span>
          </div>
        ))}
      </div>
      
      {riskLevel === 'high' && (
        <div className="risk-warning">
          ⚠️ 此操作可能覆盖现有文件，请谨慎操作
        </div>
      )}
      
      <div className="tool-actions">
        <label className="remember-choice">
          <input
            type="checkbox"
            checked={rememberChoice}
            onChange={(e) => setRememberChoice(e.target.checked)}
            disabled={processing}
          />
          记住此选择（添加到白名单）
        </label>
        
        <div className="action-buttons">
          <button
            onClick={handleDeny}
            disabled={processing}
            className="btn-deny"
          >
            拒绝
          </button>
          <button
            onClick={handleApprove}
            disabled={processing}
            className="btn-approve"
          >
            批准
          </button>
        </div>
      </div>
    </div>
  );
}

function getOperationDescription(toolName: string, args: Record<string, unknown>): string {
  if (toolName === 'read_file') {
    return `读取文件：${args.path}`;
  }
  if (toolName === 'write_file') {
    const mode = args.mode as string;
    const modeText = {
      overwrite: '覆盖',
      append: '追加到',
      create: '创建',
    }[mode] || mode;
    return `${modeText}文件：${args.path}`;
  }
  return `执行 ${toolName}`;
}

function getRiskLevel(toolName: string, args: Record<string, unknown>): 'low' | 'medium' | 'high' {
  if (toolName === 'read_file') return 'low';
  if (toolName === 'write_file') {
    return args.mode === 'overwrite' ? 'high' : 'medium';
  }
  return 'medium';
}
```

---

### 7. 前端集成

**文件**：`web/src/components/MessageBubble.tsx`

扩展消息渲染逻辑：

```typescript
import { ToolApprovalCard } from './ToolApprovalCard';
import { useChatStore } from '../store/chatStore';

// 在消息部分渲染中添加
function renderMessagePart(part: MessagePart) {
  // 检测工具审批请求
  if (part.type === 'tool-invocation' && 
      part.toolInvocation.state === 'approval-requested') {
    return (
      <ToolApprovalCard
        toolName={part.toolInvocation.toolName}
        args={part.toolInvocation.args}
        toolCallId={part.toolInvocation.toolCallId}
        onApprove={(rememberChoice) => 
          handleApprove(part.toolInvocation.toolCallId, rememberChoice)
        }
        onDeny={() => handleDeny(part.toolInvocation.toolCallId)}
      />
    );
  }
  
  // ... 其他消息类型渲染
}
```

**文件**：`web/src/components/ChatView.tsx`

添加审批处理逻辑：

```typescript
import { useChat } from '@ai-sdk/react';

export function ChatView() {
  const { sessionId } = useChatStore();
  
  const { messages, addToolApprovalResponse } = useChat({
    api: '/api/chat',
    body: { sessionId, thinkingEnabled },
    sendAutomaticallyWhen: 'lastAssistantMessageIsCompleteWithApprovalResponses',
  });
  
  const handleApprove = async (toolCallId: string, rememberChoice: boolean) => {
    // 批准工具执行
    addToolApprovalResponse({
      toolCallId,
      result: 'approved',
    });
    
    // 如果用户选择"记住"，更新白名单
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
  
  const handleDeny = (toolCallId: string) => {
    addToolApprovalResponse({
      toolCallId,
      result: 'denied',
    });
  };
  
  // ... 其他逻辑
}
```

---

## 安全考虑

### 路径安全

1. **路径规范化**：所有路径都经过 `normalizePath` 处理
   - 解析相对路径为绝对路径
   - 解析软链接
   - 防止路径遍历攻击（`../../../etc/passwd`）

2. **白名单验证**：
   - `needsApproval` 中检查（第一道防线）
   - `execute` 中再次检查（双重验证）
   - 使用前缀匹配，支持目录级别的白名单

3. **参数验证**：
   - 前端不能伪造工具参数
   - 白名单更新时从服务端消息历史中提取参数
   - 使用 zod schema 验证输入

### 审批安全

1. **状态管理**：
   - 审批状态由 Vercel AI SDK 管理
   - 前端只能批准/拒绝，不能修改参数

2. **会话绑定**：
   - 白名单更新需要 sessionId
   - 防止跨会话攻击

3. **错误处理**：
   - 所有错误都返回结构化对象
   - 不暴露系统内部信息

---

## 测试计划

### 单元测试

1. **路径规范化测试**：
   - 相对路径 → 绝对路径
   - 软链接解析
   - 路径遍历攻击防护
   - 大小写敏感性

2. **白名单检查测试**：
   - 路径在白名单内
   - 路径不在白名单内
   - 子目录匹配
   - 边界情况

3. **文件操作测试**：
   - 读取存在的文件
   - 读取不存在的文件
   - 写入（overwrite/append/create）
   - 权限错误处理

### 集成测试

1. **工具调用流程**：
   - LLM 调用工具 → 自动执行（白名单内）
   - LLM 调用工具 → 需要审批 → 批准 → 执行
   - LLM 调用工具 → 需要审批 → 拒绝 → 返回错误

2. **白名单管理**：
   - 批准并记住 → 白名单更新
   - 下次相同路径自动批准

3. **错误处理**：
   - 文件不存在
   - 权限不足
   - 路径禁止访问

---

## 实现顺序

1. **后端基础**（第一优先级）：
   - 扩展 `config.ts` 添加 `ToolsConfig`
   - 实现 `tool-executor.ts`（路径验证、文件操作）
   - 实现 `tools.ts`（工具定义）
   - 集成到 `chat.ts`

2. **前端 UI**（第二优先级）：
   - 实现 `ToolApprovalCard.tsx`
   - 扩展 `MessageBubble.tsx` 渲染审批卡片
   - 在 `ChatView.tsx` 中添加审批处理逻辑

3. **白名单管理**（第三优先级）：
   - 实现 `routes/tools.ts`
   - 前端调用白名单 API
   - 配置持久化

4. **测试和优化**（第四优先级）：
   - 单元测试
   - 集成测试
   - 错误处理完善
   - UI 样式优化

---

## 未来扩展

1. **更多工具**：
   - `execute_command`：执行 shell 命令
   - `search_code`：代码搜索（grep）
   - `list_files`：列出目录内容

2. **高级审批**：
   - 审批历史记录（SQLite）
   - 审批策略配置（自动批准某些操作）
   - 审批超时机制

3. **工具集管理**：
   - 按工具集分组
   - Agent 级别的工具启用/禁用

4. **MCP 集成**：
   - 对接外部 MCP Server
   - 动态工具注册

---

## 参考资料

- [Vercel AI SDK - Tool Calling](https://sdk.vercel.ai/docs/ai-sdk-core/tools-and-tool-calling)
- [Vercel AI SDK - Tool Execution Approval](https://vercel-ai.mintlify.app/ai-sdk-ui/chatbot-tool-usage)
- [Zod Schema Validation](https://zod.dev/)
