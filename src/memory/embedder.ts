import { getConfig } from "../core/config";

export async function embedText(text: string): Promise<number[]> {
  const config = getConfig();
  if (!config.embedding.apiKey) {
    return [];
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
    return data.data[0]?.embedding ?? [];
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
