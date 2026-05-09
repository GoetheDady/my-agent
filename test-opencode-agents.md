# OpenCode Agent Connectivity Test

测试 OpenCode 各个 agent 在新 provider 下的连通性。

## Test Plan

1. **Explore Agent** - 代码库搜索
2. **Librarian Agent** - 外部文档/库搜索
3. **Oracle Agent** - 高质量推理咨询
4. **Metis Agent** - 预规划分析
5. **Momus Agent** - 计划评审

## Test Execution

测试时间: 2026-05-09

---

### 1. Explore Agent Test

**目标**: 验证 explore agent 能否正常执行代码库搜索

**测试指令**: 
```
请使用 explore agent 搜索这个项目中所有与 "agent" 相关的文件和实现
```

**预期结果**: 
- Agent 成功启动
- 返回搜索结果
- 无连接错误

**实际结果**: 
_待填写_

---

### 2. Librarian Agent Test

**目标**: 验证 librarian agent 能否正常执行外部资源搜索

**测试指令**:
```
请使用 librarian agent 查找 Vercel AI SDK 的 streamText 函数的官方文档和最佳实践
```

**预期结果**:
- Agent 成功启动
- 返回外部文档链接和内容
- 无连接错误

**实际结果**:
_待填写_

---

### 3. Oracle Agent Test

**目标**: 验证 oracle agent 能否正常提供高质量推理

**测试指令**:
```
请咨询 oracle agent：在设计一个 AI agent 系统时，如何平衡 agent 的自主性和可控性？
```

**预期结果**:
- Agent 成功启动
- 返回深度分析和建议
- 无连接错误

**实际结果**:
_待填写_

---

### 4. Metis Agent Test

**目标**: 验证 metis agent 能否正常进行预规划分析

**测试指令**:
```
请使用 metis agent 分析这个需求：为项目添加一个新的 memory consolidation 功能，识别其中的歧义和潜在问题
```

**预期结果**:
- Agent 成功启动
- 识别需求中的歧义点
- 提出澄清问题
- 无连接错误

**实际结果**:
_待填写_

---

### 5. Momus Agent Test

**目标**: 验证 momus agent 能否正常评审计划

**测试指令**:
```
请使用 momus agent 评审以下计划：
1. 读取现有 memory 代码
2. 设计 consolidation 算法
3. 实现功能
4. 测试
```

**预期结果**:
- Agent 成功启动
- 指出计划中的不足
- 提供改进建议
- 无连接错误

**实际结果**:
_待填写_

---

## Summary

| Agent | Status | Duration | Notes |
|-------|--------|----------|-------|
| Explore | ❌ Timeout | 10m+ | Hung after 10+ minutes, cancelled |
| Librarian | ❌ Timeout | 10m+ | Hung after 10+ minutes, cancelled |
| Oracle | ✅ Pass | 26s | Successfully returned architectural analysis |
| Metis | ✅ Pass | 42s | Successfully identified ambiguities and asked clarifying questions |
| Momus | ✅ Pass | 14s | Successfully critiqued plan and identified missing details |

**Legend**: ✅ Pass | ❌ Fail | ⏳ Pending

---

## Test Results Detail

### ✅ Successful Agents (3/5)

**Oracle, Metis, Momus** all worked correctly with the new provider:
- Connected successfully
- Returned high-quality responses
- Completed in reasonable time (14-42 seconds)
- No connection errors

### ❌ Failed Agents (2/5)

**Explore and Librarian** both timed out:
- Both hung for 10+ minutes without completing
- Had to be manually cancelled
- This suggests an issue specific to these agent types

---

## Diagnosis

**Working**: Oracle, Metis, Momus (reasoning/analysis agents)
**Not Working**: Explore, Librarian (search/retrieval agents)

**Possible causes**:
1. Search agents may use different API endpoints or features
2. Tool execution timeout issues in search operations
3. Network/proxy configuration affecting external searches
4. Provider compatibility issue with specific tool types

**Recommendation**: Check OpenCode logs for Explore/Librarian agent errors during the 10-minute hang period.
