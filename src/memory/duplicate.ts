import type { Memory } from "./store";

const MIN_DUPLICATE_KEY_LENGTH = 4;

const subjectPrefixes = [
  "请记住",
  "记住",
  "用户",
  "本人",
  "我们",
  "咱们",
  "我",
  "user",
];

const predicateMarkers = [
  "不喜欢",
  "不偏好",
  "不需要",
  "不想要",
  "正在开发",
  "正在使用",
  "偏好",
  "喜欢",
  "需要",
  "想要",
  "希望",
  "倾向",
  "习惯",
  "开发",
  "使用",
  "目标",
  "计划",
];

const positivePreferenceMarkers = ["偏好", "喜欢", "需要", "想要", "希望", "倾向"];
const negativePreferenceMarkers = ["不偏好", "不喜欢", "不需要", "不想要", "讨厌"];

/**
 * 在已有记忆中查找与候选内容重复的记忆。
 *
 * @param content 候选记忆内容。
 * @param memories 已有记忆列表。
 * @returns 找到时返回第一条重复记忆，否则返回 `null`。
 */
export function findDuplicateMemoryContent(content: string, memories: Memory[]): Memory | null {
  for (const memory of memories) {
    if (isDuplicateMemoryContent(content, memory.content)) return memory;
  }
  return null;
}

/**
 * 判断两段记忆内容是否表达同一事实。
 *
 * 会处理“请记住/用户/我”等前缀，以及偏好对象包含关系；
 * 正负偏好相反时不会判为重复。
 *
 * @param candidateContent 候选内容。
 * @param existingContent 已有内容。
 * @returns 两者可确定为重复时返回 `true`。
 */
export function isDuplicateMemoryContent(candidateContent: string, existingContent: string): boolean {
  // 重复判断不是简单字符串相等，还会去掉“请记住/用户/我”等主语前缀，
  // 并提取“喜欢 X / 偏好 X / 正在开发 X”这类谓词后的核心事实。
  const candidate = normalizeMemoryContent(candidateContent);
  const existing = normalizeMemoryContent(existingContent);
  if (!candidate || !existing) return false;
  // 正负偏好相反时不能当重复处理，例如“喜欢西红柿”和“不喜欢西红柿”。
  // 这种情况交给记忆再巩固生成变化轨迹。
  if (hasOppositePolarity(candidate, existing)) return false;
  if (candidate === existing) return true;

  const candidateKeys = buildDuplicateKeys(candidate);
  const existingKeys = buildDuplicateKeys(existing);
  for (const candidateKey of candidateKeys) {
    for (const existingKey of existingKeys) {
      if (keysMatch(candidateKey, existingKey)) return true;
    }
  }

  return false;
}

/**
 * 规范化记忆内容，便于重复判断。
 *
 * @param content 原始记忆内容。
 * @returns 去空白、去标点、转小写后的字符串。
 */
export function normalizeMemoryContent(content: string): string {
  return content
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[，。,.；;：:"“”'‘’、！!？?（）()【】[\]《》<>]/g, "")
    .trim();
}

function buildDuplicateKeys(normalized: string): string[] {
  const keys = new Set<string>([normalized]);
  keys.add(stripSubjectPrefixes(normalized));

  for (const marker of predicateMarkers) {
    const index = normalized.indexOf(marker);
    if (index < 0) continue;
    if (isNegatedPositiveMarker(normalized, marker, index)) continue;
    keys.add(normalized.slice(index));
  }

  const preferenceKey = preferenceObjectKey(normalized);
  if (preferenceKey) keys.add(preferenceKey);

  return Array.from(keys).filter((key) => key.length >= MIN_DUPLICATE_KEY_LENGTH);
}

function stripSubjectPrefixes(value: string): string {
  let current = value;
  let changed = true;
  while (changed) {
    changed = false;
    for (const prefix of subjectPrefixes) {
      if (current.startsWith(prefix) && current.length > prefix.length) {
        current = current.slice(prefix.length);
        changed = true;
      }
    }
  }
  return current;
}

function keysMatch(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < MIN_DUPLICATE_KEY_LENGTH || b.length < MIN_DUPLICATE_KEY_LENGTH) return false;
  return a.includes(b) || b.includes(a);
}

function preferenceObjectKey(normalized: string): string | null {
  // 偏好对象 key 用来识别“fact 包含 preference”的重复：
  // 例如“我偏好浅色 UI”和“用户偏好浅色 UI”应该归为同一事实。
  for (const marker of negativePreferenceMarkers) {
    const index = normalized.indexOf(marker);
    if (index >= 0) {
      const object = stripSubjectPrefixes(normalized.slice(index + marker.length));
      return object.length >= MIN_DUPLICATE_KEY_LENGTH ? `negative:${object}` : null;
    }
  }

  for (const marker of positivePreferenceMarkers) {
    const index = normalized.indexOf(marker);
    if (index < 0) continue;
    if (isNegatedPositiveMarker(normalized, marker, index)) continue;
    const object = stripSubjectPrefixes(normalized.slice(index + marker.length));
    return object.length >= MIN_DUPLICATE_KEY_LENGTH ? `positive:${object}` : null;
  }

  return null;
}

function hasOppositePolarity(a: string, b: string): boolean {
  const aPolarity = preferencePolarity(a);
  const bPolarity = preferencePolarity(b);
  return aPolarity !== null && bPolarity !== null && aPolarity !== bPolarity;
}

function preferencePolarity(value: string): "positive" | "negative" | null {
  if (negativePreferenceMarkers.some((marker) => value.includes(marker))) return "negative";
  if (positivePreferenceMarkers.some((marker) => value.includes(marker))) return "positive";
  return null;
}

function isNegatedPositiveMarker(value: string, marker: string, index: number): boolean {
  if (!positivePreferenceMarkers.includes(marker)) return false;
  const previous = value[index - 1];
  return previous === "不" || previous === "没" || previous === "無" || previous === "无";
}
