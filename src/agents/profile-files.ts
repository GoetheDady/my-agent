import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { getProjectRoot } from "../core/config";

export const DEFAULT_SOUL_FILENAME = "soul.md";
export const DEFAULT_USER_FILENAME = "user.md";

const MAX_PROFILE_FILE_CHARS = 12_000;

export interface ProfileFile {
  kind: "soul" | "user";
  path: string;
  content: string;
}

export interface ProfileContext {
  files: ProfileFile[];
  soul: string | null;
  user: string | null;
}

export interface LoadProfileContextOptions {
  agentId?: string;
  userId?: string;
  rootDir?: string;
  createIfMissing?: boolean;
}

export interface ProfileFilePaths {
  soulPath: string;
  userPath: string;
}

export interface ProfileBulletUpdate {
  section: string;
  bullet: string;
  replaceMatching?: RegExp[];
}

export interface ApplyProfileUpdatesOptions {
  agentId?: string;
  userId?: string;
  rootDir?: string;
  soulUpdates?: ProfileBulletUpdate[];
  userUpdates?: ProfileBulletUpdate[];
}

export interface AppliedProfileUpdate {
  kind: "soul" | "user";
  section: string;
  bullet: string;
}

/**
 * 加载当前 Agent 和用户的 profile 文件。
 *
 * profile 文件包括 `soul.md` 和 `user.md`。缺失时默认会创建模板，
 * 然后返回可注入 prompt 的稳定认知内容。
 *
 * @param options Agent/User 标识、项目根目录和是否自动创建缺失文件。
 * @returns profile 文件列表，以及单独的 soul/user 内容。
 */
export function loadProfileContext(options: LoadProfileContextOptions = {}): ProfileContext {
  // profile 文件是稳定认知层：user.md 描述“我对用户的长期认知”，
  // soul.md 描述“我对自己的长期行为原则”。事件事实仍然通过记忆工具查。
  const rootDir = options.rootDir ?? getProjectRoot();
  const agentId = safeProfileSegment(options.agentId ?? "default");
  const userId = safeProfileSegment(options.userId ?? "default");
  const createIfMissing = options.createIfMissing ?? true;
  const { soulPath, userPath } = getProfileFilePaths({ rootDir, agentId, userId });

  if (createIfMissing) {
    writeFileIfMissing(soulPath, buildDefaultSoulTemplate(agentId));
    writeFileIfMissing(userPath, buildDefaultUserTemplate(userId));
  }

  const files: ProfileFile[] = [];
  const soul = readProfileFile(soulPath);
  if (soul) files.push({ kind: "soul", path: soulPath, content: soul });
  const user = readProfileFile(userPath);
  if (user) files.push({ kind: "user", path: userPath, content: user });

  return {
    files,
    soul,
    user,
  };
}

/**
 * 计算 profile 文件路径。
 *
 * @param options Agent/User 标识和项目根目录。
 * @returns soul.md 与 user.md 的绝对路径。
 */
export function getProfileFilePaths(options: {
  agentId?: string;
  userId?: string;
  rootDir?: string;
} = {}): ProfileFilePaths {
  const rootDir = options.rootDir ?? getProjectRoot();
  const agentId = safeProfileSegment(options.agentId ?? "default");
  const userId = safeProfileSegment(options.userId ?? "default");
  return {
    soulPath: resolve(rootDir, "agents", agentId, DEFAULT_SOUL_FILENAME),
    userPath: resolve(rootDir, "users", userId, DEFAULT_USER_FILENAME),
  };
}

/**
 * 对 `soul.md` / `user.md` 执行结构化 bullet 更新。
 *
 * 方法会按固定 section 插入或替换条目，不会重写整个 Markdown，
 * 因此用户手动补充的段落会尽量被保留。
 *
 * @param options Agent/User 标识、根目录和待更新的 soul/user bullet。
 * @returns 实际写入的更新列表；完全重复的 bullet 不会出现在结果中。
 */
