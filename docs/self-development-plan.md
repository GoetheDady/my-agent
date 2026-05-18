# my-agent Self-Development 实现方案

> 让 my-agent 能改自己的代码、跑测试、提交 Git，实现「自己开发自己」。
> 本文是设计方案，不是执行记录。等用户确认后再动手。

---

## 一、总体思路

分三层递进，每层可独立交付：

| 层 | 目标 | 核心能力 | 安全机制 |
|---|------|----------|----------|
| L1 Terminal 工具 | Agent 能执行命令 | `bun test`, `bun lint`, `git status` | 超时 + 输出上限 + 无交互 |
| L2 Git 安全网 | 改不坏、可回滚 | 自动分支 + 测试门禁 | Git branch + 用户 merge |
| L3 Builder Agent | 专属开发角色 | 独立 Agent + 宽松策略 | Agent 隔离 + 路径白名单 |

---

## 二、L1：Terminal 工具（核心缺失能力）

### 2.1 新增文件

```
src/tools/terminal-executor.ts   ← 命令执行逻辑
src/tools/terminal-executor.test.ts  ← 测试
```

### 2.2 修改文件

```
src/tools/builtin-tools.ts      ← 注册 terminal 工具
src/tools/toolsets.ts           ← 新增 "shell" 工具组
src/tools/toolset-by-name 映射   ← terminal → shell
```

### 2.3 terminal-executor.ts 设计

```typescript
// 输入
interface TerminalInput {
  command: string;          // 要执行的 shell 命令
  workdir?: string;         // 工作目录，默认项目根
  timeout?: number;         // 超时秒数，默认 30，最大 120
}

// 输出
interface TerminalResult {
  success: boolean;
  data?: {
    stdout: string;         // 标准输出（最多 50KB）
    stderr: string;         // 标准错误（最多 50KB）
    exitCode: number;       // 退出码
    durationMs: number;     // 执行耗时
  };
  error?: {
    type: 'timeout' | 'command_rejected' | 'unknown';
    message: string;
    suggestion?: string;
  };
}
```

### 2.4 安全边界

| 约束 | 值 | 原因 |
|------|-----|------|
| 超时 | 默认 30s，最大 120s | 防止 Agent 跑死循环 |
| stdout 上限 | 50KB | 防止填满模型上下文 |
| stderr 上限 | 50KB | 同上 |
| 工作目录 | 默认项目根，不能穿越到上层 | 防止 Agent 改系统文件 |
| 交互 | **不支持** stdin（无 pty） | 防止 Agent 卡在交互式程序 |
| 后台 | **不支持**（至少 L1 不做） | 避免进程管理复杂度 |
| sudo | **不拦截但告警** | 用户系统可能有 sudo 免密；Agent 本身没有 root |

关键设计选择：**不做命令白名单/黑名单**。原因：
- 黑名单是漏勺（`rm` vs `\rm` vs `$(echo rm)`）
- Agent 已经有 `write_file`，真想搞破坏早就搞了
- 真正的安全锚点是 Git 分支 + 用户审查，不是命令过滤

### 2.5 builtin-tools.ts 注册

```typescript
// 在 builtin-tools.ts 中新增
const terminalSchema = z.object({
  command: z.string().describe('要执行的 shell 命令，如 "bun test"、"git diff"'),
  workdir: z.string().optional().describe('工作目录，默认项目根目录'),
  timeout: z.number().int().min(1).max(120).optional().describe('超时秒数，默认 30，最大 120'),
});

const terminalTool = tool({
  description: '在项目目录下执行 shell 命令。可以运行测试、lint、git 等开发命令。不支持交互式程序。',
  inputSchema: terminalSchema,
  needsApproval: async () => evaluateToolPolicy({
    toolName: 'terminal',
    operation: 'write',
  }).requiresApproval,
  execute: async (params) => executeTerminal(params),
});

registerTool({
  name: 'terminal',
  tool: terminalTool,
  toolset: 'shell',
  category: 'write',
});
```

### 2.6 toolsets.ts 新增

```typescript
{
  name: "shell",
  description: "项目目录下的 shell 命令执行工具，用于开发、测试、构建。",
  tools: ["terminal"],
}
```

### 2.7 审批策略

`terminal` 注册为 `category: 'write'`，默认需要审批。
用户可以在 Web 控制台将其从 `requiresApproval` 中移除。

---

## 三、L2：Git 安全网

### 3.1 不写新代码，建一个 Agent Skill

创建 `skills/builtin/self-dev.md`：

