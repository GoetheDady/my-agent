import { readFileSync } from "fs";
import { describe, expect, test } from "bun:test";
import { DEFAULT_AGENT_SYSTEM_PROMPT } from "../prompts/agent-prompt";

const chatRouteSource = readFileSync(new URL("./chat.ts", import.meta.url), "utf8");

describe("chat route memory behavior", () => {
  test("does not fetch or inject prefetched memories before model execution", () => {
    expect(chatRouteSource).not.toContain("getPrefetchedMemories");
    expect(chatRouteSource).not.toContain("queuePrefetch");
    expect(chatRouteSource).not.toContain("<relevant-memories>");
  });

  test("agent prompt documents memory tools without embedding memory content", () => {
    expect(DEFAULT_AGENT_SYSTEM_PROMPT).toContain("记忆工具");
    expect(DEFAULT_AGENT_SYSTEM_PROMPT).not.toContain("<relevant-memories>");
  });

  test("emits lifecycle hook after assistant message is persisted", () => {
    expect(chatRouteSource).toContain("assistant.message.persisted");
    expect(chatRouteSource).toContain("assistantMessageId");
  });
});
