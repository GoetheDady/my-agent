# 后端基础任务 (Task 1-3)

## Task 1: 扩展配置系统

**Files:**
- Modify: `src/core/config.ts`

- [ ] **Step 1: 添加 ToolsConfig 接口定义**

在 `config.ts` 中添加新的接口：

```typescript
export interface ToolsConfig {
  allowedPaths: string[];
}
```

- [ ] **Step 2: 扩展 AppConfig 接口**

修改 `AppConfig` 接口，添加 `tools` 字段：

```typescript
export interface AppConfig {
  provider: ProviderConfig;
  embedding: EmbeddingConfig;
  tools: ToolsConfig;  // 新增
}
```

- [ ] **Step 3: 修改 loadConfig 函数添加默认值**

在 `loadConfig` 函数的返回语句中添加 tools 配置：

```typescript
return {
  provider: {
    apiKey,
    model: fileConfig.provider?.model ?? DEFAULT_MODEL,
    baseURL,
  },
  embedding: {
    apiKey: process.env.ZHIPU_API_KEY ?? "",
    model: "embedding-3",
  },
  tools: {
    allowedPaths: fileConfig.tools?.allowedPaths ?? [getProjectRoot()],
  },
};
```

- [ ] **Step 4: 添加 saveConfig 函数**

在文件末尾添加配置保存函数：

```typescript
import { writeFileSync } from 'node:fs';

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

- [ ] **Step 5: 验证配置加载**

运行开发服务器验证配置正常加载：

```bash
bun run dev
```

预期：服务正常启动，无配置错误

- [ ] **Step 6: 提交更改**

```bash
git add src/core/config.ts
git commit -m "feat(config): add tools config with allowedPaths"
```

---

## Task 2: 实现工具执行器

**Files:**
- Create: `src/brain/tool-executor.ts`

- [ ] **Step 1: 创建文件并添加类型定义**

创建 `src/brain/tool-executor.ts`，添加基础导入和类型：

```typescript
import { resolve } from 'path';
import { readFile, writeFile, appendFile, stat } from 'fs/promises';
import { realpathSync } from 'fs';
import { getConfig } from '../core/config';

const projectRoot = resolve(import.meta.dir, '../..');

export type ToolResult = {
  success: boolean;
  data?: unknown;
  error?: {
    type: 'not_found' | 'permission_denied' | 'path_forbidden' | 
          'file_exists' | 'read_error' | 'write_error';
    message: string;
    suggestion?: string;
  };
};
```

- [ ] **Step 2: 实现路径规范化函数**

```typescript
function normalizePath(inputPath: string): string {
  try {
    const absolutePath = resolve(projectRoot, inputPath);
    const realPath = realpathSync(absolutePath);
    return realPath;
  } catch (error) {
    return resolve(projectRoot, inputPath);
  }
}
```

- [ ] **Step 3: 实现白名单检查函数**

```typescript
export function isPathInWhitelist(path: string): boolean {
  const normalizedPath = normalizePath(path);
  const config = getConfig();
  
  return config.tools.allowedPaths.some(allowedPath => {
    const normalizedAllowed = normalizePath(allowedPath);
    return normalizedPath.startsWith(normalizedAllowed);
  });
}
```

- [ ] **Step 4: 实现文件存在检查函数**

```typescript
export async function fileExists(path: string): Promise<boolean> {
  try {
    const normalizedPath = normalizePath(path);
    await stat(normalizedPath);
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 5: 实现读取文件函数**

```typescript
export async function readFileContent(path: string): Promise<ToolResult> {
  try {
    const normalizedPath = normalizePath(path);
    
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
```

- [ ] **Step 6: 实现写入文件函数**

```typescript
export async function writeFileContent(
  path: string,
  content: string,
  mode: 'overwrite' | 'append' | 'create'
): Promise<ToolResult> {
  try {
    const normalizedPath = normalizePath(path);
    
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

- [ ] **Step 7: 导出 normalizePath 供其他模块使用**

在文件顶部添加导出：

```typescript
export { normalizePath };
```

- [ ] **Step 8: 类型检查**

```bash
bun run typecheck
```

预期：无类型错误

- [ ] **Step 9: 提交更改**

```bash
git add src/brain/tool-executor.ts
git commit -m "feat(tools): implement tool executor with path validation"
```

---

## Task 3: 定义工具并集成到聊天路由

**Files:**
- Modify: `src/brain/tools.ts`
- Modify: `src/routes/chat.ts`

- [ ] **Step 1: 修改 tools.ts 导入依赖**

替换 `src/brain/tools.ts` 的内容：

```typescript
import { tool } from 'ai';
import { z } from 'zod';
import { readFileContent, writeFileContent, isPathInWhitelist, fileExists } from './tool-executor';
```

- [ ] **Step 2: 定义 read_file 工具**

```typescript
export const tools = {
  read_file: tool({
    description: '读取指定路径的文件内容',
    inputSchema: z.object({
      path: z.string().describe('文件路径（相对或绝对）'),
    }),
    needsApproval: async ({ path }) => {
      return !isPathInWhitelist(path);
    },
    execute: async ({ path }) => {
      return await readFileContent(path);
    },
  }),
};
```

- [ ] **Step 3: 添加 write_file 工具**

在 tools 对象中添加：

```typescript
  write_file: tool({
    description: '写入内容到指定文件',
    inputSchema: z.object({
      path: z.string().describe('文件路径'),
      content: z.string().describe('文件内容'),
      mode: z.enum(['overwrite', 'append', 'create']).describe('写入模式：overwrite=覆盖, append=追加, create=仅创建新文件'),
    }),
    needsApproval: async ({ path, mode }) => {
      return !isPathInWhitelist(path) || 
             (mode === 'overwrite' && await fileExists(path));
    },
    execute: async ({ path, content, mode }) => {
      return await writeFileContent(path, content, mode);
    },
  }),
```

- [ ] **Step 4: 在 chat.ts 中导入工具**

在 `src/routes/chat.ts` 顶部添加导入：

```typescript
import { tools } from '../brain/tools';
```

- [ ] **Step 5: 在 streamText 调用中添加 tools 参数**

找到 `streamText` 调用，添加 `tools` 参数：

```typescript
const result = streamText({
  model,
  system: enhancedPrompt,
  messages: modelMessages,
  stopWhen: stepCountIs(5),
  tools,  // 添加这一行
  abortSignal: c.req.raw.signal,
  providerOptions: {
    deepseek: { thinking: thinkingEnabled ? { type: "enabled" } : { type: "disabled" } },
  },
  // ... 其他配置
});
```

- [ ] **Step 6: 类型检查**

```bash
bun run typecheck
```

预期：无类型错误

- [ ] **Step 7: 启动开发服务器测试**

```bash
bun run dev
```

预期：服务正常启动，工具已注册

- [ ] **Step 8: 提交更改**

```bash
git add src/brain/tools.ts src/routes/chat.ts
git commit -m "feat(tools): define read_file and write_file tools with approval"
```
