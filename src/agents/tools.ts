import { tool } from "ai";
import { z } from "zod";
import { defaultAgentService, type AgentService } from "./service";
import type { AgentServiceContext } from "./service";

export interface AgentToolContext extends AgentServiceContext {
  agentId?: string;
  agentService?: AgentService;
}

function getService(context: AgentToolContext): AgentService {
  return context.agentService ?? defaultAgentService;
}

const agentListSchema = z.object({});

const agentGetSchema = z.object({
  agentId: z.string().optional(),
});

const agentCreateSchema = z.object({
  agentId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  workspacePath: z.string().optional(),
  model: z.object({
    provider: z.string().optional(),
    model: z.string().optional(),
  }).optional(),
});

function summarizeAgent(result: ReturnType<AgentService["getAgent"]>) {
  if (!result) return null;
  return {
    ...result.agent,
    configSummary: {
      name: result.config.name,
      description: result.config.description,
      model: result.config.model,
      enabledToolsets: result.config.tools.enabledToolsets,
      enabledSkillCount: Object.values(result.config.skills.items)
        .filter((skill) => skill.status === "enabled").length,
      disabledSkillCount: Object.values(result.config.skills.items)
        .filter((skill) => skill.status === "disabled").length,
    },
  };
}

export function createAgentTools(context: AgentToolContext = {}) {
  const service = getService(context);
  const baseContext: AgentServiceContext = {
    database: context.database,
  };

  return {
    agent_list: tool({
      description: "列出系统中可用的 Agent，并返回每个 Agent 的配置摘要。",
      inputSchema: agentListSchema,
      execute: async () => {
        return {
          success: true,
          agents: service.listAgents(baseContext).map((agentWithConfig) => summarizeAgent(agentWithConfig)),
        };
      },
    }),
    agent_get: tool({
      description: "读取某个 Agent 的运行状态和配置摘要。不读取完整 agent.json 时优先用这个工具。",
      inputSchema: agentGetSchema,
      execute: async (input: z.infer<typeof agentGetSchema>) => {
        const agentId = input.agentId ?? context.agentId ?? "default";
        const agent = summarizeAgent(service.getAgent(agentId, baseContext));
        return agent
          ? { success: true, agent }
          : { success: false, error: "agent_not_found", agentId };
      },
    }),
    agent_create: tool({
      description: "创建新的 Agent，并初始化独立 agent.json、skill 目录和 soul.md。不会创建 delegation 关系。",
      inputSchema: agentCreateSchema,
      execute: async (input: z.infer<typeof agentCreateSchema>) => {
        try {
          const created = service.createAgent(input, baseContext);
          return { success: true, agent: summarizeAgent(created) };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : "agent_create_failed",
          };
        }
      },
    }),
  };
}
