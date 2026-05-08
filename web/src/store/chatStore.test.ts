import { describe, expect, test } from "bun:test";
import { parseDbContent } from "./chatStore";

describe("parseDbContent", () => {
  test("restores AI SDK v6 tool parts from assistant history", () => {
    const parts = parseDbContent(
      JSON.stringify([
        { type: "text", text: "我来读取文件。" },
        {
          type: "tool-read_file",
          toolCallId: "call-1",
          state: "output-available",
          input: { path: "eslint.config.js" },
          output: { ok: true },
        },
      ]),
      "assistant",
    );

    expect(parts).toEqual([
      { type: "text", text: "我来读取文件。" },
      {
        type: "tool-read_file",
        toolCallId: "call-1",
        state: "output-available",
        input: { path: "eslint.config.js" },
        output: { ok: true },
      },
    ]);
  });
});
