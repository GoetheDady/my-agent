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

export function findDuplicateMemoryContent(content: string, memories: Memory[]): Memory | null {
  for (const memory of memories) {
    if (isDuplicateMemoryContent(content, memory.content)) return memory;
  }
  return null;
}

export function isDuplicateMemoryContent(candidateContent: string, existingContent: string): boolean {
  const candidate = normalizeMemoryContent(candidateContent);
  const existing = normalizeMemoryContent(existingContent);
  if (!candidate || !existing) return false;
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
