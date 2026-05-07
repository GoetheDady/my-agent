# 前端 UI 任务 (Task 4-6)

## Task 4: 创建工具审批 UI 组件

**Files:**
- Create: `web/src/components/ToolApprovalCard.tsx`

- [ ] **Step 1: 创建组件文件并添加接口定义**

创建 `web/src/components/ToolApprovalCard.tsx`：

```typescript
import { useState } from 'react';

interface ToolApprovalCardProps {
  toolName: string;
  args: Record<string, unknown>;
  toolCallId: string;
  onApprove: (rememberChoice: boolean) => void;
  onDeny: () => void;
}
```

- [ ] **Step 2: 实现辅助函数**

```typescript
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

- [ ] **Step 3: 实现组件主体**

```typescript
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
    <div className={`border rounded-lg p-4 my-2 ${
      riskLevel === 'high' ? 'border-red-500 bg-red-50' :
      riskLevel === 'medium' ? 'border-yellow-500 bg-yellow-50' :
      'border-blue-500 bg-blue-50'
    }`}>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xl">🔧</span>
        <span className="font-semibold">{toolName}</span>
      </div>
      
      <div className="text-sm mb-3">{description}</div>
      
      <div className="text-xs bg-white rounded p-2 mb-3 font-mono">
        {Object.entries(args).map(([key, value]) => (
          <div key={key} className="flex gap-2">
            <span className="text-gray-600">{key}:</span>
            <span className="text-gray-900">{String(value)}</span>
          </div>
        ))}
      </div>
      
      {riskLevel === 'high' && (
        <div className="text-sm text-red-600 mb-3 flex items-center gap-1">
          <span>⚠️</span>
          <span>此操作可能覆盖现有文件，请谨慎操作</span>
        </div>
      )}
      
      <div className="space-y-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={rememberChoice}
            onChange={(e) => setRememberChoice(e.target.checked)}
            disabled={processing}
            className="rounded"
          />
          <span>记住此选择（添加到白名单）</span>
        </label>
        
        <div className="flex gap-2 justify-end">
          <button
            onClick={handleDeny}
            disabled={processing}
            className="px-4 py-2 rounded bg-gray-200 hover:bg-gray-300 disabled:opacity-50"
          >
            拒绝
          </button>
          <button
            onClick={handleApprove}
            disabled={processing}
            className="px-4 py-2 rounded bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50"
          >
            批准
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 类型检查**

```bash
cd web
bun run build
```

预期：构建成功，无类型错误

- [ ] **Step 5: 提交更改**

```bash
git add web/src/components/ToolApprovalCard.tsx
git commit -m "feat(ui): add tool approval card component"
```

---

## Task 5: 集成审批 UI 到消息渲染

**Files:**
- Modify: `web/src/components/MessageBubble.tsx`

- [ ] **Step 1: 导入 ToolApprovalCard 组件**

在 `MessageBubble.tsx` 顶部添加导入：

```typescript
import { ToolApprovalCard } from './ToolApprovalCard';
```

- [ ] **Step 2: 找到消息部分渲染逻辑**

定位到渲染 `part` 的代码位置（通常在 `map` 函数中）

- [ ] **Step 3: 添加工具审批卡片渲染逻辑**

在渲染 `part` 的逻辑中添加（在其他 `part.type` 判断之前）：

```typescript
// 检测工具审批请求
if (part.type === 'tool-invocation' && 
    part.toolInvocation?.state === 'approval-requested') {
  return (
    <ToolApprovalCard
      key={`approval-${part.toolInvocation.toolCallId}`}
      toolName={part.toolInvocation.toolName}
      args={part.toolInvocation.args}
      toolCallId={part.toolInvocation.toolCallId}
      onApprove={(rememberChoice) => 
        handleApprove?.(part.toolInvocation.toolCallId, rememberChoice)
      }
      onDeny={() => handleDeny?.(part.toolInvocation.toolCallId)}
    />
  );
}
```

- [ ] **Step 4: 添加 props 类型定义**

在 `MessageBubble` 组件的 props 接口中添加：

```typescript
interface MessageBubbleProps {
  // ... 现有 props
  handleApprove?: (toolCallId: string, rememberChoice: boolean) => void;
  handleDeny?: (toolCallId: string) => void;
}
```

- [ ] **Step 5: 类型检查**

```bash
cd web
bun run build
```

预期：构建成功，无类型错误

- [ ] **Step 6: 提交更改**

```bash
git add web/src/components/MessageBubble.tsx
git commit -m "feat(ui): integrate tool approval card into message rendering"
```

---

## Task 6: 添加审批处理逻辑到 ChatView

**Files:**
- Modify: `web/src/components/ChatView.tsx`

- [ ] **Step 1: 导入 useChat 的审批相关功能**

确保 `useChat` 导入包含 `addToolApprovalResponse`：

```typescript
import { useChat } from '@ai-sdk/react';
```

- [ ] **Step 2: 在 useChat 配置中添加自动发送选项**

修改 `useChat` 调用，添加 `sendAutomaticallyWhen` 选项：

```typescript
const { messages, input, handleInputChange, handleSubmit, addToolApprovalResponse } = useChat({
  api: '/api/chat',
  body: { sessionId, thinkingEnabled },
  sendAutomaticallyWhen: 'lastAssistantMessageIsCompleteWithApprovalResponses',
});
```

- [ ] **Step 3: 实现 handleApprove 函数**

在组件内添加：

```typescript
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
```

- [ ] **Step 4: 实现 handleDeny 函数**

```typescript
const handleDeny = (toolCallId: string) => {
  addToolApprovalResponse({
    toolCallId,
    result: 'denied',
  });
};
```

- [ ] **Step 5: 将处理函数传递给 MessageBubble**

找到渲染 `MessageBubble` 的地方，添加 props：

```typescript
<MessageBubble
  // ... 现有 props
  handleApprove={handleApprove}
  handleDeny={handleDeny}
/>
```

- [ ] **Step 6: 类型检查**

```bash
cd web
bun run build
```

预期：构建成功，无类型错误

- [ ] **Step 7: 提交更改**

```bash
git add web/src/components/ChatView.tsx
git commit -m "feat(ui): add tool approval handlers to ChatView"
```
