import type { Database } from "bun:sqlite";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { AgentConfigService, defaultAgentConfigService } from "../agents/config-service";
import { getRuntimeDataDir } from "../core/config";
import { appendEvent } from "../events/event-log";
import type {
  SkillCreateInput,
  SkillInstallInput,
  SkillInstallResult,
  SkillListResult,
  SkillRecord,
  SkillMetadata,
  SkillOrigin,
  SkillServiceContext,
  SkillStatus,
  SkillStatusUpdateResult,
  SkillViewResult,
} from "./skill-types";
import { parseSkillMarkdown, buildSkillMarkdown } from "./skill-markdown";
import type { ParsedSkillMarkdown } from "./skill-markdown";
import { assertGithubUrl, computeDirectoryHash, copyDirectoryExcludingGit, defaultRemoteSkillFetcher, replaceDirectoryAtomically } from "./skill-fs";
import type { RemoteSkillFetchResult, RemoteSkillFetcher } from "./skill-fs";
export type { RemoteSkillFetchInput, RemoteSkillFetchResult, RemoteSkillFetcher } from "./skill-fs";

const DEFAULT_AGENT_ID = "default";
const DEFAULT_SKILLS_DIR_NAME = "skills";
const SKILL_MARKDOWN_FILENAME = "SKILL.md";
const DEFAULT_BUILTIN_SKILLS_DIR = resolve(process.cwd(), "skills", "builtin");
const DEFAULT_REMOTE_BRANCH = "main";

function now(): number {
  return Date.now();
}

function safeSkillSegment(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "");
  return normalized.length > 0 ? normalized : "skill";
}

function skillDirectoryFor(agentId: string, skillId: string, rootDir: string): string {
  return resolve(rootDir, "agents", agentId, DEFAULT_SKILLS_DIR_NAME, skillId);
}

function skillFilePathFor(agentId: string, skillId: string, rootDir: string): string {
  return resolve(skillDirectoryFor(agentId, skillId, rootDir), SKILL_MARKDOWN_FILENAME);
}

function ensureDirectory(path: string): void {
  mkdirSync(path, { recursive: true });
}

function toSkillRecord(agentId: string, rootDir: string, skillId: string, entry: SkillMetadata): SkillRecord {
  const directory = skillDirectoryFor(agentId, skillId, rootDir);
  const filePath = skillFilePathFor(agentId, skillId, rootDir);
  return {
    id: skillId,
    agentId,
    directory,
    filePath,
    readonly: entry.origin.type === "builtin",
    ...entry,
  };
}

function formatSkillIndex(skills: SkillRecord[]): string {
  if (skills.length === 0) {
    return "";
  }

  const lines = [
    "## Skills",
    "下面是当前 Agent 已启用的能力目录。先看索引，需要时再调用 `skill_view(skillId)` 读取完整说明。",
    "",
  ];

  for (const skill of skills) {
    const toolText = skill.allowedTools.length > 0
      ? `；tools: ${skill.allowedTools.join(", ")}`
      : "";
    lines.push(`- ${skill.id}: ${skill.name} — ${skill.description}（${skill.category}${toolText}）`);
  }

  lines.push("", "如果某个 skill 与当前任务相关，请先加载它，再继续执行。");
  return lines.join("\n");
}

function emitSkillEvent(
  database: Database | undefined,
  input: SkillServiceContext,
  type:
    | "skill.created"
    | "skill.updated"
    | "skill.enabled"
    | "skill.disabled"
    | "skill.viewed"
    | "skill.installed"
    | "skill.install.failed"
    | "skill.remote_updated"
    | "skill.remote_update.skipped"
    | "skill.remote_update.failed"
    | "skill.content.changed"
    | "skill.builtin.viewed",
  payload: Record<string, unknown>,
): void {
  if (!database) return;
  appendEvent({
    agent_id: input.agentId ?? DEFAULT_AGENT_ID,
    task_id: input.taskId ?? null,
    conversation_id: input.conversationId ?? null,
    type,
    payload,
  }, database);
}

export class SkillService {
  private readonly rootDir: string;
  private readonly builtinRootDir: string;
  private readonly agentConfigService: AgentConfigService;
  private readonly remoteSkillFetcher: RemoteSkillFetcher;

  constructor(options: {
    rootDir?: string;
    builtinRootDir?: string;
    agentConfigService?: AgentConfigService;
    remoteSkillFetcher?: RemoteSkillFetcher;
  } = {}) {
    this.rootDir = options.rootDir ?? getRuntimeDataDir();
    this.builtinRootDir = options.builtinRootDir ?? DEFAULT_BUILTIN_SKILLS_DIR;
    this.agentConfigService = options.agentConfigService ?? new AgentConfigService({ rootDir: this.rootDir });
    this.remoteSkillFetcher = options.remoteSkillFetcher ?? defaultRemoteSkillFetcher;
  }

