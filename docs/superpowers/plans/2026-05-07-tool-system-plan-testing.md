# 测试验证任务 (Task 9-10)

## Task 9: 编写单元测试

**Files:**
- Create: `src/brain/tool-executor.test.ts`

- [ ] **Step 1: 创建测试文件并添加导入**

创建 `src/brain/tool-executor.test.ts`：

```typescript
import { describe, test, expect, beforeAll } from 'bun:test';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { resolve } from 'path';
import { 
  isPathInWhitelist, 
  fileExists, 
  readFileContent, 
  writeFileContent 
} from './tool-executor';
```

- [ ] **Step 2: 设置测试环境**

```typescript
const testDir = resolve(import.meta.dir, '../../test-temp');
const testFile = resolve(testDir, 'test.txt');

beforeAll(() => {
  // 创建测试目录
  mkdirSync(testDir, { recursive: true });
  
  // 创建测试文件
  writeFileSync(testFile, 'test content', 'utf-8');
});
```

- [ ] **Step 3: 编写路径白名单测试**

```typescript
describe('isPathInWhitelist', () => {
  test('项目根目录路径应该在白名单内', () => {
    const projectRoot = resolve(import.meta.dir, '../..');
    const result = isPathInWhitelist(projectRoot);
    expect(result).toBe(true);
  });
  
  test('项目子目录路径应该在白名单内', () => {
    const subPath = resolve(import.meta.dir, '../../src/brain/tools.ts');
    const result = isPathInWhitelist(subPath);
    expect(result).toBe(true);
  });
  
  test('系统路径不应该在白名单内', () => {
    const result = isPathInWhitelist('/etc/passwd');
    expect(result).toBe(false);
  });
});
```

- [ ] **Step 4: 编写文件存在检查测试**

```typescript
describe('fileExists', () => {
  test('存在的文件应该返回 true', async () => {
    const result = await fileExists(testFile);
    expect(result).toBe(true);
  });
  
  test('不存在的文件应该返回 false', async () => {
    const result = await fileExists(resolve(testDir, 'nonexistent.txt'));
    expect(result).toBe(false);
  });
});
```

- [ ] **Step 5: 编写读取文件测试**

```typescript
describe('readFileContent', () => {
  test('读取存在的文件应该成功', async () => {
    const result = await readFileContent(testFile);
    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect((result.data as any).content).toBe('test content');
  });
  
  test('读取不存在的文件应该返回错误', async () => {
    const result = await readFileContent(resolve(testDir, 'nonexistent.txt'));
    expect(result.success).toBe(false);
    expect(result.error?.type).toBe('not_found');
  });
  
  test('读取白名单外的文件应该返回错误', async () => {
    const result = await readFileContent('/etc/passwd');
    expect(result.success).toBe(false);
    expect(result.error?.type).toBe('path_forbidden');
  });
});
```

- [ ] **Step 6: 编写写入文件测试**

```typescript
describe('writeFileContent', () => {
  test('overwrite 模式应该覆盖文件', async () => {
    const targetFile = resolve(testDir, 'overwrite-test.txt');
    writeFileSync(targetFile, 'old content', 'utf-8');
    
    const result = await writeFileContent(targetFile, 'new content', 'overwrite');
    expect(result.success).toBe(true);
    
    const readResult = await readFileContent(targetFile);
    expect((readResult.data as any).content).toBe('new content');
  });
  
  test('append 模式应该追加内容', async () => {
    const targetFile = resolve(testDir, 'append-test.txt');
    writeFileSync(targetFile, 'line1\n', 'utf-8');
    
    const result = await writeFileContent(targetFile, 'line2\n', 'append');
    expect(result.success).toBe(true);
    
    const readResult = await readFileContent(targetFile);
    expect((readResult.data as any).content).toBe('line1\nline2\n');
  });
  
  test('create 模式在文件存在时应该返回错误', async () => {
    const result = await writeFileContent(testFile, 'content', 'create');
    expect(result.success).toBe(false);
    expect(result.error?.type).toBe('file_exists');
  });
  
  test('create 模式在文件不存在时应该创建文件', async () => {
    const targetFile = resolve(testDir, 'create-test.txt');
    
    const result = await writeFileContent(targetFile, 'new file', 'create');
    expect(result.success).toBe(true);
    
    const readResult = await readFileContent(targetFile);
    expect((readResult.data as any).content).toBe('new file');
  });
  
  test('写入白名单外的路径应该返回错误', async () => {
    const result = await writeFileContent('/tmp/forbidden.txt', 'content', 'overwrite');
    expect(result.success).toBe(false);
    expect(result.error?.type).toBe('path_forbidden');
  });
});
```

