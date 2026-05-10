export const MIN_SIMILARITY = 0.3;
export const MIN_FINAL_SCORE = 0.15;
export const VECTOR_WEIGHT = 0.7;
export const TEXT_WEIGHT = 0.3;
export const MMR_LAMBDA = 0.7;

export function memoryDecay(memoryType: string, lastAccessedAt: number): number {
  // 衰减表示“长期不用的记忆权重降低”。fact 衰减为 1，
  // 因为稳定事实不应该仅因最近没被问到就被遗忘。
  const days = (Date.now() - lastAccessedAt) / (1000 * 60 * 60 * 24);
  switch (memoryType) {
    case "fact":       return 1.0;
    case "project":    return 0.5 ** (days / 90);
    case "preference": return 0.5 ** (days / 30);
    case "lesson":     return 0.5 ** (days / 14);
    default:           return 0.5 ** (days / 30);
  }
}

export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const cleaned = text.toLowerCase().replace(/[^\u4e00-\u9fff\u3400-\u4dbfa-z0-9]/g, " ");
  for (let i = 0; i < cleaned.length - 1; i++) {
    const bigram = cleaned.slice(i, i + 2).trim();
    if (bigram.length === 2 && !/\s/.test(bigram)) {
      tokens.push(bigram);
    }
  }
  const words = cleaned.split(/\s+/).filter(w => w.length > 1);
  tokens.push(...words);
  return tokens;
}

export function tfidfScore(queryTokens: string[], docTokens: string[]): number {
  if (queryTokens.length === 0 || docTokens.length === 0) return 0;
  const docFreq = new Map<string, number>();
  for (const t of docTokens) {
    docFreq.set(t, (docFreq.get(t) ?? 0) + 1);
  }
  const docLen = docTokens.length;
  let score = 0;
  const matched = new Set<string>();
  for (const qt of queryTokens) {
    const freq = docFreq.get(qt);
    if (freq) {
      matched.add(qt);
      score += (freq / docLen) * (1 / (1 + Math.log(docLen)));
    }
  }
  return matched.size > 0 ? score * (matched.size / queryTokens.length) : 0;
}
