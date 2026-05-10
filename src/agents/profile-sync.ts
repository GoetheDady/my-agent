import type { Database } from "bun:sqlite";
import {
  applyProfileFileUpdates,
  type AppliedProfileUpdate,
  type ProfileBulletUpdate,
} from "./profile-files";
import { appendEvent } from "../events/event-log";
import type { Memory } from "../memory/store";

export type ProfileSyncSource = "memory_worker" | "memory_tool" | "dream_worker";

export interface ProfileSyncInput {
  agentId?: string;
  userId?: string;
  taskId?: string | null;
  conversationId?: string | null;
  database?: Database;
  rootDir?: string;
  source: ProfileSyncSource;
  memories: Array<Pick<Memory, "id" | "content" | "memory_type" | "status" | "confidence">>;
  reason?: string;
  sourceEventIds?: string[];
}

export interface ProfileSyncResult {
  status: "completed" | "skipped" | "failed";
  applied: AppliedProfileUpdate[];
  skippedReason?: string;
  error?: string;
}

export type ProfileSyncPort = (input: ProfileSyncInput) => Promise<ProfileSyncResult>;

interface ClassifiedProfileUpdates {
  soulUpdates: ProfileBulletUpdate[];
  userUpdates: ProfileBulletUpdate[];
  skippedReason?: string;
}

export const noopProfileSync: ProfileSyncPort = async () => ({
  status: "skipped",
  applied: [],
  skippedReason: "profile sync disabled",
});

export async function syncProfileFromMemories(input: ProfileSyncInput): Promise<ProfileSyncResult> {
  const agentId = input.agentId ?? "default";
  const taskId = input.taskId ?? null;
  const conversationId = input.conversationId ?? null;

  appendEvent({
    agent_id: agentId,
    task_id: taskId,
    conversation_id: conversationId,
    type: "profile.sync.started",
    payload: {
      source: input.source,
      memoryIds: input.memories.map((memory) => memory.id),
    },
  }, input.database);

  try {
    const classified = classifyProfileUpdates(input.memories);
    if (classified.userUpdates.length === 0 && classified.soulUpdates.length === 0) {
      const skippedReason = classified.skippedReason ?? "没有适合沉淀到 user.md 或 soul.md 的稳定认知";
      appendEvent({
        agent_id: agentId,
        task_id: taskId,
        conversation_id: conversationId,
        type: "profile.sync.skipped",
        payload: {
          source: input.source,
          reason: skippedReason,
          memoryIds: input.memories.map((memory) => memory.id),
        },
      }, input.database);
      return { status: "skipped", applied: [], skippedReason };
    }

    const applied = applyProfileFileUpdates({
      agentId,
      userId: input.userId ?? "default",
      rootDir: input.rootDir,
      soulUpdates: classified.soulUpdates,
      userUpdates: classified.userUpdates,
    });

    if (applied.length === 0) {
      const skippedReason = "profile 文件已有等价内容，无需更新";
      appendEvent({
        agent_id: agentId,
        task_id: taskId,
        conversation_id: conversationId,
        type: "profile.sync.skipped",
        payload: {
          source: input.source,
          reason: skippedReason,
          memoryIds: input.memories.map((memory) => memory.id),
        },
      }, input.database);
      return { status: "skipped", applied: [], skippedReason };
    }

    appendEvent({
      agent_id: agentId,
      task_id: taskId,
      conversation_id: conversationId,
      type: "profile.sync.completed",
      payload: {
        source: input.source,
        memoryIds: input.memories.map((memory) => memory.id),
        updates: applied.map((update) => ({
          file: update.kind === "soul" ? "soul.md" : "user.md",
          section: update.section,
          bullet: update.bullet,
        })),
        reason: input.reason ?? "",
        sourceEventIds: input.sourceEventIds ?? [],
      },
    }, input.database);

    return { status: "completed", applied };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    appendEvent({
      agent_id: agentId,
      task_id: taskId,
      conversation_id: conversationId,
      type: "profile.sync.failed",
      payload: {
        source: input.source,
        memoryIds: input.memories.map((memory) => memory.id),
        error: message,
      },
    }, input.database);
    return { status: "failed", applied: [], error: message };
  }
}

export function classifyProfileUpdates(
  memories: Array<Pick<Memory, "content" | "memory_type" | "status" | "confidence">>,
): ClassifiedProfileUpdates {
  const userUpdates = new Map<string, ProfileBulletUpdate>();
  const soulUpdates = new Map<string, ProfileBulletUpdate>();

  for (const memory of memories) {
    if (memory.status && memory.status !== "active") continue;
    if (memory.confidence < 0.7) continue;
    const content = normalizeContent(memory.content);
    if (!content || isTransientContent(content)) continue;

    for (const update of classifyUserUpdates(content, memory.memory_type)) {
      userUpdates.set(`${update.section}:${update.bullet}`, update);
    }
    for (const update of classifySoulUpdates(content, memory.memory_type)) {
      soulUpdates.set(`${update.section}:${update.bullet}`, update);
    }
  }

  return {
    userUpdates: Array.from(userUpdates.values()),
    soulUpdates: Array.from(soulUpdates.values()),
    skippedReason: "没有匹配到稳定用户画像或 Agent 自我认知规则",
  };
}

