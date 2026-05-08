import { describe, expect, test } from "bun:test";
import { extractAssistantText, serializeAssistantPartsForStorage } from "./message-parts";

describe("message-parts", () => {
  test("keeps tool parts when serializing assistant UI messages", () => {
    const parts = serializeAssistantPartsForStorage([
      { type: "text", text: "我来读取文件。" },
      {
        type: "tool-read_file",
        toolCallId: "call-1",
        state: "output-available",
        input: { path: "eslint.config.js" },
        output: { ok: true, content: "export default []" },
      },
      { type: "text", text: "读取完成。" },
    ]);

    expect(parts).toEqual([
      { type: "text", text: "我来读取文件。" },
      {
        type: "tool-read_file",
        toolCallId: "call-1",
        state: "output-available",
        input: { path: "eslint.config.js" },
        output: { ok: true, content: "export default []" },
      },
      { type: "text", text: "读取完成。" },
    ]);
    expect(extractAssistantText(parts)).toBe("我来读取文件。 读取完成。");
  });
});
