import { searchMemories } from "./store";
import { embedText, cosineSimilarity } from "./embedder";

let prefetchedMemories: Awaited<ReturnType<typeof searchMemories>> = [];
let prefetchPromise: Promise<void> | null = null;

export function queuePrefetch(text: string): void {
  if (!text || text.length < 5) return;
  prefetchPromise = searchMemories(text, 5)
    .then(results => {
      prefetchedMemories = results;
    })
    .catch(() => {
      prefetchedMemories = [];
    });
}

export async function getPrefetchedMemories(
  userMessage: string,
): Promise<Awaited<ReturnType<typeof searchMemories>>> {
  if (prefetchPromise) {
    try {
      await Promise.race([
        prefetchPromise,
        new Promise<void>(resolve => setTimeout(resolve, 2000)),
      ]);
    } catch {
      // prefetch 超时，降级
    }
  }

  if (prefetchedMemories.length > 0) {
    try {
      const currentEmb = await embedText(userMessage);
      const lastSourceText = prefetchedMemories[0]?.source_text ?? "";
      if (lastSourceText) {
        const prefetchEmb = await embedText(lastSourceText);
        if (cosineSimilarity(currentEmb, prefetchEmb) > 0.6) {
          const result = prefetchedMemories;
          prefetchedMemories = [];
          return result;
        }
      }
    } catch {
      // embedding 失败，降级
    }
  }

  prefetchedMemories = [];
  return searchMemories(userMessage, 5);
}
