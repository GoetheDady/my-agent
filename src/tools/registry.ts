import type { Tool } from "ai";
import { defaultAgentConfigService } from "../agents/config-service";

export type ToolCategory = "read" | "write" | "memory_read" | "memory_write";

export interface RegisteredTool {
  name: string;
  tool: Tool;
  toolset: string;
  category: ToolCategory;
  defaultEnabled?: boolean;
  disabledForAgents?: string[];
  createsCandidateMemory?: boolean;
}

const registry = new Map<string, RegisteredTool>();

/**
 * 注册一个可供 Agent 调用的工具。
 *
 * @param registeredTool 工具实现及其权限分类、工具集、默认启用状态等元数据。
 */
export function registerTool(registeredTool: RegisteredTool): void {
  // 工具注册表是所有可调用工具的单一来源。
  // category 用于权限策略：读工具默认可用，写工具需要额外策略判断。
  registry.set(registeredTool.name, {
    ...registeredTool,
    defaultEnabled: registeredTool.defaultEnabled ?? true,
    disabledForAgents: registeredTool.disabledForAgents ?? [],
  });
}

/**
 * 按名称查找已注册工具。
 *
 * @param name 工具名。
 * @returns 找到时返回工具元数据，否则返回 `null`。
 */
export function getTool(name: string): RegisteredTool | null {
  return registry.get(name) ?? null;
}

/**
 * 列出某个 Agent 当前可用的工具。
 *
 * @param agentId Agent 标识。
 * @returns 已启用且未对该 Agent 禁用的工具列表。
 */
export function listToolsForAgent(agentId: string): RegisteredTool[] {
  // 这里按 agent 过滤工具，为后续多 Agent 预留不同工具权限。
  // 目前 default agent 使用大多数默认启用工具。
  const enabledToolsets = new Set(defaultAgentConfigService.getAgentConfig(agentId).tools.enabledToolsets);
  return Array.from(registry.values())
    .filter((registeredTool) => registeredTool.defaultEnabled !== false)
    .filter((registeredTool) => !registeredTool.disabledForAgents?.includes(agentId))
    .filter((registeredTool) => enabledToolsets.has(registeredTool.toolset))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * 构建 AI SDK 需要的工具集合。
 *
 * @param agentId Agent 标识。
 * @returns 以工具名为 key、AI SDK Tool 为 value 的对象。
 */
export function buildAiToolSet(agentId: string): Record<string, Tool> {
  // AI SDK 需要 Record<string, Tool> 形状；注册表保留的是带元数据的工具描述。
  // 这里负责把内部格式转换成模型调用时需要的格式。
  return Object.fromEntries(
    listToolsForAgent(agentId).map((registeredTool) => [registeredTool.name, registeredTool.tool]),
  );
}
