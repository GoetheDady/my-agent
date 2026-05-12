import { tool } from "ai";
import { z } from "zod";
import { AgentConfigService, defaultAgentConfigService } from "./config-service";
import type { AgentConfigContext, AgentConfigPatch } from "./config-types";

export interface AgentConfigToolContext extends AgentConfigContext {
  agentConfigService?: AgentConfigService;
}

function getService(context: AgentConfigToolContext): AgentConfigService {
  return context.agentConfigService ?? defaultAgentConfigService;
}

const agentConfigGetSchema = z.object({
  agentId: z.string().optional(),
});

const agentConfigPatchSchema = z.object({
  agentId: z.string().optional(),
  patch: z.object({
    name: z.string().optional(),
    description: z.string().optional(),
    model: z.object({
      provider: z.string().optional(),
      model: z.string().optional(),
    }).optional(),
    tools: z.object({
      enabledToolsets: z.array(z.string()).optional(),
      requiresApproval: z.array(z.string()).optional(),
      allowedPaths: z.array(z.string()).optional(),
      addEnabledToolsets: z.array(z.string()).optional(),
      removeEnabledToolsets: z.array(z.string()).optional(),
      addRequiresApproval: z.array(z.string()).optional(),
      removeRequiresApproval: z.array(z.string()).optional(),
      addAllowedPaths: z.array(z.string()).optional(),
      removeAllowedPaths: z.array(z.string()).optional(),
    }).optional(),
    memory: z.object({
      enabled: z.boolean().optional(),
      autoExtract: z.boolean().optional(),
      dreamEnabled: z.boolean().optional(),
    }).optional(),
    skills: z.object({
      enabled: z.boolean().optional(),
      indexEnabled: z.boolean().optional(),
      enableSkillIds: z.array(z.string()).optional(),
      disableSkillIds: z.array(z.string()).optional(),
      removeSkillIds: z.array(z.string()).optional(),
      items: z.record(z.string(), z.object({
        name: z.string().optional(),
        description: z.string().optional(),
        category: z.string().optional(),
        allowedTools: z.array(z.string()).optional(),
        addAllowedTools: z.array(z.string()).optional(),
        removeAllowedTools: z.array(z.string()).optional(),
        source: z.string().optional(),
        status: z.enum(["enabled", "disabled"]).optional(),
        createdAt: z.number().optional(),
        updatedAt: z.number().optional(),
      }).nullable()).optional(),
    }).optional(),
  }),
});

const agentConfigResetSchema = z.object({
  agentId: z.string().optional(),
});

export function createAgentConfigTools(context: AgentConfigToolContext = {}) {
  const service = getService(context);
  const baseContext: AgentConfigContext = {
    agentId: context.agentId ?? "default",
    taskId: context.taskId ?? null,
    conversationId: context.conversationId ?? null,
    database: context.database,
  };

  return {
    agent_config_get: tool({
      description: "读取当前 Agent 的配置，包括模型、工具策略、记忆策略和 skill 元数据。",
      inputSchema: agentConfigGetSchema,
      execute: async (input: z.infer<typeof agentConfigGetSchema>) => {
        const agentId = input.agentId ?? baseContext.agentId ?? "default";
        return { success: true, config: service.getAgentConfig(agentId, { ...baseContext, agentId }) };
      },
    }),
    agent_config_patch: tool({
      description: [
        "局部更新当前 Agent 的配置。只能修改允许的配置字段，不能直接写 agent.json 文件。",
        "数组字段支持精细操作：tools.addEnabledToolsets/removeEnabledToolsets、tools.addRequiresApproval/removeRequiresApproval、tools.addAllowedPaths/removeAllowedPaths。",
        "skill 支持 skills.enableSkillIds/disableSkillIds/removeSkillIds，以及 skills.items[skillId].addAllowedTools/removeAllowedTools。",
      ].join(" "),
      inputSchema: agentConfigPatchSchema,
      execute: async (input: z.infer<typeof agentConfigPatchSchema>) => {
        const agentId = input.agentId ?? baseContext.agentId ?? "default";
        const config = service.patchAgentConfig(agentId, input.patch as AgentConfigPatch, { ...baseContext, agentId });
        return { success: true, config };
      },
    }),
    agent_config_reset: tool({
      description: "把当前 Agent 配置重置为默认值。高影响操作，通常需要用户确认。",
      inputSchema: agentConfigResetSchema,
      execute: async (input: z.infer<typeof agentConfigResetSchema>) => {
        const agentId = input.agentId ?? baseContext.agentId ?? "default";
        return { success: true, ...service.resetAgentConfig(agentId, { ...baseContext, agentId }) };
      },
    }),
  };
}
