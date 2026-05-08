import type { Tool } from "ai";

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

export function registerTool(registeredTool: RegisteredTool): void {
  registry.set(registeredTool.name, {
    ...registeredTool,
    defaultEnabled: registeredTool.defaultEnabled ?? true,
    disabledForAgents: registeredTool.disabledForAgents ?? [],
  });
}

export function getTool(name: string): RegisteredTool | null {
  return registry.get(name) ?? null;
}

export function listToolsForAgent(agentId: string): RegisteredTool[] {
  return Array.from(registry.values())
    .filter((registeredTool) => registeredTool.defaultEnabled !== false)
    .filter((registeredTool) => !registeredTool.disabledForAgents?.includes(agentId))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function buildAiToolSet(agentId: string): Record<string, Tool> {
  return Object.fromEntries(
    listToolsForAgent(agentId).map((registeredTool) => [registeredTool.name, registeredTool.tool]),
  );
}
