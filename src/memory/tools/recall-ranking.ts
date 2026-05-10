import type { Memory } from "../storage/store";

export function rankRecallMemories(memories: Memory[], query: string): Memory[] {
  // 排序目标不是“只找最相似文本”，还要考虑置信度、最近更新、用户是否问偏好/变化轨迹。
  // 例如“我以前有没有改过主意”应该优先命中带“曾经/现在/改为”的再巩固记忆。
  const queryTokens = tokenizeRecallText(query);
  const asksPreference = /(喜欢|偏好|习惯|风格|沟通)/.test(query);
  const asksChange = /(改过主意|变化|变过|曾经|以前|现在|不喜欢|改为|不再|后来)/.test(query);
  const now = Date.now();

  return [...memories].sort((a, b) => {
    const scoreA = scoreRecallMemory(a, queryTokens, { asksPreference, asksChange, now });
    const scoreB = scoreRecallMemory(b, queryTokens, { asksPreference, asksChange, now });
    if (scoreB !== scoreA) return scoreB - scoreA;
    if (b.updated_at !== a.updated_at) return b.updated_at - a.updated_at;
    return a.id.localeCompare(b.id);
  });
}

function scoreRecallMemory(
  memory: Memory,
  queryTokens: string[],
  context: { asksPreference: boolean; asksChange: boolean; now: number },
): number {
  const content = memory.content;
  const contentTokens = new Set(tokenizeRecallText(content));
  let tokenScore = 0;
  for (const token of queryTokens) {
    if (contentTokens.has(token)) tokenScore += 1;
  }

  const confidenceScore = memory.confidence * 2;
  const ageDays = Math.max(0, (context.now - memory.updated_at) / 86_400_000);
  const recencyScore = 1 / (1 + ageDays / 7);
  const preferenceScore = context.asksPreference && /(喜欢|偏好|习惯|风格|沟通)/.test(content) ? 1.5 : 0;
  const changeScore = context.asksChange && /(曾经|曾表示|现在|改为|不喜欢|不再|变化|改)/.test(content) ? 3 : 0;

  return tokenScore + confidenceScore + recencyScore + preferenceScore + changeScore;
}

function tokenizeRecallText(text: string): string[] {
  const normalized = text
    .toLowerCase()
    .replace(/[^\u4e00-\u9fff\u3400-\u4dbfa-z0-9]/g, " ");
  const tokens: string[] = [];

  for (let index = 0; index < normalized.length - 1; index += 1) {
    const bigram = normalized.slice(index, index + 2).trim();
    if (bigram.length === 2 && !/\s/.test(bigram)) tokens.push(bigram);
  }

  tokens.push(...normalized.split(/\s+/).filter((word) => word.length > 1));
  return tokens;
}
