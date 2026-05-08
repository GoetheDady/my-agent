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

export function serializeAssistantPartsForStorage(parts: unknown[] | undefined): StoredPart[] {
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

export function extractAssistantText(parts: Array<{ type: string; text?: unknown }>): string {
  return parts
    .filter((part): part is { type: "text"; text: string } => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join(" ")
    .trim();
}
