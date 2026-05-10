import { getConfig } from "../core/config";
import { createHash } from "crypto";

const cache = new Map<string, { embedding: number[]; timestamp: number }>();
const CACHE_MAX_SIZE = 100;
const CACHE_TTL_MS = 30 * 60 * 1000;

function getCacheKey(text: string): string {
  // embedding 请求按文本 hash 缓存，避免同一条记忆在短时间内反复请求外部服务。
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

function cleanCache(): void {
  // 简单按时间淘汰最旧缓存，防止长时间运行时 Map 无限增长。
  if (cache.size <= CACHE_MAX_SIZE) return;
  const entries = Array.from(cache.entries()).sort((a, b) => a[1].timestamp - b[1].timestamp);
  for (const [key] of entries.slice(0, entries.length - CACHE_MAX_SIZE)) {
    cache.delete(key);
  }
}

/**
 * 调用 embedding 服务把文本转换成向量。
 *
 * @param text 要向量化的文本。
 * @returns embedding 数组；未配置 API Key 或请求失败时返回空数组。
 */
export async function embedText(text: string): Promise<number[]> {
  // Embedding 是文本的向量表示，语义相近的文本向量距离也更近。
  // 如果没有 ZHIPU_API_KEY，返回空数组，让上层选择跳过记忆写入/搜索。
  const config = getConfig();
  if (!config.embedding.apiKey) {
    return [];
  }

  const key = getCacheKey(text);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.embedding;
  }

  try {
    const res = await fetch("https://open.bigmodel.cn/api/paas/v4/embeddings", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${config.embedding.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.embedding.model,
        input: text,
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      console.error(`[embedder] API 错误 ${res.status}`);
      return [];
    }

    const data = await res.json() as { data: Array<{ embedding: number[] }> };
    const embedding = data.data[0]?.embedding ?? [];

    if (embedding.length > 0) {
      cache.set(key, { embedding, timestamp: Date.now() });
      cleanCache();
    }

    return embedding;
  } catch (err) {
    console.error("[embedder] 请求失败:", err);
    return [];
  }
}

/**
 * 计算两个向量的余弦相似度。
 *
 * @param a 第一个向量。
 * @param b 第二个向量。
 * @returns 相似度，范围通常为 -1 到 1；输入无效时返回 0。
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  // 余弦相似度用于比较两个向量方向是否接近，结果越接近 1 表示语义越相似。
  if (a.length === 0 || b.length === 0) return 0;
  if (a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
