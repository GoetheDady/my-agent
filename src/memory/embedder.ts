import { getConfig } from "../core/config";
import { createHash } from "crypto";

const cache = new Map<string, { embedding: number[]; timestamp: number }>();
const CACHE_MAX_SIZE = 100;
const CACHE_TTL_MS = 30 * 60 * 1000;

function getCacheKey(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

function cleanCache(): void {
  if (cache.size <= CACHE_MAX_SIZE) return;
  const entries = Array.from(cache.entries()).sort((a, b) => a[1].timestamp - b[1].timestamp);
  for (const [key] of entries.slice(0, entries.length - CACHE_MAX_SIZE)) {
    cache.delete(key);
  }
}

export async function embedText(text: string): Promise<number[]> {
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

export function cosineSimilarity(a: number[], b: number[]): number {
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
