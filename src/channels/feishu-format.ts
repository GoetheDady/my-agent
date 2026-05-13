import MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";

interface FeishuPostTextElement {
  tag: "text";
  text: string;
  style?: string[];
}

interface FeishuPostContent {
  zh_cn: {
    title: string;
    content: FeishuPostTextElement[][];
  };
}

const markdown = new MarkdownIt({
  html: false,
  linkify: false,
  typographer: false,
});

function uniqueStyles(styles: string[]): string[] {
  return Array.from(new Set(styles));
}

function textElement(text: string, styles: string[] = []): FeishuPostTextElement {
  return {
    tag: "text",
    text,
    ...(styles.length > 0 ? { style: uniqueStyles(styles) } : {}),
  };
}

function getAttr(token: Token, name: string): string {
  return token.attrs?.find(([key]) => key === name)?.[1] ?? "";
}

function renderInlineTokens(tokens: Token[] = [], inheritedStyles: string[] = []): FeishuPostTextElement[] {
  const elements: FeishuPostTextElement[] = [];
  const styleStack: string[] = [...inheritedStyles];
  const linkStack: string[] = [];

  for (const token of tokens) {
    if (token.type === "text") {
      if (token.content) elements.push(textElement(token.content, styleStack));
    } else if (token.type === "code_inline") {
      elements.push(textElement(token.content, [...styleStack, "underline"]));
    } else if (token.type === "strong_open") {
      styleStack.push("bold");
    } else if (token.type === "strong_close") {
      const index = styleStack.lastIndexOf("bold");
      if (index >= 0) styleStack.splice(index, 1);
    } else if (token.type === "link_open") {
      linkStack.push(getAttr(token, "href"));
    } else if (token.type === "link_close") {
      const href = linkStack.pop();
      if (href) elements.push(textElement(` (${href})`, styleStack));
    } else if (token.type === "softbreak" || token.type === "hardbreak") {
      elements.push(textElement("\n", styleStack));
    }
  }

  return elements.length > 0 ? elements : [textElement(" ")];
}

/**
 * 把 Agent 常见 Markdown 回复转成飞书 post 富文本结构。
 *
 * 飞书 `text` 消息不会解析 Markdown；`post` 是飞书富文本消息类型，
 * 需要发送结构化 JSON。这里使用 markdown-it 负责语法解析，本模块只做
 * Markdown token 到飞书 post 元素的映射。
 */
export function buildFeishuPostContent(text: string): FeishuPostContent {
  const tokens = markdown.parse(text.trim() || " ", {});
  const content: FeishuPostTextElement[][] = [];
  const listStack: Array<"bullet" | "ordered"> = [];
  const orderedCounters: number[] = [];
  let pendingParagraphStyles: string[] = [];
  let pendingListPrefix = "";

  for (const token of tokens) {
    switch (token.type) {
      case "heading_open":
        pendingParagraphStyles = ["bold"];
        break;
      case "paragraph_open":
        pendingParagraphStyles = [];
        break;
      case "inline": {
        const prefix = pendingListPrefix ? [textElement(pendingListPrefix)] : [];
        content.push([
          ...prefix,
          ...renderInlineTokens(token.children ?? [], pendingParagraphStyles),
        ]);
        pendingListPrefix = "";
        break;
      }
      case "fence":
      case "code_block": {
        const codeText = token.content.replace(/\n$/, "");
        content.push([textElement(codeText || " ")]);
        break;
      }
      case "bullet_list_open":
        listStack.push("bullet");
        break;
      case "bullet_list_close":
        listStack.pop();
        break;
      case "ordered_list_open":
        listStack.push("ordered");
        orderedCounters.push(Number(token.attrGet("start") ?? 1));
        break;
      case "ordered_list_close":
        listStack.pop();
        orderedCounters.pop();
        break;
      case "list_item_open": {
        const currentList = listStack.at(-1);
        if (currentList === "ordered") {
          const index = orderedCounters.length - 1;
          const currentNumber = orderedCounters[index] ?? Number(token.info || 1);
          pendingListPrefix = `${currentNumber}. `;
          orderedCounters[index] = currentNumber + 1;
        } else if (currentList === "bullet") {
          pendingListPrefix = "• ";
        }
        break;
      }
    }
  }

  return {
    zh_cn: {
      title: "",
      content: content.length > 0 ? content : [[textElement(" ")]],
    },
  };
}
