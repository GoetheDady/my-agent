import { tool } from "ai";
import { z } from "zod";
import { SkillService, defaultSkillService } from "./service";
import type { SkillServiceContext } from "./skill-types";

export interface SkillToolContext extends SkillServiceContext {
  skillService?: SkillService;
}

function getService(context: SkillToolContext): SkillService {
  return context.skillService ?? defaultSkillService;
}

const skillListSchema = z.object({
  includeDisabled: z.boolean().optional(),
});

const skillViewSchema = z.object({
  skillId: z.string().min(1),
  filePath: z.string().optional(),
});

const skillCreateSchema = z.object({
  skillId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  content: z.string().min(1),
  category: z.string().optional(),
  allowedTools: z.array(z.string()).optional(),
});

const skillToggleSchema = z.object({
  skillId: z.string().min(1),
});

export function createSkillTools(context: SkillToolContext = {}) {
  const service = getService(context);
  const agentContext: SkillServiceContext = {
    agentId: context.agentId ?? "default",
    taskId: context.taskId ?? null,
    conversationId: context.conversationId ?? null,
    database: context.database,
  };

  return {
    skill_list: tool({
      description: "列出当前 Agent 的 skill。默认只看已启用内容，适合先看能力目录再决定是否加载全文。",
      inputSchema: skillListSchema,
      execute: async (input: z.infer<typeof skillListSchema>) => {
        return service.listSkills(agentContext, input.includeDisabled ? "all" : "enabled");
      },
    }),
    skill_view: tool({
      description: "读取当前 Agent 的 skill 全文。仅允许读取当前 Agent 且已启用的 skill。",
      inputSchema: skillViewSchema,
      execute: async (input: z.infer<typeof skillViewSchema>) => {
        const result = service.viewSkill(input.skillId, agentContext, { filePath: input.filePath });
        return result.error
          ? { ...result, success: false }
          : { ...result, success: true };
      },
    }),
    skill_create: tool({
      description: "创建当前 Agent 的 skill。默认启用，写入后可直接用于任务执行。",
      inputSchema: skillCreateSchema,
      execute: async (input: z.infer<typeof skillCreateSchema>) => {
        const skill = service.createSkill({
          skillId: input.skillId,
          name: input.name,
          description: input.description,
          content: input.content,
          category: input.category,
          allowedTools: input.allowedTools,
          status: "enabled",
        }, agentContext);
        return { success: true, skill };
      },
    }),
    skill_enable: tool({
      description: "启用当前 Agent 的 skill。",
      inputSchema: skillToggleSchema,
      execute: async (input: z.infer<typeof skillToggleSchema>) => {
        const result = service.enableSkill(input.skillId, agentContext);
        return result.skill
          ? { success: true, ...result }
          : { success: false, ...result, error: "skill_not_found" };
      },
    }),
    skill_disable: tool({
      description: "停用当前 Agent 的 skill。",
      inputSchema: skillToggleSchema,
      execute: async (input: z.infer<typeof skillToggleSchema>) => {
        const result = service.disableSkill(input.skillId, agentContext);
        return result.skill
          ? { success: true, ...result }
          : { success: false, ...result, error: "skill_not_found" };
      },
    }),
  };
}