export function applyProfileFileUpdates(options: ApplyProfileUpdatesOptions): AppliedProfileUpdate[] {
  // 只做结构化 bullet 更新，不重写整个 Markdown。
  // 这样用户手动写的段落、注释和额外 section 会被保留。
  const rootDir = options.rootDir ?? getProjectRoot();
  const agentId = safeProfileSegment(options.agentId ?? "default");
  const userId = safeProfileSegment(options.userId ?? "default");
  const { soulPath, userPath } = getProfileFilePaths({ rootDir, agentId, userId });
  writeFileIfMissing(soulPath, buildDefaultSoulTemplate(agentId));
  writeFileIfMissing(userPath, buildDefaultUserTemplate(userId));

  const applied: AppliedProfileUpdate[] = [];
  if (options.soulUpdates && options.soulUpdates.length > 0) {
    const result = applyMarkdownBulletUpdates(readFileSync(soulPath, "utf8"), options.soulUpdates);
    if (result.changed) writeFileSync(soulPath, result.content, "utf8");
    applied.push(...result.applied.map((update) => ({ kind: "soul" as const, ...update })));
  }

  if (options.userUpdates && options.userUpdates.length > 0) {
    const result = applyMarkdownBulletUpdates(readFileSync(userPath, "utf8"), options.userUpdates);
    if (result.changed) writeFileSync(userPath, result.content, "utf8");
    applied.push(...result.applied.map((update) => ({ kind: "user" as const, ...update })));
  }

  return applied;
}

