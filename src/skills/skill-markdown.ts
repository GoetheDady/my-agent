import type { SkillStatus } from "./skill-types";

export interface ParsedSkillMarkdown {
  id?: string;
  name?: string;
  description?: string;
  category?: string;
  allowedTools: string[];
  defaultStatus?: SkillStatus;
  body: string;
}

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function jsonValue(value: string): string {
  return JSON.stringify(value);
}

function applyContentFallbacks(result: ParsedSkillMarkdown, content: string): void {
  if (!result.name) {
    const heading = content.match(/^#\s+(.+)$/m);
    if (heading) result.name = heading[1].trim();
  }
  if (!result.description) {
    const paragraph = content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0 && !line.startsWith("#") && !line.startsWith("---"));
    if (paragraph) result.description = paragraph;
  }
}

export function parseSkillMarkdown(content: string): ParsedSkillMarkdown {
  const result: ParsedSkillMarkdown = { allowedTools: [], body: content };
  if (!content.startsWith("---")) {
    applyContentFallbacks(result, content);
    return result;
  }

  const endIndex = content.indexOf("\n---", 3);
  if (endIndex < 0) {
    applyContentFallbacks(result, content);
    return result;
  }

  const frontmatter = content.slice(3, endIndex).split(/\r?\n/);
  const body = content.slice(endIndex + 4).trimStart();
  result.body = body;
  let currentArrayKey: string | null = null;
  for (const rawLine of frontmatter) {
    const line = rawLine.trimEnd();
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const arrayItem = line.match(/^\s*-\s+(.+)$/);
    if (arrayItem && currentArrayKey === "allowedTools") {
      result.allowedTools.push(stripQuotes(arrayItem[1]));
      continue;
    }
    currentArrayKey = null;
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;
    const key = match[1];
    const value = stripQuotes(match[2] ?? "");
    if (value === "") {
      if (key === "allowedTools") currentArrayKey = key;
      continue;
    }
    if (key === "id") result.id = value;
    if (key === "name") result.name = value;
    if (key === "description") result.description = value;
    if (key === "category") result.category = value;
    if (key === "defaultStatus" && (value === "enabled" || value === "disabled")) result.defaultStatus = value;
    if (key === "allowedTools") {
      result.allowedTools = value.split(",").map((item) => stripQuotes(item)).filter(Boolean);
    }
  }
  applyContentFallbacks(result, body);
  return result;
}

export function buildFrontmatter(input: {
  id: string;
  name: string;
  description: string;
  category: string;
  allowedTools: string[];
  source: string;
}): string {
  const lines = [
    "---",
    `id: ${jsonValue(input.id)}`,
    `name: ${jsonValue(input.name)}`,
    `description: ${jsonValue(input.description)}`,
    `category: ${jsonValue(input.category)}`,
    `source: ${jsonValue(input.source)}`,
  ];
  if (input.allowedTools.length > 0) {
    lines.push("allowedTools:");
    for (const toolName of input.allowedTools) {
      lines.push(`  - ${jsonValue(toolName)}`);
    }
  }
  lines.push("---");
  return lines.join("\n");
}

export function buildSkillMarkdown(input: {
  id: string;
  name: string;
  description: string;
  category: string;
  allowedTools: string[];
  source: string;
  content: string;
}): string {
  const trimmedContent = input.content.trim();
  if (trimmedContent.startsWith("---")) {
    return `${trimmedContent}\n`;
  }
  const frontmatter = buildFrontmatter(input);
  const body = trimmedContent.length > 0
    ? trimmedContent
    : `# ${input.name}\n\n${input.description}`;
  return `${frontmatter}\n\n${body.trim()}\n`;
}