  private getAgentId(input: SkillServiceContext = {}): string {
    return safeSkillSegment(input.agentId ?? DEFAULT_AGENT_ID);
  }

  private getSkillItems(agentId: string, context: SkillServiceContext = {}): Record<string, SkillMetadata> {
    return this.agentConfigService.getAgentConfig(agentId, context).skills.items;
  }

  private getPrivateEntry(agentId: string, skillId: string, context: SkillServiceContext = {}): SkillRecord | null {
    const entry = this.getSkillItems(agentId, context)[skillId];
    if (!entry) return null;
    return toSkillRecord(agentId, this.rootDir, skillId, entry);
  }

  private getBuiltinEntry(agentId: string, skillId: string, context: SkillServiceContext = {}): SkillRecord | null {
    const builtins = this.listBuiltinSkills(agentId, context);
    return builtins.find((skill) => skill.id === skillId) ?? null;
  }

  private getEntry(agentId: string, skillId: string, context: SkillServiceContext = {}): SkillRecord | null {
    return this.getBuiltinEntry(agentId, skillId, context) ?? this.getPrivateEntry(agentId, skillId, context);
  }

  private hasBuiltinSkill(skillId: string): boolean {
    return this.scanBuiltinSkills().some((skill) => skill.id === safeSkillSegment(skillId));
  }

  private scanBuiltinSkills(): SkillRecord[] {
    if (!existsSync(this.builtinRootDir)) return [];
    return readdirSync(this.builtinRootDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => this.readBuiltinSkill(entry.name))
      .filter((skill): skill is SkillRecord => Boolean(skill));
  }

  private readBuiltinSkill(directoryName: string): SkillRecord | null {
    const directory = resolve(this.builtinRootDir, directoryName);
    const filePath = resolve(directory, SKILL_MARKDOWN_FILENAME);
    if (!existsSync(filePath)) return null;
    const content = readFileSync(filePath, "utf8");
    const parsed = parseSkillMarkdown(content);
    const skillId = safeSkillSegment(parsed.id ?? directoryName);
    const createdAt = now();
    const metadata: SkillMetadata = {
      name: parsed.name ?? skillId,
      description: parsed.description ?? "",
      category: parsed.category ?? "builtin",
      allowedTools: parsed.allowedTools,
      source: "builtin",
      origin: {
        type: "builtin",
        source: "builtin",
        builtinPath: filePath,
      },
      status: parsed.defaultStatus ?? "enabled",
      createdAt,
      updatedAt: createdAt,
    };
    return {
      id: skillId,
      agentId: "*",
      directory,
      filePath,
      readonly: true,
      ...metadata,
    };
  }

  private listBuiltinSkills(agentId: string, context: SkillServiceContext = {}): SkillRecord[] {
    const config = this.agentConfigService.getAgentConfig(agentId, context);
    return this.scanBuiltinSkills().map((skill) => ({
      ...skill,
      agentId,
      status: config.skills.builtinOverrides[skill.id]?.status ?? skill.status,
    }));
  }

  listSkills(agentIdOrContext: string | SkillServiceContext = DEFAULT_AGENT_ID, status: "enabled" | "disabled" | "all" = "all"): SkillListResult {
    const input = typeof agentIdOrContext === "string" ? { agentId: agentIdOrContext } : agentIdOrContext;
    const agentId = this.getAgentId(input);
    const config = this.agentConfigService.getAgentConfig(agentId, input);
    const builtinSkills = this.listBuiltinSkills(agentId, input);
    const builtinIds = new Set(builtinSkills.map((skill) => skill.id));
    const privateSkills = Object.entries(config.skills.items)
      .filter(([skillId]) => !builtinIds.has(skillId))
      .map(([skillId, entry]) => toSkillRecord(agentId, this.rootDir, skillId, entry));
    const records = [...builtinSkills, ...privateSkills];
    const filtered = status === "all"
      ? records
      : records.filter((skill) => skill.status === status);
    filtered.sort((a, b) => {
      if (a.status !== b.status) return a.status === "enabled" ? -1 : 1;
      return a.category.localeCompare(b.category) || a.name.localeCompare(b.name);
    });
    return {
      agentId,
      skills: filtered,
      enabledCount: records.filter((skill) => skill.status === "enabled").length,
      disabledCount: records.filter((skill) => skill.status === "disabled").length,
    };
  }

