import { listToolsForAgent, type RegisteredTool } from "./registry";

export interface ToolsetDefinition {
  name: string;
  description: string;
  tools: string[];
}

export const TOOLSETS: ToolsetDefinition[] = [
  {
    name: "memory",
    description: "长期记忆召回、写入、计划和证据查询工具。",
    tools: [
      "memory_search",
      "memory_get",
      "memory_update",
      "memory_forget",
      "memory_recall",
      "memory_evidence",
      "memory_remember",
      "memory_plan",
      "memory_reflect",
    ],
  },
  {
    name: "file",
    description: "项目内文件读取和写入工具。",
    tools: ["read_file", "write_file"],
  },
  {
    name: "runtime",
    description: "运行时任务、事件和状态工具预留分组。",
    tools: [],
  },
  {
    name: "core",
    description: "基础能力工具预留分组。",
    tools: [],
  },
  {
    name: "skill",
    description: "Agent 本地 skill 索引、读取、创建和启停工具。",
    tools: [
      "skill_list",
      "skill_view",
      "skill_create",
      "skill_enable",
      "skill_disable",
    ],
  },
  {
    name: "agent_config",
    description: "Agent 列表、创建、配置读取、局部更新和重置工具。",
    tools: [
      "agent_list",
      "agent_get",
      "agent_create",
      "agent_config_get",
      "agent_config_patch",
      "agent_config_reset",
    ],
  },
];

/**
 * 列出工具分组。
 *
 * Toolset 只描述 Agent 工具外壳如何分组，不承载 MemoryService 等业务规则。
 *
 * @param agentId Agent 标识。
 * @returns 带当前可用工具元数据的工具分组。
 */
export function listToolsetsForAgent(agentId: string): Array<ToolsetDefinition & { registeredTools: RegisteredTool[] }> {
  const availableTools = new Map(listToolsForAgent(agentId).map((registeredTool) => [registeredTool.name, registeredTool]));

  return TOOLSETS.map((toolset) => ({
    ...toolset,
    registeredTools: toolset.tools
      .map((toolName) => availableTools.get(toolName))
      .filter((registeredTool): registeredTool is RegisteredTool => Boolean(registeredTool)),
  }));
}