- [ ] **Step 7: 添加清理逻辑**

```typescript
import { afterAll } from 'bun:test';

afterAll(() => {
  // 清理测试目录
  rmSync(testDir, { recursive: true, force: true });
});
```

- [ ] **Step 8: 运行测试**

```bash
bun test src/brain/tool-executor.test.ts
```

预期：所有测试通过

- [ ] **Step 9: 提交更改**

```bash
git add src/brain/tool-executor.test.ts
git commit -m "test(tools): add unit tests for tool executor"
```

---

## Task 10: 手动集成测试

**Files:**
- None (manual testing)

- [ ] **Step 1: 启动开发服务器**

```bash
bun run dev
```

预期：服务正常启动

- [ ] **Step 2: 启动前端开发服务器**

在新终端中：

```bash
cd web
bun run dev
```

预期：前端服务正常启动

- [ ] **Step 3: 测试读取白名单内文件（自动执行）**

在浏览器中打开应用，发送消息：

```
请读取 package.json 文件的内容
```

预期：
- 工具自动执行（无需审批）
- 返回文件内容

- [ ] **Step 4: 测试读取白名单外文件（需要审批）**

发送消息：

```
请读取 /etc/hosts 文件的内容
```

预期：
- 显示审批卡片
- 显示文件路径和操作描述
- 有"批准"、"拒绝"、"记住此选择"选项

- [ ] **Step 5: 测试拒绝操作**

点击"拒绝"按钮

预期：
- 审批卡片消失
- LLM 收到拒绝消息
- 对话继续

- [ ] **Step 6: 测试批准操作**

再次发送读取 `/etc/hosts` 的消息，点击"批准"

预期：
- 工具执行
- 返回文件内容（如果有权限）
- 对话继续

- [ ] **Step 7: 测试"记住此选择"功能**

发送消息读取另一个白名单外文件，勾选"记住此选择"并批准

预期：
- 工具执行
- 白名单更新（检查 config.json）
- 下次访问相同路径自动批准

- [ ] **Step 8: 测试写入文件（覆盖模式，需要审批）**

发送消息：

```
请在项目根目录创建一个 test.txt 文件，内容是 "Hello World"
```

预期：
- 显示审批卡片
- 风险等级为 high（如果文件存在）或 medium（如果文件不存在）
- 批准后文件创建成功

- [ ] **Step 9: 测试写入文件（append 模式，自动执行）**

发送消息：

```
请在 test.txt 文件末尾追加一行 "New line"
```

预期：
- 工具自动执行（无需审批）
- 内容追加成功

- [ ] **Step 10: 测试写入文件（create 模式）**

发送消息：

```
请创建一个新文件 test2.txt，内容是 "Test"，如果文件存在则报错
```

预期：
- 如果文件不存在，创建成功
- 如果文件存在，返回错误信息

- [ ] **Step 11: 测试错误处理**

发送消息读取不存在的文件：

```
请读取 nonexistent-file-12345.txt
```

预期：
- 返回结构化错误
- 错误类型为 not_found
- 包含建议信息

- [ ] **Step 12: 验证配置持久化**

检查 `config.json` 文件：

```bash
cat config.json
```

预期：
- `tools.allowedPaths` 数组包含批准的路径
- JSON 格式正确

- [ ] **Step 13: 测试服务重启后白名单保持**

重启开发服务器：

```bash
# Ctrl+C 停止服务
bun run dev
```

再次访问之前批准的路径

预期：
- 自动执行，无需再次审批

- [ ] **Step 14: 清理测试文件**

```bash
rm test.txt test2.txt
```

- [ ] **Step 15: 记录测试结果**

创建测试报告（可选）：

```bash
echo "集成测试完成 - $(date)" >> docs/superpowers/plans/test-results.txt
```

- [ ] **Step 16: 最终提交**

如果有任何修复或调整：

```bash
git add .
git commit -m "test: complete integration testing and fixes"
```

---

## 测试完成检查清单

- [ ] 所有单元测试通过
- [ ] 白名单内文件自动执行
- [ ] 白名单外文件需要审批
- [ ] 审批卡片正确显示
- [ ] 批准操作正常工作
- [ ] 拒绝操作正常工作
- [ ] "记住此选择"功能正常
- [ ] 三种写入模式都正常工作
- [ ] 错误处理返回结构化信息
- [ ] 配置持久化正常
- [ ] 服务重启后白名单保持
