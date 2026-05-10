export const MIN_WRITE_CONFIDENCE = 0.7;
export const MIN_MEMORY_CONTENT_LENGTH = 6;
export const RELATED_MEMORY_LIMIT = 8;

const suspiciousMemoryPatterns = [
  /ignore\s+(previous|all|above|prior)\s+instructions/i,
  /system\s*prompt/i,
  /you\s+are\s+now/i,
  /忽略.*指令/,
  /你现在是/,
  /forget\s+(all|previous|everything)/i,
  /disregard\s+(all|previous)/i,
];

/**
 * 判断一段候选记忆是否允许写入长期记忆。
 *
 * 这个函数是 worker 的最后一道本地安全边界：模型输出即使格式合法，也必须满足
 * 置信度、长度和提示词注入过滤，才能真正落库。
 *
 * @param content 候选记忆正文。
 * @param confidence planner 给出的置信度。
 * @returns 可以写入时返回 true。
 */
export function isAllowedMemoryContent(content: string, confidence: number): boolean {
  if (confidence < MIN_WRITE_CONFIDENCE) return false;
  if (content.length < MIN_MEMORY_CONTENT_LENGTH) return false;
  return !suspiciousMemoryPatterns.some((pattern) => pattern.test(content));
}