function classifyUserUpdates(content: string, memoryType: string): ProfileBulletUpdate[] {
  const updates: ProfileBulletUpdate[] = [];
  const name = extractName(content);
  if (name) {
    updates.push({
      section: "Identity",
      bullet: `name: ${name}`,
      replaceMatching: [/^-\s*name\s*[:：]/, /^-\s*用户叫/, /^-\s*用户名/],
    });
    updates.push({
      section: "Identity",
      bullet: `what_to_call_them: ${name}`,
      replaceMatching: [/^-\s*what_to_call_them\s*[:：]/, /^-\s*称呼用户/],
    });
  }

  const language = extractLanguage(content);
  if (language) {
    updates.push({
      section: "Identity",
      bullet: `preferred_language: ${language}`,
      replaceMatching: [/^-\s*preferred_language\s*[:：]/, /^-\s*默认使用/],
    });
  }

  const timezone = extractTimezone(content);
  if (timezone) {
    updates.push({
      section: "Identity",
      bullet: `timezone: ${timezone}`,
      replaceMatching: [/^-\s*timezone\s*[:：]/],
    });
  }

  if (isUserPreference(content, memoryType)) {
    updates.push({
      section: "Stable Preferences",
      bullet: stripUserSubject(content),
      replaceMatching: buildPreferenceReplacementPatterns(content),
    });
  }

  if (isLongTermUserContext(content, memoryType)) {
    updates.push({
      section: "Current Context",
      bullet: stripUserSubject(content),
      replaceMatching: buildContextReplacementPatterns(content),
    });
  }

  return updates;
}

function classifySoulUpdates(content: string, memoryType: string): ProfileBulletUpdate[] {
  const updates: ProfileBulletUpdate[] = [];
  const voiceRule = isAgentVoiceRule(content);
  const boundaryRule = isAgentBoundaryRule(content);
  const memoryRule = isAgentMemoryRule(content);

  if (voiceRule) {
    updates.push({
      section: "Voice",
      bullet: stripAgentSubject(content),
      replaceMatching: buildSoulReplacementPatterns(content),
    });
  }

  if (boundaryRule) {
    updates.push({
      section: "Boundaries",
      bullet: stripAgentSubject(content),
      replaceMatching: buildSoulReplacementPatterns(content),
    });
  }

  if (memoryRule) {
    updates.push({
      section: "Relationship With Memory",
      bullet: stripAgentSubject(content),
      replaceMatching: buildSoulReplacementPatterns(content),
    });
  }

  if (!voiceRule && !boundaryRule && !memoryRule && isProceduralOrReflective(content, memoryType)) {
    updates.push({
      section: "Operating Principles",
      bullet: stripAgentSubject(content),
      replaceMatching: buildSoulReplacementPatterns(content),
    });
  }

  return updates;
}

function normalizeContent(content: string): string {
  return content
    .replace(/\r/g, "")
    .replace(/^请记住[:：]\s*/, "")
    .replace(/^记住[:：]\s*/, "")
    .trim();
}

function stripUserSubject(content: string): string {
  return content
    .replace(/^用户(明确)?(表示|说|希望|要求)?[:：]?\s*/, "")
    .replace(/^我(现在|长期|以后)?/, "")
    .trim()
    .replace(/^[，。,.\s]+/, "");
}

function stripAgentSubject(content: string): string {
  return content
    .replace(/^用户(明确)?(希望|要求|表示|说)[:：]?\s*/, "")
    .replace(/^(以后)?(你|Agent|助手|my-agent)\s*/, "")
    .trim()
    .replace(/^[要应该需需要，。,.\s]+/, "");
}

function extractName(content: string): string | null {
  const patterns = [
    /(?:用户|我)(?:的)?(?:名字|姓名|名称)?(?:叫|是)[:：]?\s*([\u4e00-\u9fffa-zA-Z0-9_-]{2,32})/,
    /(?:称呼|叫)(?:用户|我)(?:为|做)?[:：]?\s*([\u4e00-\u9fffa-zA-Z0-9_-]{2,32})/,
  ];
  for (const pattern of patterns) {
    const match = content.match(pattern);
    const value = match?.[1]?.trim();
    if (value && !/这个|那个|什么/.test(value)) return value;
  }
  return null;
}