function writeFileIfMissing(path: string, content: string): void {
  if (existsSync(path)) return;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function readProfileFile(path: string): string | null {
  if (!existsSync(path)) return null;
  const content = readFileSync(path, "utf8").trim();
  if (!content) return null;
  return content.length > MAX_PROFILE_FILE_CHARS
    ? `${content.slice(0, MAX_PROFILE_FILE_CHARS)}\n\n[profile truncated]`
    : content;
}

function safeProfileSegment(value: string): string {
  // agentId/userId 会进入文件路径，必须清洗成安全路径片段，避免意外写到目录外。
  const normalized = value.trim().replace(/[^a-zA-Z0-9_-]/g, "-").replace(/-+/g, "-");
  return normalized.length > 0 ? normalized : "default";
}

function applyMarkdownBulletUpdates(
  content: string,
  updates: ProfileBulletUpdate[],
): { content: string; changed: boolean; applied: Array<{ section: string; bullet: string }> } {
  // 一个同步批次可能同时包含身份、偏好、协作方式等多个更新。
  // 每条更新独立 upsert，保证部分重复时不会产生重复 bullet。
  let nextContent = content;
  let changed = false;
  const applied: Array<{ section: string; bullet: string }> = [];

  for (const update of updates) {
    const bullet = normalizeBullet(update.bullet);
    const result = upsertBulletInSection(nextContent, {
      section: update.section,
      bullet,
      replaceMatching: update.replaceMatching ?? [],
    });
    nextContent = result.content;
    if (result.changed) {
      changed = true;
      applied.push({ section: update.section, bullet });
    }
  }

  return {
    content: `${nextContent.trimEnd()}\n`,
    changed,
    applied,
  };
}

function upsertBulletInSection(
  content: string,
  update: { section: string; bullet: string; replaceMatching: RegExp[] },
): { content: string; changed: boolean } {
  // upsert 表示“有则更新，无则插入”。
  // replaceMatching 用于冲突事实，例如用户改名或偏好变化时替换旧结论。
  const lines = content.split(/\r?\n/);
  const sectionStart = lines.findIndex((line) => line.trim() === `## ${update.section}`);
  if (sectionStart === -1) {
    const prefix = lines.length > 0 && lines.at(-1)?.trim() !== "" ? [""] : [];
    lines.push(...prefix, `## ${update.section}`, "", update.bullet);
    return { content: lines.join("\n"), changed: true };
  }

  let sectionEnd = lines.length;
  for (let index = sectionStart + 1; index < lines.length; index += 1) {
    if (/^##\s+/.test(lines[index])) {
      sectionEnd = index;
      break;
    }
  }

  const bulletExists = lines
    .slice(sectionStart + 1, sectionEnd)
    .some((line) => normalizeComparableBullet(line) === normalizeComparableBullet(update.bullet));
  if (bulletExists) return { content, changed: false };

  // 同一 section 里命中 replaceMatching 的旧条目会被替换，
  // 其余手写 bullet 不动，避免自动同步覆盖用户自己整理的内容。
  const matchingLineIndexes: number[] = [];
  for (let index = sectionStart + 1; index < sectionEnd; index += 1) {
    const line = lines[index];
    if (!line.trim().startsWith("- ")) continue;
    if (update.replaceMatching.some((pattern) => pattern.test(line))) {
      matchingLineIndexes.push(index);
    }
  }

  if (matchingLineIndexes.length > 0) {
    lines[matchingLineIndexes[0]] = update.bullet;
    for (let i = matchingLineIndexes.length - 1; i > 0; i -= 1) {
      lines.splice(matchingLineIndexes[i], 1);
    }
    return { content: lines.join("\n"), changed: true };
  }

  const insertAt = findSectionInsertIndex(lines, sectionStart, sectionEnd);
  lines.splice(insertAt, 0, update.bullet);
  return { content: lines.join("\n"), changed: true };
}

function findSectionInsertIndex(lines: string[], sectionStart: number, sectionEnd: number): number {
  for (let index = sectionEnd - 1; index > sectionStart; index -= 1) {
    if (lines[index].trim().startsWith("- ")) return index + 1;
  }

  if (lines[sectionStart + 1]?.trim() === "") return sectionStart + 2;
  return sectionStart + 1;
}

function normalizeBullet(bullet: string): string {
  const normalized = bullet.trim().replace(/\s+/g, " ");
  return normalized.startsWith("- ") ? normalized : `- ${normalized}`;
}

function normalizeComparableBullet(bullet: string): string {
  return normalizeBullet(bullet)
    .replace(/[。；;,.，\s]+$/g, "")
    .toLowerCase();
}

function buildDefaultSoulTemplate(agentId: string): string {
  return `# soul.md - Agent Soul

## Identity

你是 my-agent 项目里的 \`${agentId}\` Agent。你的目标是成为一个能长期协作、会使用工具、会主动回忆上下文的个人 Agent。

## Voice

- 默认使用中文。
- 直接、务实、少客套。
- 用到专业术语时，要用一句话解释它的具体含义。
- 不要用“好问题”“当然可以”这类空泛开场。

## Boundaries

- 不编造记忆、经历、文件内容或工具结果。
- 不确定时先查工具；查不到就明确说没有足够证据。
- 对外部发送、删除、覆盖等高影响动作要谨慎。

## Relationship With Memory

- 本文件定义人格、语气和边界，不保存事件事实。
- 长期事实、经历、计划、流程和复盘都必须通过记忆工具回忆。
- 如果用户明确要求改变你的长期风格，可以建议更新本文件。
`;
}

function buildDefaultUserTemplate(userId: string): string {
  return `# user.md - User Profile

## Identity

- user_id: ${userId}
- preferred_language: 中文
- timezone: Asia/Shanghai

## Stable Preferences

- 使用专业术语时，需要具体解释一下。
- 偏好浅色、舒服、密度适中的 Web UI。

## Current Context

- 用户正在开发 my-agent 项目。
- 用户希望 Agent 的长期记忆更接近人类记忆，并淡化会话边界。

## Relationship With Memory

- 本文件只保存稳定用户画像，不保存每次对话的完整历史。
- 新事实、偏好变化、项目经历和未来计划仍应通过记忆工具查询和整理。
- 如果本文件和记忆工具结果冲突，优先说明冲突并根据最新证据处理。
`;
}
