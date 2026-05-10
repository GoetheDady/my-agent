type StoredPart = Record<string, unknown> & { type: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function cleanRecord(value: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    if (value[key] !== undefined) {
      result[key] = value[key];
    }
  }
  return result;
}

/**
 * 序列化助手消息 parts，得到适合入库的精简结构。
 *
 * @param parts AI SDK 返回的原始 parts。
 * @returns 只包含前端历史恢复所需字段的 parts。
 */
export function serializeAssistantPartsForStorage(parts: unknown[] | undefined): StoredPart[] {
  // 模型流里的 parts 可能包含大量 SDK 内部字段。
  // 入库前只保留前端展示和历史恢复需要的字段，避免数据库内容膨胀或格式不稳定。
  if (!Array.isArray(parts)) return [];

  return parts.flatMap((part) => {
    if (!isRecord(part) || typeof part.type !== "string") return [];

    if (part.type === "text" && typeof part.text === "string" && part.text.trim()) {
      return [{ type: "text", text: part.text }];
    }

    if (part.type === "reasoning" && typeof part.text === "string" && part.text.trim()) {
      return [{ type: "reasoning", text: part.text }];
    }

    if (part.type.startsWith("tool-") || part.type === "dynamic-tool") {
      return [
        {
          type: part.type,
          ...cleanRecord(part, [
            "toolName",
            "toolCallId",
            "state",
            "input",
            "output",
            "errorText",
            "approval",
            "title",
            "providerExecuted",
          ]),
        },
      ];
    }

    if (part.type === "tool-invocation" && isRecord(part.toolInvocation)) {
      return [{ type: "tool-invocation", toolInvocation: part.toolInvocation }];
    }

    return [];
  });
}

/**
 * 从助手消息 parts 中提取纯文本回复。
 *
 * @param parts 结构化助手消息片段。
 * @returns 拼接后的助手文本；没有文本时返回空字符串。
 */
export function extractAssistantText(parts: Array<{ type: string; text?: unknown }>): string {
  // 记忆 worker 和 episode worker 需要纯文本摘要，
  // 这里从结构化 parts 中抽出真正展示给用户的 assistant 文本。
  return parts
    .filter((part): part is { type: "text"; text: string } => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join(" ")
    .trim();
}
