import type { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { getRuntimeDataDir } from "../core/config";
import { appendEvent } from "../events/event-log";
import type {
  SkillCreateInput,
  SkillListResult,
  SkillRecord,
  SkillRegistryEntry,
  SkillRegistryFile,
  SkillServiceContext,
  SkillStatus,
  SkillStatusUpdateResult,
  SkillViewResult,
} from "./skill-types";

const DEFAULT_AGENT_ID = "default";
const DEFAULT_SKILLS_DIR_NAME = "skills";
const REGISTRY_FILENAME = "skills.json";
const SKILL_MARKDOWN_FILENAME = "SKILL.md";

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

function jsonValue(value: string): string {
  return JSON.stringify(value);
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter((item) => item.length > 0);
}

function createDefaultRegistry(agentId: string): SkillRegistryFile {
  return {
    version: 1,
    agentId,
    skills: {},
  };
}

function parseRegistryContent(content: string, agentId: string): SkillRegistryFile {
  const parsed = JSON.parse(content) as Partial<SkillRegistryFile>;
  if (!parsed || parsed.version !== 1 || typeof parsed.skills !== "object" || parsed.skills === null) {
    throw new Error("Invalid skills registry");
  }
  const skills: Record<string, SkillRegistryEntry> = {};
  for (const [skillId, value] of Object.entries(parsed.skills)) {
    if (!value || typeof value !== "object") continue;
    const entry = value as Partial<SkillRegistryEntry>;
    const normalizedId = safeSkillSegment(skillId);
    skills[normalizedId] = {
      name: String(entry.name ?? normalizedId),
      description: String(entry.description ?? ""),
      category: String(entry.category ?? "general"),
      allowedTools: asStringArray(entry.allowedTools),
      source: String(entry.source ?? "agent-created"),
      status: entry.status === "disabled" ? "disabled" : "enabled",
      createdAt: Number(entry.createdAt ?? now()),
      updatedAt: Number(entry.updatedAt ?? now()),
    };
  }
  return {
    version: 1,
    agentId: String(parsed.agentId ?? agentId),
    skills,
  };
}

function buildFrontmatter(input: {
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

function buildSkillMarkdown(input: {
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

function registryPathFor(agentId: string, rootDir: string): string {
  return resolve(rootDir, "agents", agentId, DEFAULT_SKILLS_DIR_NAME, REGISTRY_FILENAME);
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

function loadRegistry(agentId: string, rootDir: string): SkillRegistryFile {
  const registryPath = registryPathFor(agentId, rootDir);
  if (!existsSync(registryPath)) {
    const registry = createDefaultRegistry(agentId);
    ensureDirectory(dirname(registryPath));
    writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
    return registry;
  }

  const content = readFileSync(registryPath, "utf8").trim();
  if (!content) {
    const registry = createDefaultRegistry(agentId);
    writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
    return registry;
  }

  return parseRegistryContent(content, agentId);
}

function saveRegistry(agentId: string, rootDir: string, registry: SkillRegistryFile): void {
  const registryPath = registryPathFor(agentId, rootDir);
  ensureDirectory(dirname(registryPath));
  writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
}

function toSkillRecord(agentId: string, rootDir: string, skillId: string, entry: SkillRegistryEntry): SkillRecord {
  const directory = skillDirectoryFor(agentId, skillId, rootDir);
  const filePath = skillFilePathFor(agentId, skillId, rootDir);
  return {
    id: skillId,
    agentId,
    directory,
    filePath,
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
  type: "skill.created" | "skill.updated" | "skill.enabled" | "skill.disabled" | "skill.viewed",
  payload: Record<string, unknown>,
): void {
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

  constructor(options: { rootDir?: string } = {}) {
    this.rootDir = options.rootDir ?? getRuntimeDataDir();
  }

  private getAgentId(input: SkillServiceContext = {}): string {
    return safeSkillSegment(input.agentId ?? DEFAULT_AGENT_ID);
  }

  private getRegistry(agentId: string): SkillRegistryFile {
    return loadRegistry(agentId, this.rootDir);
  }

  private saveRegistry(agentId: string, registry: SkillRegistryFile): void {
    saveRegistry(agentId, this.rootDir, registry);
  }

  private getEntry(agentId: string, skillId: string): SkillRecord | null {
    const registry = this.getRegistry(agentId);
    const entry = registry.skills[skillId];
    if (!entry) return null;
    return toSkillRecord(agentId, this.rootDir, skillId, entry);
  }

  private updateEntry(
    agentId: string,
    skillId: string,
    updater: (entry: SkillRegistryEntry | undefined) => SkillRegistryEntry,
  ): SkillRecord {
    const registry = this.getRegistry(agentId);
    const nextEntry = updater(registry.skills[skillId]);
    registry.skills[skillId] = nextEntry;
    this.saveRegistry(agentId, registry);
    return toSkillRecord(agentId, this.rootDir, skillId, nextEntry);
  }

  listSkills(agentIdOrContext: string | SkillServiceContext = DEFAULT_AGENT_ID, status: "enabled" | "disabled" | "all" = "all"): SkillListResult {
    const input = typeof agentIdOrContext === "string" ? { agentId: agentIdOrContext } : agentIdOrContext;
    const agentId = this.getAgentId(input);
    const registry = this.getRegistry(agentId);
    const records = Object.entries(registry.skills).map(([skillId, entry]) => toSkillRecord(agentId, this.rootDir, skillId, entry));
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
    const agentId = this.getAgentId(typeof agentIdOrContext === "string" ? { agentId: agentIdOrContext } : agentIdOrContext);
    return formatSkillIndex(this.listEnabledSkills(agentId).sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name)));
  }

  viewSkill(
    skillId: string,
    context: SkillServiceContext = {},
    options: { filePath?: string; allowDisabled?: boolean } = {},
  ): SkillViewResult {
    const agentId = this.getAgentId(context);
    const normalizedSkillId = safeSkillSegment(skillId);
    const skill = this.getEntry(agentId, normalizedSkillId);
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
    emitSkillEvent(context.database, { ...context, agentId }, "skill.viewed", {
      skillId: skill.id,
      skillName: skill.name,
      filePath: targetFilePath,
      status: skill.status,
    });

    return { agentId, skill, content, filePath: targetFilePath };
  }

  createSkill(input: SkillCreateInput, context: SkillServiceContext = {}): SkillRecord {
    const agentId = this.getAgentId(context);
    const skillId = safeSkillSegment(input.skillId);
    const nowTs = now();
    const existing = this.getEntry(agentId, skillId);
    const registry = this.getRegistry(agentId);
    const status: SkillStatus = input.status ?? existing?.status ?? "enabled";
    const record: SkillRegistryEntry = {
      name: input.name.trim(),
      description: input.description.trim(),
      category: (input.category ?? existing?.category ?? "general").trim() || "general",
      allowedTools: (input.allowedTools ?? existing?.allowedTools ?? []).map((toolName) => toolName.trim()).filter(Boolean),
      source: input.source ?? existing?.source ?? "agent-created",
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

    registry.skills[skillId] = record;
    saveRegistry(agentId, this.rootDir, registry);

    emitSkillEvent(context.database, { ...context, agentId }, existing ? "skill.updated" : "skill.created", {
      skillId,
      name: record.name,
      status: record.status,
      category: record.category,
      allowedTools: record.allowedTools,
      source: record.source,
    });

    return toSkillRecord(agentId, this.rootDir, skillId, record);
  }

  enableSkill(skillId: string, context: SkillServiceContext = {}): SkillStatusUpdateResult {
    const agentId = this.getAgentId(context);
    const normalizedSkillId = safeSkillSegment(skillId);
    const record = this.getEntry(agentId, normalizedSkillId);
    if (!record) {
      return { agentId, skill: null, changed: false };
    }
    const next = this.updateEntry(agentId, normalizedSkillId, (entry) => ({
      name: entry?.name ?? record.name,
      description: entry?.description ?? record.description,
      category: entry?.category ?? record.category,
      allowedTools: entry?.allowedTools ?? record.allowedTools,
      source: entry?.source ?? record.source,
      status: "enabled",
      createdAt: entry?.createdAt ?? record.createdAt,
      updatedAt: now(),
    }));
    emitSkillEvent(context.database, { ...context, agentId }, "skill.enabled", {
      skillId: normalizedSkillId,
      name: next.name,
      category: next.category,
    });
    return { agentId, skill: next, changed: true };
  }

  disableSkill(skillId: string, context: SkillServiceContext = {}): SkillStatusUpdateResult {
    const agentId = this.getAgentId(context);
    const normalizedSkillId = safeSkillSegment(skillId);
    const record = this.getEntry(agentId, normalizedSkillId);
    if (!record) {
      return { agentId, skill: null, changed: false };
    }
    const next = this.updateEntry(agentId, normalizedSkillId, (entry) => ({
      name: entry?.name ?? record.name,
      description: entry?.description ?? record.description,
      category: entry?.category ?? record.category,
      allowedTools: entry?.allowedTools ?? record.allowedTools,
      source: entry?.source ?? record.source,
      status: "disabled",
      createdAt: entry?.createdAt ?? record.createdAt,
      updatedAt: now(),
    }));
    emitSkillEvent(context.database, { ...context, agentId }, "skill.disabled", {
      skillId: normalizedSkillId,
      name: next.name,
      category: next.category,
    });
    return { agentId, skill: next, changed: true };
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

export const defaultSkillService = new SkillService();

export function buildSkillIndex(agentId: string, database?: Database): string {
  void database;
  return new SkillService().buildSkillIndex(agentId);
}
