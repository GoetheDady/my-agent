import { searchMemories } from "../store";
import { embedText, cosineSimilarity } from "../embedder";

let prefetchedMemories: Awaited<ReturnType<typeof searchMemories>> = [];
let prefetchPromise: Promise<void> | null = null;

/**
 * 预取与某段文本相关的长期记忆。
 *
 * @deprecated 长期记忆已经改为工具驱动。Prefetch 只保留给旧实验兼容，
 * 主聊天运行时不能在模型执行前调用它来注入长期记忆。
 *
 * @param text 用于预取的文本。
 */
export function queuePrefetch(text: string): void {
  // 旧实验代码：预取长期记忆后注入 prompt。
  // 现在坚持 Memory-as-Tool（记忆作为工具调用），所以主聊天运行时不应调用这里。
  if (!text || text.length < 5) return;
  prefetchPromise = searchMemories(text, 5)
    .then(results => {
      prefetchedMemories = results;
    })
    .catch(() => {
      prefetchedMemories = [];
    });
}

/**
 * 获取最近预取的记忆，必要时退化为实时搜索。
 *
 * @deprecated 长期记忆已经改为工具驱动。不要用这个 helper 把记忆注入 Agent system prompt。
 *
 * @param userMessage 当前用户消息，用于校验预取结果是否仍相关。
 * @returns 相关长期记忆列表。
 */
export async function getPrefetchedMemories(
  userMessage: string,
): Promise<Awaited<ReturnType<typeof searchMemories>>> {
  // 仅保留给兼容测试或旧入口。相似度检查用于避免把上一次用户输入的预取结果误用于本轮。
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
