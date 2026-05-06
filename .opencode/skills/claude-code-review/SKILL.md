---
name: claude-code-review
description: Use after every code change to automatically invoke Codex for review before committing. Triggers after lint + typecheck pass.
---

# Codex Code Review

每次代码更改完成后，自动调用 Codex（`codex`）进行审查。审查通过后才算完成。

## 触发条件

**强制触发：**
- 每完成一个开发步骤（写完新文件或修改代码）后
- `bun run check` 零错误通过后

## 执行流程

**1. 先验证：**

```bash
bun run check   # lint + typecheck 必须零错误
```

**2. 获取本次改动的文件列表：**

```bash
git diff --stat   # 查看改动文件列表
```

**3. 调用 Codex 审查（只审查本次改动的文件）：**

```bash
codex review --uncommitted "只审查这些文件的改动: <文件列表>" 2>&1
```

其中 `<文件列表>` 替换为本次实际改动的文件路径，用逗号分隔。
例如：`codex review --uncommitted "只审查这些文件的改动: src/channels/http.ts, web/vite.config.ts"`

**为什么指定文件而不是审查所有未提交改动？**
- 用户可能多次修改才提交一次，每次 review 应该只看当前这次改动的文件
- 避免重复审查之前已经 review 过的改动

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

- 审查通过后**不提交代码**，留给用户手动提交
- 如果审查发现问题，修复后必须重新审查，形成闭环