  listEnabledSkills(agentIdOrContext: string | SkillServiceContext = DEFAULT_AGENT_ID): SkillRecord[] {
    return this.listSkills(agentIdOrContext, "enabled").skills;
  }

  buildSkillIndex(agentIdOrContext: string | SkillServiceContext = DEFAULT_AGENT_ID): string {
    const context = typeof agentIdOrContext === "string" ? { agentId: agentIdOrContext } : agentIdOrContext;
    return formatSkillIndex(
      this.listEnabledSkills(context).sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name)),
    );
  }

  viewSkill(
    skillId: string,
    context: SkillServiceContext = {},
    options: { filePath?: string; allowDisabled?: boolean } = {},
  ): SkillViewResult {
    const agentId = this.getAgentId(context);
    const normalizedSkillId = safeSkillSegment(skillId);
    const skill = this.getEntry(agentId, normalizedSkillId, context);
    if (!skill) {
      return { agentId, skill: null, content: null, filePath: null, error: "skill_not_found" };
    }

    if (!options.allowDisabled && skill.status !== "enabled") {
      return { agentId, skill: null, content: null, filePath: null, error: "skill_disabled" };
    }

    const skillDir = skill.directory;
    const targetFilePath = options.filePath
      ? this.resolveSkillFilePath(skillDir, options.filePath)
      : skill.filePath;

    if (!existsSync(targetFilePath)) {
      return { agentId, skill, content: null, filePath: targetFilePath, error: "file_not_found" };
    }

    const content = readFileSync(targetFilePath, "utf8");
    emitSkillEvent(context.database, { ...context, agentId }, skill.origin.type === "builtin" ? "skill.builtin.viewed" : "skill.viewed", {
      skillId: skill.id,
      skillName: skill.name,
      filePath: targetFilePath,
      status: skill.status,
      origin: skill.origin,
    });

    return { agentId, skill, content, filePath: targetFilePath };
  }

  createSkill(input: SkillCreateInput, context: SkillServiceContext = {}): SkillRecord {
    const agentId = this.getAgentId(context);
    const skillId = safeSkillSegment(input.skillId);
    if (this.hasBuiltinSkill(skillId)) {
      throw new Error("不能覆盖系统内置 skill。");
    }
    const nowTs = now();
    const existing = this.getPrivateEntry(agentId, skillId, context);
    const status: SkillStatus = input.status ?? existing?.status ?? "enabled";
    const record: SkillMetadata = {
      name: input.name.trim(),
      description: input.description.trim(),
      category: (input.category ?? existing?.category ?? "general").trim() || "general",
      allowedTools: (input.allowedTools ?? existing?.allowedTools ?? []).map((toolName) => toolName.trim()).filter(Boolean),
      source: "agent-created",
      origin: {
        type: "agent_created",
        source: "agent-created",
        createdAt: existing?.origin.type === "agent_created" ? existing.origin.createdAt : nowTs,
      },
      status,
      createdAt: existing?.createdAt ?? nowTs,
      updatedAt: nowTs,
    };

    const skillDir = skillDirectoryFor(agentId, skillId, this.rootDir);
    ensureDirectory(skillDir);
    const skillFilePath = skillFilePathFor(agentId, skillId, this.rootDir);
    const markdown = buildSkillMarkdown({
      id: skillId,
      name: record.name,
      description: record.description,
      category: record.category,
      allowedTools: record.allowedTools,
      source: record.source,
      content: input.content,
    });
    writeFileSync(skillFilePath, markdown, "utf8");

    this.agentConfigService.patchAgentConfig(agentId, {
      skills: {
        items: {
          [skillId]: record,
        },
      },
    }, context);

    emitSkillEvent(context.database, { ...context, agentId }, existing ? "skill.updated" : "skill.created", {
      skillId,
      name: record.name,
      status: record.status,
      category: record.category,
      allowedTools: record.allowedTools,
      source: record.source,
      origin: record.origin,
    });

    return toSkillRecord(agentId, this.rootDir, skillId, record);
  }

  enableSkill(skillId: string, context: SkillServiceContext = {}): SkillStatusUpdateResult {
    const agentId = this.getAgentId(context);
    const normalizedSkillId = safeSkillSegment(skillId);
    const record = this.getEntry(agentId, normalizedSkillId, context);
    if (!record) {
      return { agentId, skill: null, changed: false };
    }
    if (record.origin.type === "builtin") {
      this.agentConfigService.patchAgentConfig(agentId, {
        skills: {
          builtinOverrides: {
            [normalizedSkillId]: { status: "enabled" },
          },
        },
      }, context);
      const next = this.getBuiltinEntry(agentId, normalizedSkillId, context) ?? { ...record, status: "enabled" };
      emitSkillEvent(context.database, { ...context, agentId }, "skill.enabled", {
        skillId: normalizedSkillId,
        name: next.name,
        category: next.category,
        origin: next.origin,
      });
      return { agentId, skill: next, changed: record.status !== "enabled" };
    }
    this.agentConfigService.patchAgentConfig(agentId, {
      skills: {
        items: {
          [normalizedSkillId]: {
            ...record,
            status: "enabled",
            updatedAt: now(),
          },
        },
      },
    }, context);
    const next = this.getEntry(agentId, normalizedSkillId, context) ?? {
      ...record,
      status: "enabled",
      updatedAt: now(),
    };
    emitSkillEvent(context.database, { ...context, agentId }, "skill.enabled", {
      skillId: normalizedSkillId,
      name: next.name,
      category: next.category,
      origin: next.origin,
    });
    return { agentId, skill: next, changed: true };
  }

  disableSkill(skillId: string, context: SkillServiceContext = {}): SkillStatusUpdateResult {
    const agentId = this.getAgentId(context);
    const normalizedSkillId = safeSkillSegment(skillId);
    const record = this.getEntry(agentId, normalizedSkillId, context);
    if (!record) {
      return { agentId, skill: null, changed: false };
    }
    if (record.origin.type === "builtin") {
      this.agentConfigService.patchAgentConfig(agentId, {
        skills: {
          builtinOverrides: {
            [normalizedSkillId]: { status: "disabled" },
          },
        },
      }, context);
      const next = this.getBuiltinEntry(agentId, normalizedSkillId, context) ?? { ...record, status: "disabled" };
      emitSkillEvent(context.database, { ...context, agentId }, "skill.disabled", {
        skillId: normalizedSkillId,
        name: next.name,
        category: next.category,
        origin: next.origin,
      });
      return { agentId, skill: next, changed: record.status !== "disabled" };
    }
    this.agentConfigService.patchAgentConfig(agentId, {
      skills: {
        items: {
          [normalizedSkillId]: {
            ...record,
            status: "disabled",
            updatedAt: now(),
          },
        },
      },
    }, context);
    const next = this.getEntry(agentId, normalizedSkillId, context) ?? {
      ...record,
      status: "disabled",
      updatedAt: now(),
    };
    emitSkillEvent(context.database, { ...context, agentId }, "skill.disabled", {
      skillId: normalizedSkillId,
      name: next.name,
      category: next.category,
      origin: next.origin,
    });
    return { agentId, skill: next, changed: true };
  }

  async installSkill(input: SkillInstallInput, context: SkillServiceContext = {}): Promise<SkillInstallResult> {
    const agentId = this.getAgentId(context);
    const branch = input.branch?.trim() || DEFAULT_REMOTE_BRANCH;
    const subdir = input.subdir?.trim() ?? "";
    const repo = assertGithubUrl(input.url);
    let fetched: RemoteSkillFetchResult | null = null;
    try {
      fetched = await this.remoteSkillFetcher({ url: input.url, branch, subdir });
      const contentHash = fetched.contentHash ?? computeDirectoryHash(fetched.directory);
      const skillFile = resolve(fetched.directory, SKILL_MARKDOWN_FILENAME);
      if (!existsSync(skillFile)) throw new Error("远程目录中缺少 SKILL.md。");
      const content = readFileSync(skillFile, "utf8");
      const parsed = parseSkillMarkdown(content);
      const skillId = safeSkillSegment(input.skillId ?? parsed.id ?? basename(repo));
      if (this.hasBuiltinSkill(skillId)) throw new Error("不能覆盖系统内置 skill。");
      if (this.getPrivateEntry(agentId, skillId, context)) throw new Error("skill 已存在，不能重复安装。");

      const nowTs = now();
      const targetDir = skillDirectoryFor(agentId, skillId, this.rootDir);
      copyDirectoryExcludingGit(fetched.directory, targetDir);
      const origin: SkillOrigin = {
        type: "remote_installed",
        source: "github",
        provider: "github",
        url: input.url,
        repo,
        branch,
        subdir,
        commit: fetched.commit,
        contentHash,
        installedAt: nowTs,
        updatedAt: nowTs,
      };
      const record = this.buildRemoteSkillMetadata(skillId, parsed, origin, input.status ?? "disabled", nowTs, nowTs);
      this.agentConfigService.patchAgentConfig(agentId, {
        skills: {
          items: {
            [skillId]: record,
          },
        },
      }, context);
      const skill = toSkillRecord(agentId, this.rootDir, skillId, record);
      emitSkillEvent(context.database, { ...context, agentId }, "skill.installed", {
        skillId,
        name: skill.name,
        status: skill.status,
        origin,
      });
      return { skill, changed: true, previousCommit: null };
    } catch (error) {
      emitSkillEvent(context.database, { ...context, agentId }, "skill.install.failed", {
        url: input.url,
        branch,
        subdir,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      fetched?.cleanup();
    }
  }

  async updateSkill(skillId: string, context: SkillServiceContext = {}): Promise<SkillInstallResult> {
    const agentId = this.getAgentId(context);
    const normalizedSkillId = safeSkillSegment(skillId);
    const existing = this.getPrivateEntry(agentId, normalizedSkillId, context);
    if (!existing) throw new Error("skill 不存在。");
    if (existing.origin.type !== "remote_installed") {
      throw new Error("只有远程安装的 skill 可以更新。");
    }

    let fetched: RemoteSkillFetchResult | null = null;
    try {
      fetched = await this.remoteSkillFetcher({
        url: existing.origin.url,
        branch: existing.origin.branch,
        subdir: existing.origin.subdir,
      });
      const contentHash = fetched.contentHash ?? computeDirectoryHash(fetched.directory);
      if (fetched.commit === existing.origin.commit) {
        if (contentHash === existing.origin.contentHash) {
          emitSkillEvent(context.database, { ...context, agentId }, "skill.remote_update.skipped", {
            skillId: existing.id,
            commit: existing.origin.commit,
            contentHash: existing.origin.contentHash ?? null,
            origin: existing.origin,
          });
          return { skill: existing, changed: false, previousCommit: existing.origin.commit };
        }
      }

      const skillFile = resolve(fetched.directory, SKILL_MARKDOWN_FILENAME);
      if (!existsSync(skillFile)) throw new Error("远程目录中缺少 SKILL.md。");
      const parsed = parseSkillMarkdown(readFileSync(skillFile, "utf8"));
      const updatedAt = now();
      const origin: SkillOrigin = {
        ...existing.origin,
        commit: fetched.commit,
        contentHash,
        updatedAt,
      };
      const record = this.buildRemoteSkillMetadata(
        existing.id,
        parsed,
        origin,
        existing.status,
        existing.createdAt,
        updatedAt,
      );
      replaceDirectoryAtomically(fetched.directory, existing.directory);
      this.agentConfigService.patchAgentConfig(agentId, {
        skills: {
          items: {
            [existing.id]: record,
          },
        },
      }, context);
      const skill = toSkillRecord(agentId, this.rootDir, existing.id, record);
      emitSkillEvent(context.database, { ...context, agentId }, "skill.remote_updated", {
        skillId: skill.id,
        previousCommit: existing.origin.commit,
        commit: fetched.commit,
        origin,
      });
      if (contentHash !== existing.origin.contentHash) {
        emitSkillEvent(context.database, { ...context, agentId }, "skill.content.changed", {
          skillId: skill.id,
          previousContentHash: existing.origin.contentHash ?? null,
          contentHash,
          previousCommit: existing.origin.commit,
          commit: fetched.commit,
        });
      }
      return { skill, changed: true, previousCommit: existing.origin.commit };
    } catch (error) {
      emitSkillEvent(context.database, { ...context, agentId }, "skill.remote_update.failed", {
        skillId: normalizedSkillId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      fetched?.cleanup();
    }
  }

  private buildRemoteSkillMetadata(
    skillId: string,
    parsed: ParsedSkillMarkdown,
    origin: SkillOrigin,
    status: SkillStatus,
    createdAt: number,
    updatedAt: number,
  ): SkillMetadata {
    return {
      name: (parsed.name ?? skillId).trim(),
      description: (parsed.description ?? "").trim(),
      category: (parsed.category ?? "remote").trim() || "remote",
      allowedTools: parsed.allowedTools.map((toolName) => toolName.trim()).filter(Boolean),
      source: "remote-installed",
      origin,
      status,
      createdAt,
      updatedAt,
    };
  }

  private resolveSkillFilePath(skillDir: string, inputPath: string): string {
    const normalized = inputPath.trim() || SKILL_MARKDOWN_FILENAME;
    const resolved = resolve(skillDir, normalized);
    const relativePath = relative(skillDir, resolved);
    if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
      throw new Error("Unsafe skill file path");
    }
    return resolved;
  }
}

export const defaultSkillService = new SkillService({ agentConfigService: defaultAgentConfigService });

export function buildSkillIndex(agentId: string, database?: Database): string {
  void database;
  return new SkillService().buildSkillIndex(agentId);
}