```markdown
# Self-Development Skill

## 何时使用
当你需要修改 my-agent 项目源代码时。

## 工作流
1. 先检查当前分支：`git branch --show-current`
2. 如果不是 `agent/` 前缀分支，创建新分支：
   `git checkout -b agent/<简短描述>`
3. 修改代码（用 write_file）
4. 运行测试：`bun test`
5. 运行 lint：`bun run lint`
6. 如果测试失败，修复后重跑
7. 确认全部通过后，总结修改内容，让用户 review 并 merge

## 禁止
- 不要在 main 分支上直接修改代码
- 不要在测试失败时提交
- 不要修改 .my-agent/ 下的运行时数据
```

### 3.2 builder Agent 配置

创建 `.my-agent/agents/builder/agent.json`：

```json
{
  "tools": {
    "enabledToolsets": ["memory", "file", "runtime", "core", "skill", "shell"],
    "requiresApproval": [],
    "allowedPaths": ["src/", "tests/", "web/src/", "skills/", "docs/"]
  },
  "memory": { "enabled": false }
}
```

关键点：
- `shell` toolset 启用（default Agent 不一定启用）
- `requiresApproval: []` — builder 不需要审批（它只改白名单路径）
- `allowedPaths` 限定到 `src/`, `tests/`, `web/src/`, `skills/`, `docs/`
- 不能碰 `.my-agent/`、`package.json`、`bun.lock` 等（除非审批放行）
- 记忆关闭（builder 不需要记住闲聊）

---

## 四、实施步骤（共 ~200 行新代码）

### Step 1：terminal-executor.ts（~80 行）
- `Bun.spawn()` 执行命令
- `AbortController` 做超时
- stdout/stderr 累积到上限后截断并标记 `[truncated]`
- 返回 `TerminalResult`

### Step 2：terminal-executor.test.ts（~60 行）
- 基本命令：`echo hello`
- 超时：`sleep 5` with 1s timeout
- 失败命令：`exit 1`
- 大输出截断
- 路径穿越防护：`cd ..` 之类（通过 resolve 限制到项目根）

### Step 3：builtin-tools.ts 注册（~30 行）
- schema 定义
- tool 实例化
- registerTool 调用
- toolsetByName 映射

### Step 4：toolsets.ts 新增 shell（~5 行）

### Step 5：self-dev Skill（~30 行）

### Step 6：builder Agent 配置（手动创建 agent.json）

### Step 7：集成测试
- 启动 my-agent
- 在 Web 控制台给 builder Agent 发：`用 bun test 跑一下测试`
- 验证 terminal 工具被调用、结果正确返回

---

## 五、不进本次方案的内容

| 不做 | 原因 |
|------|------|
| 命令白名单/黑名单 | 不可靠，安全靠 Git + 审查 |
| 交互式命令（pty） | 大幅增加复杂度，先做非交互 |
| 后台进程 | 进程生命周期管理复杂，L1 先不做 |
| 自动 git commit/push | 用户保持最终控制权 |
| content search（grep）工具 | terminal 已经能做 `grep -r`，够用 |
| `patch` 工具（targeted edit） | write_file 已能做全量替换；后续再补 |

---

## 六、风险与缓解

| 风险 | 缓解 |
|------|------|
| Agent 跑 `rm -rf src/` | Git 分支可恢复；allowedPaths 不拦截删除（做不到），但 builder 的 skill 禁止破坏性操作 |
| 命令注入（参数里有 `; rm -rf /`） | Bun.spawn 不支持 shell 注入链；命令以数组形式传递，不经过 shell 解析 |
| 死循环 | 120s 超时硬限制 |
| Agent 改坏自己的工具代码 | 测试门禁 + Git 回滚 |

---

## 七、和 Hermes 的对比

| 能力 | Hermes | my-agent (方案后) |
|------|--------|-------------------|
| terminal | ✅ (pty + 后台) | ✅ (非交互，L1) |
| patch/edit | ✅ | ❌ (write_file 全量替换) |
| git | ✅ | ✅ (terminal 间接) |
| web_search | ✅ | ❌ (暂不需要) |
| delegate_task | ✅ | ✅ (agent_delegate) |
| self-modify | ✅ (skill + patch) | ✅ (terminal + write_file) |

差距主要在 `patch`（精确编辑）和 `pty`（交互式 CLI），但不影响 self-development 的核心闭环。

---

## 八、预估工期

- terminal-executor + 测试：1 小时
- builtin-tools 注册 + toolsets：30 分钟
- self-dev Skill：15 分钟
- builder Agent 配置：10 分钟
- 集成验证：30 分钟

**总计约 2.5 小时**，约 200 行新增代码。
