import {
  isDuplicateMemoryContent,
  normalizeMemoryContent,
} from "./duplicate";

const lightWords = ["浅色", "亮色", "light"];
const darkWords = ["深色", "暗色", "dark"];
const comfortableWords = ["舒服", "舒适", "comfortable", "comfy"];
const mediumDensityWords = ["密度适中", "中等密度", "mediumdensity", "medium-density", "mediummedium"];
const uiWords = ["ui", "界面", "webui", "web界面"];

export interface CanonicalMemoryKey {
  key: string;
  kind: "preference" | "identity" | "project" | "generic";
}

/**
 * 为记忆内容生成规范化事实 key。
 *
 * canonical key 用于把同义表达归到同一事实，例如“浅色、舒服、密度适中 UI”
 * 和“浅色、中等密度、舒适 UI”应被视为同一条 UI 偏好。
 *
 * @param content 记忆内容。
 * @param memoryType 记忆类型。
 * @returns 可以生成稳定 key 时返回 key，否则返回 null。
 */
export function buildCanonicalMemoryKey(content: string, memoryType = "fact"): CanonicalMemoryKey | null {
  const normalized = normalizeMemoryContent(content);
  if (!normalized) return null;

  const uiPreferenceKey = buildUiPreferenceKey(normalized);
  if (uiPreferenceKey) return uiPreferenceKey;

  const identityKey = buildIdentityKey(normalized);
  if (identityKey) return identityKey;

  const projectKey = buildProjectKey(normalized);
  if (projectKey) return projectKey;

  if (memoryType === "prospective") {
    return { kind: "generic", key: `prospective:${normalized}` };
  }
  if (memoryType === "procedural" || memoryType === "reflective" || memoryType === "lesson") {
    return { kind: "generic", key: `${memoryType}:${normalized}` };
  }

  return null;
}

/**
 * 判断两条记忆是否可确定为重复。
 *
 * 先用 canonical key 处理同义事实，再回退到原有确定性重复判断。
 *
 * @param candidateContent 候选记忆内容。
 * @param existingContent 已有记忆内容。
 * @param candidateType 候选记忆类型。
 * @param existingType 已有记忆类型。
 * @returns 可确定重复时返回 true。
 */
export function isCanonicalDuplicateMemory(
  candidateContent: string,
  existingContent: string,
  candidateType = "fact",
  existingType = "fact",
): boolean {
  if (hasOppositePreferencePolarity(candidateContent, existingContent)) return false;

  const candidateKey = buildCanonicalMemoryKey(candidateContent, candidateType);
  const existingKey = buildCanonicalMemoryKey(existingContent, existingType);
  if (candidateKey && existingKey && candidateKey.key === existingKey.key) return true;
  if (candidateKey && existingKey && uiPreferenceKeysMatch(candidateKey.key, existingKey.key)) return true;

  return isDuplicateMemoryContent(candidateContent, existingContent);
}

/**
 * 比较两段记忆内容的信息量。
 *
 * 返回值越大表示 candidate 越值得替换 existing。这个函数只做保守判断，
 * 避免为了微小措辞差异频繁更新旧记忆。
 *
 * @param candidateContent 候选记忆。
 * @param existingContent 已有记忆。
 * @returns candidate 明显更完整时返回 true。
 */
export function isMoreCompleteMemoryContent(candidateContent: string, existingContent: string): boolean {
  const candidate = normalizeMemoryContent(candidateContent);
  const existing = normalizeMemoryContent(existingContent);
  if (candidate.length - existing.length >= 8) return true;

  const candidateSignals = completenessSignals(candidateContent);
  const existingSignals = completenessSignals(existingContent);
  return candidateSignals > existingSignals && candidate.length >= existing.length;
}

function buildUiPreferenceKey(normalized: string): CanonicalMemoryKey | null {
  if (!containsAny(normalized, uiWords)) return null;
  if (!/(偏好|喜欢|希望|风格|舒服|舒适|密度|浅色|深色|light|dark|density)/i.test(normalized)) return null;

  const parts = ["preference", "ui"];
  if (containsAny(normalized, lightWords)) parts.push("light");
  if (containsAny(normalized, darkWords)) parts.push("dark");
  if (containsAny(normalized, comfortableWords)) parts.push("comfortable");
  if (containsAny(normalized, mediumDensityWords) || /密度.*(适中|中等)/.test(normalized)) {
    parts.push("medium-density");
  }

  return parts.length > 2 ? { kind: "preference", key: parts.join(":") } : null;
}

function buildIdentityKey(normalized: string): CanonicalMemoryKey | null {
  const name = normalized.match(/(?:用户|我)?(?:名字|姓名|名称)?(?:叫|是)([\u4e00-\u9fffa-z0-9_-]{2,32})/)?.[1];
  return name ? { kind: "identity", key: `identity:name:${name}` } : null;
}

function buildProjectKey(normalized: string): CanonicalMemoryKey | null {
  if (!/(正在|长期|持续)?开发/.test(normalized)) return null;
  const project = normalized.match(/(my-agent|agent|openclaw|hermes-agent|[\u4e00-\u9fffa-z0-9_-]+项目)/i)?.[1];
  return project ? { kind: "project", key: `project:developing:${project.toLowerCase()}` } : null;
}

function completenessSignals(content: string): number {
  const normalized = normalizeMemoryContent(content);
  let score = 0;
  if (containsAny(normalized, lightWords)) score += 1;
  if (containsAny(normalized, darkWords)) score += 1;
  if (containsAny(normalized, comfortableWords)) score += 1;
  if (containsAny(normalized, mediumDensityWords) || /密度.*(适中|中等)/.test(normalized)) score += 1;
  if (containsAny(normalized, uiWords)) score += 1;
  if (/项目|my-agent|agent/i.test(normalized)) score += 1;
  return score;
}

function hasOppositePreferencePolarity(a: string, b: string): boolean {
  const aPolarity = preferencePolarity(normalizeMemoryContent(a));
  const bPolarity = preferencePolarity(normalizeMemoryContent(b));
  return aPolarity !== null && bPolarity !== null && aPolarity !== bPolarity;
}

function uiPreferenceKeysMatch(a: string, b: string): boolean {
  if (!a.startsWith("preference:ui") || !b.startsWith("preference:ui")) return false;
  const aTraits = new Set(a.split(":").slice(2));
  const bTraits = new Set(b.split(":").slice(2));
  if ((aTraits.has("light") && bTraits.has("dark")) || (aTraits.has("dark") && bTraits.has("light"))) {
    return false;
  }
  for (const trait of aTraits) {
    if (bTraits.has(trait)) return true;
  }
  return false;
}

function preferencePolarity(value: string): "positive" | "negative" | null {
  if (/(不喜欢|不偏好|不需要|不想要|讨厌)/.test(value)) return "negative";
  if (/(喜欢|偏好|需要|想要|希望|倾向)/.test(value)) return "positive";
  return null;
}

function containsAny(value: string, words: string[]): boolean {
  return words.some((word) => value.includes(word));
}
