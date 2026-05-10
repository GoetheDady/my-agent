import type { RuntimeEvent } from "../../events/event-types";

export function extractResultIds(event: RuntimeEvent): string[] {
  try {
    const payload = JSON.parse(event.payload) as { resultIds?: unknown };
    return Array.isArray(payload.resultIds)
      ? payload.resultIds.filter((id): id is string => typeof id === "string")
      : [];
  } catch {
    return [];
  }
}

export function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

export function buildSummary(addedCount: number, updatedCount: number): string {
  if (addedCount === 0 && updatedCount === 0) return "无新增或需要再巩固的记忆";
  const parts: string[] = [];
  if (addedCount > 0) parts.push(`新增 ${addedCount} 条记忆`);
  if (updatedCount > 0) parts.push(`再巩固 ${updatedCount} 条记忆`);
  return parts.join("，");
}
