# 记忆系统重构设计

## 背景

当前记忆系统使用 SQLite 存储 embedding（JSON 序列化），暴力遍历计算余弦相似度。存在以下问题：
1. 万级以上性能退化
2. 无关键词搜索能力，精确匹配（人名、术语）不靠谱
3. 每次请求都调 embedding API，无缓存
4. 记忆注入无安全防护
5. 无管理界面

## 目标

1. LanceDB 接管记忆系统（元数据 + 向量统一存储）
2. 混合搜索（向量 70% + BM25 关键词 30%）
3. Prefetch 预取降低首字延迟
4. Prompt 注入防护
5. Embedding 缓存
6. 记忆管理后台（Web UI）

## 架构

### 数据层

```
SQLite (data/agent.sqlite)
  └── sessions / messages（不变）

LanceDB (data/memories.lancedb/)
  └── memories 表
```

### 文件变更

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `src/memory/store.ts` | 重写 | LanceDB 替换 SQLite + 混合搜索 + MMR 去重 |
| `src/memory/embedder.ts` | 小改 | 加 LRU 缓存 |
| `src/memory/memory.ts` | 小改 | 注入防护增强 + untrusted 标记 |
| `src/memory/prefetch.ts` | 新增 | Prefetch 预取模块 |
| `src/core/database.ts` | 小改 | 删除 memories 建表和索引 |
| `src/channels/memory-api.ts` | 新增 | 记忆管理 REST API |
| `src/channels/http.ts` | 小改 | 注册记忆 API 路由 + prefetch 触发 |
| `web/src/components/MemoryPanel.tsx` | 新增 | 记忆管理面板 |
| `web/src/store/memoryStore.ts` | 新增 | 记忆管理状态 |

不变的文件：`extract.ts`、`core/config.ts`、`brain/` 全部。

## LanceDB 存储设计

### Table Schema

```
memories 表：
  id:                string (UUID, 主键)
  user_id:           string
  agent_id:          string
  memory_type:       string (fact/preference/project/lesson)
  content:           string
  vector:            FixedSizeList<Float32> (2048维)
  source_session_id: string
  source_text:       string
  status:            string (active/superseded)
  confidence:        float64
  created_at:        int64
  updated_at:        int64
  last_accessed_at:  int64
  access_count:      int32
  embedding_model:   string
```

### 连接管理

单例模式，启动时连接 `data/memories.lancedb`，table 不存在时自动创建。

### CRUD 操作

所有操作只写 LanceDB，不再碰 SQLite：
- `addMemory`：embed → insert into LanceDB
- `updateMemory`：re-embed → update LanceDB
- `deleteMemory`：delete from LanceDB
- `supersedeMemory`：update status → insert new
- `touchMemory`：update last_accessed_at + access_count

### 数据迁移

提供一次性迁移脚本，从 SQLite `memories` 表读取数据，解析 JSON embedding，写入 LanceDB。迁移后 SQLite 的 `memories` 表和相关索引删除。

## 混合搜索

### 流程

```
Query
  ├─→ embed(query) → LanceDB 向量搜索 → topN * 3 候选
  └─→ 中文 bigram 分词 → TF-IDF 关键词搜索 → topN * 3 候选
      ↓
  加权合并 (vector=0.7, text=0.3)
      ↓
  衰减打分: similarity * decay(type, age) * confidence
      ↓
  MMR 去重 (lambda=0.7)
      ↓
  取 topN
```

### 向量搜索

使用 LanceDB `.search(vector).where("status = 'active'").limit(topN * 3)`。

### BM25 关键词搜索

不引入额外依赖，用内存中的 TF-IDF 实现：
- 对 content 做中文字符 bigram 分词（2 字符滑动窗口）
- 对 query 做同样分词
- 计算 TF-IDF 余弦相似度
- 取 topN * 3

### MMR 去重

替代当前 `cosineSimilarity > 0.95` 硬阈值去重：

```
MMR = lambda * relevance - (1-lambda) * max_similarity_to_selected
```

lambda = 0.7，相似度用 cosine similarity on embedding vectors。

### 衰减函数

保持现有设计不变：
- fact: 1.0（永不过期）
- project: 0.5^(days/90)
- preference: 0.5^(days/30)
- lesson: 0.5^(days/14)

