import { describe, expect, test } from "bun:test";
import { buildFeishuPostContent } from "./feishu-format";

describe("Feishu format helpers", () => {
  test("converts headings, bullet lists and inline styles to post content", () => {
    const post = buildFeishuPostContent([
      "## 能力",
      "- **长期记忆** —— 能记住偏好",
      "- `工具调用` —— 可以读写文件",
    ].join("\n"));

    expect(post.zh_cn.content[0]).toEqual([
      { tag: "text", text: "能力", style: ["bold"] },
    ]);
    expect(post.zh_cn.content[1]).toEqual([
      { tag: "text", text: "• " },
      { tag: "text", text: "长期记忆", style: ["bold"] },
      { tag: "text", text: " —— 能记住偏好" },
    ]);
    expect(post.zh_cn.content[2]).toEqual([
      { tag: "text", text: "• " },
      { tag: "text", text: "工具调用", style: ["underline"] },
      { tag: "text", text: " —— 可以读写文件" },
    ]);
  });

  test("converts ordered lists to numbered text prefixes", () => {
    const post = buildFeishuPostContent([
      "1. 第一项",
      "2. **第二项**",
    ].join("\n"));

    expect(post.zh_cn.content).toEqual([
      [
        { tag: "text", text: "1. " },
        { tag: "text", text: "第一项" },
      ],
      [
        { tag: "text", text: "2. " },
        { tag: "text", text: "第二项", style: ["bold"] },
      ],
    ]);
  });

  test("renders links as readable text with URL", () => {
    const post = buildFeishuPostContent("查看 [文档](https://example.test/docs)。");

    expect(post.zh_cn.content).toEqual([
      [
        { tag: "text", text: "查看 " },
        { tag: "text", text: "文档" },
        { tag: "text", text: " (https://example.test/docs)" },
        { tag: "text", text: "。" },
      ],
    ]);
  });

  test("keeps fenced code block as plain text paragraph", () => {
    const post = buildFeishuPostContent("```ts\nconst a = 1;\n```");

    expect(post.zh_cn.content).toEqual([
      [{ tag: "text", text: "const a = 1;" }],
    ]);
  });

  test("returns a safe blank paragraph for empty text", () => {
    const post = buildFeishuPostContent("");

    expect(post.zh_cn.content).toEqual([
      [{ tag: "text", text: " " }],
    ]);
  });
});
