---
name: claude-code-review
description: Use after every code change to automatically invoke Claude Code for review before committing. Triggers after lint + typecheck pass.
---

# Claude Code Review

每次代码更改完成后，自动调用 Claude Code（`claude -p`）进行审查。审查通过后才算完成。

## 触发条件

**强制触发：**
- 每完成一个开发步骤（写完新文件或修改代码）后
- `bun run check` 零错误通过后

## 执行流程

**1. 先验证：**

```bash
bun run check   # lint + typecheck 必须零错误
```

**2. 获取改动范围：**

```bash
git diff --stat   # 查看改动文件列表
git diff           # 查看具体改动内容
```

**3. 调用 Claude Code 审查：**

```bash
claude -p "review the uncommitted changes in $(pwd). Show git diff, run 'bun run check', review all changed files for correctness, bugs, edge cases, and style issues. Be concise." --allowedTools "Bash(git:*) Bash(bun:*)" 2>&1
```

**为什么用 `-p` 而不是交互模式？**
- `-p` 是非交互模式，运行完返回结果，适合自动化流程
- 交互模式需要手动操作，无法嵌入开发流程

**为什么限制 `--allowedTools`？**
- 只允许 git 和 bun 命令，防止审查 Agent 做无关操作
- 加快审查速度（不需要确认权限弹窗）

**4. 处理审查结果：**
- **Critical / Important 问题**：立即修复，修完重新执行 `bun run check`，然后再次审查确认
- **Minor 问题**：记录到代码注释中标记 TODO，本次不改
- **审查通过（Approved / Ready）**：通知用户可以提交

**5. 输出给用户：**

```
审查通过，以下文件待提交：
  src/core/config.ts
  src/brain/provider.ts
```

## 审查内容要求

- 代码正确性（逻辑错误、API 误用）
- 边界情况处理（null、空数组、超时、网络异常）
- SSE 流式解析完整性
- 类型安全（`any` 使用是否合理）
- 注释是否完整（中文注释 + 关键逻辑说明）
- 与 spec 的一致性

## 注意事项

- 审查通过后**不提交代码**，留给用户用 Claude Code 交互式 review 后手动提交
- 如果审查发现问题，修复后必须重新审查，形成闭环