## Embedding 缓存

在 `embedder.ts` 中实现 LRU 缓存：
- 容量：100 条
- Key：文本内容的 SHA-256 hash（前 16 字符）
- Value：embedding 向量 (number[])
- 命中时直接返回，不调 API
- 仅缓存 embedText 调用，不影响 cosineSimilarity

## Prefetch 预取

### 模块：`src/memory/prefetch.ts`

```typescript
// 状态
let prefetchedMemories: Memory[] = [];
let prefetchPromise: Promise<void> | null = null;

// 上一轮回复结束后调用
export function queuePrefetch(text: string): void {
  prefetchPromise = searchMemories(text, 5).then(
    results => { prefetchedMemories = results; },
    () => { prefetchedMemories = []; }
  );
}

// 下一轮请求时调用
export async function getInjectedMemories(
  systemPrompt: string, userMessage: string
): Promise<string>
```

### 触发时机

1. `handleChat` 的 finally 块中：assistant 回复写入后，调用 `queuePrefetch(assistantText)`
2. 下一次 `handleChat` 调用时：用 `getInjectedMemories` 获取结果

### 降级策略

- 预取未完成或结果为空：降级为实时搜索
- 预取结果与当前 query 相关性低（cosine < 0.6）：降级为实时搜索

## 注入防护

### 内容清洗

```typescript
function sanitizeMemoryContent(text: string): string {
  return text
    .replace(/\n/g, " ")
    .replace(/\r/g, "")
    .replace(/```/g, "")
    .replace(/<[^>]+>/g, "")
    .slice(0, 500);
}
```

### 注入检测

```typescript
const INJECTION_PATTERNS = [
  /ignore\s+(previous|all|above|prior)\s+instructions/i,
  /system\s*prompt/i,
  /you\s+are\s+now/i,
  /忽略.*指令/,
  /你现在是/,
];

function isSuspicious(text: string): boolean {
  return INJECTION_PATTERNS.some(p => p.test(text));
}
```

可疑内容不注入，但记录日志。

### Untrusted 标记

注入的记忆用 `<relevant-memories>` XML 标签包裹，明确标记为不可信参考数据，不是指令。

## 记忆管理后台

### 后端 API

新增 `src/channels/memory-api.ts`：

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/memories` | 分页列表，支持 ?page&pageSize&type&status&search |
| GET | `/api/memories/stats` | 统计（总数/按类型/按状态） |
| GET | `/api/memories/:id` | 单条详情 |
| POST | `/api/memories` | 手动添加 |
| PATCH | `/api/memories/:id` | 编辑内容（自动重新 embed） |
| DELETE | `/api/memories/:id` | 删除 |
| POST | `/api/memories/search` | 语义搜索（测试用） |

### 前端组件

新增 `web/src/components/MemoryPanel.tsx`：

- 右侧滑出面板，点击记忆图标按钮打开
- 顶部：类型筛选 tab（全部/事实/偏好/项目/教训）
- 搜索框：支持语义搜索
- 统计栏：总数和分类计数
- 记忆卡片列表：显示类型、内容、置信度、访问次数、创建时间
- 每张卡片：编辑和删除按钮
- 编辑弹出 modal，修改 content 后自动重新 embed
- 删除需二次确认
- 手动添加表单：content + memory_type
- 分页加载（滚动加载更多）

新增 `web/src/store/memoryStore.ts`：

- Zustand store 管理 memories 列表、筛选条件、分页状态
- 封装所有 API 调用

`App.tsx` 小改：在顶部导航加记忆图标按钮。

## 依赖

- `@lancedb/lancedb`：已验证在 Bun 1.3.11 上可用
- 无其他新增依赖（BM25 用内存实现，不引入第三方库）

## 验收标准

1. 现有功能不退化：记忆提取、注入、衰减正常工作
2. 混合搜索：关键词精确匹配场景比纯向量搜索好
3. Embedding 缓存命中时跳过 API 调用
4. Prefetch 生效时首字延迟降低
5. 注入防护：包含注入模式的内容不被注入到 prompt
6. 管理后台：可浏览、搜索、编辑、删除记忆
7. lint + typecheck 通过