function extractLanguage(content: string): string | null {
  if (/(默认|偏好|使用|回复).*(中文|汉语)/.test(content)) return "中文";
  if (/(默认|偏好|使用|回复).*(英文|英语|English)/i.test(content)) return "English";
  return null;
}

function extractTimezone(content: string): string | null {
  const match = content.match(/\b([A-Z][A-Za-z_]+\/[A-Z][A-Za-z_]+)\b/);
  if (match) return match[1];
  if (/北京时间|中国时区|Asia\/Shanghai/.test(content)) return "Asia/Shanghai";
  return null;
}

function isUserPreference(content: string, memoryType: string): boolean {
  if (memoryType === "preference" || memoryType === "social") return true;
  return /(用户|我).*(偏好|喜欢|不喜欢|习惯|希望.*协作|希望.*回复|风格|舒服|UI|界面|密度|浅色|深色)/.test(content)
    && !isAgentDirected(content);
}

function isLongTermUserContext(content: string, memoryType: string): boolean {
  if (memoryType === "project" || memoryType === "identity") return true;
  return /(用户|我).*(正在|长期|持续|目标|希望|计划).*(开发|项目|my-agent|Agent|系统|渠道|MVP|架构)/i.test(content)
    && !isAgentDirected(content);
}

function isAgentVoiceRule(content: string): boolean {
  return isAgentDirected(content)
    && /(回复|语气|说话|表达|专业术语|解释|简洁|直接|客套|中文|英文)/.test(content);
}

function isAgentBoundaryRule(content: string): boolean {
  return isAgentDirected(content)
    && /(不要|不能|必须|边界|谨慎|编造|确认|删除|覆盖|高影响|安全)/.test(content);
}

function isAgentMemoryRule(content: string): boolean {
  return isAgentDirected(content)
    && /(记忆|回忆|证据|查询|工具|user\.md|soul\.md|上下文)/i.test(content);
}

function isProceduralOrReflective(content: string, memoryType: string): boolean {
  if (memoryType === "procedural" || memoryType === "reflective" || memoryType === "lesson") return true;
  return /(以后|修改|处理|遇到|应该|需要|流程|验证|测试|复盘|风险|踩坑|教训)/.test(content)
    && /(Agent|助手|你|系统|记忆|项目|工具|文档|测试|验证)/i.test(content);
}

function isAgentDirected(content: string): boolean {
  return /(以后|长期)?(你|Agent|助手|my-agent).*(要|应该|需要|必须|不要|不能|回复|语气|记住|处理)/i.test(content)
    || /(用户|我).*(希望|要求).*(你|Agent|助手|my-agent)/i.test(content);
}

function isTransientContent(content: string): boolean {
  return /(刚才|今天|上午|下午|昨天|这次|本轮|临时|当前消息|工具输出|读取文件|写入文件)/.test(content)
    && !/(长期|以后|持续|稳定|偏好|喜欢|名字|称呼)/.test(content);
}

function buildPreferenceReplacementPatterns(content: string): RegExp[] {
  const patterns = [/偏好.*UI/, /UI.*偏好/, /专业术语.*解释/, /解释.*专业术语/];
  if (/浅色|深色|舒服|密度/.test(content)) patterns.push(/浅色|深色|舒服|密度/);
  if (/沟通|协作|回复|语气/.test(content)) patterns.push(/沟通|协作|回复|语气/);
  return patterns.map((pattern) => bulletPattern(pattern));
}

function buildContextReplacementPatterns(content: string): RegExp[] {
  const patterns = [/my-agent/, /正在开发/, /长期.*项目/, /项目.*长期/];
  if (/飞书|微信/.test(content)) patterns.push(/飞书|微信/);
  return patterns.map((pattern) => bulletPattern(pattern));
}

function buildSoulReplacementPatterns(content: string): RegExp[] {
  const patterns: RegExp[] = [];
  if (/专业术语|解释/.test(content)) patterns.push(/专业术语|解释/);
  if (/直接|简洁|客套|语气|回复/.test(content)) patterns.push(/直接|简洁|客套|语气|回复/);
  if (/编造|证据|不确定/.test(content)) patterns.push(/编造|证据|不确定/);
  if (/记忆|回忆|工具/.test(content)) patterns.push(/记忆|回忆|工具/);
  if (/计划文档|bun test|typecheck|lint|验证/.test(content)) patterns.push(/计划文档|bun test|typecheck|lint|验证/);
  if (/去重|偏好|事实/.test(content)) patterns.push(/去重|偏好|事实/);
  return (patterns.length > 0 ? patterns : [escapeAsRegExp(content.slice(0, 16))])
    .map((pattern) => bulletPattern(pattern));
}

function bulletPattern(pattern: RegExp): RegExp {
  return new RegExp(`^-\\s*.*(?:${pattern.source}).*$`, pattern.flags);
}

function escapeAsRegExp(value: string): RegExp {
  return new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
}
