import { tool } from 'ai';
import type { Tool } from 'ai';
import { z } from 'zod';
import { readFile, writeFile, searchFiles, isInputPathAllowlisted } from './executor';
import { defaultAgentConfigService } from '../agents/config-service';
import { createAgentConfigTools } from '../agents/config-tools';
import { createAgentTools } from '../agents/tools';
import { createMemoryTools, memoryTools, type MemoryToolContext } from '../memory/memory-tools';
import { createHumanMemoryTools } from '../memory/human-memory-tools';
import { createSkillTools } from '../skills';
import { evaluateToolPolicy } from './policy';
import { buildAiToolSet, registerTool } from './registry';

interface ToolRuntimeContext {
  /**
   * 本轮工具调用里通过审批临时放行的写入路径。
   *
   * 这是一次性上下文，不等同于 agent.json 里的长期 allowedPaths。
   */
  approvedWritePaths?: string[];
}

/**
 * 从 AI SDK 传入的实验性运行上下文里取出本次审批通过的写路径。
 *
 * AI SDK 的 tool execute 第二个参数可以携带 `experimental_context`；
 * Web / 飞书审批通过后会把具体路径放进这里，让 write_file 只放行本次调用。
 */
function getApprovedWritePaths(context: unknown): string[] {
  const runtimeContext = context as ToolRuntimeContext | undefined;
  return Array.isArray(runtimeContext?.approvedWritePaths)
    ? runtimeContext.approvedWritePaths.filter((path): path is string => typeof path === 'string')
    : [];
}

/**
 * 工具名到工具组的映射。
 *
 * `enabledToolsets` 是按组开关的，所以 buildAgentTools 需要用这张表判断
 * 某个具体工具是否应该暴露给当前 Agent。
 */
const toolsetByName = new Map<string, string>([
  ['search_files', 'file'],
  ['read_file', 'file'],
  ['write_file', 'file'],
  ['memory_search', 'memory'],
  ['memory_get', 'memory'],
  ['memory_update', 'memory'],
  ['memory_forget', 'memory'],
  ['memory_recall', 'memory'],
  ['memory_evidence', 'memory'],
  ['memory_remember', 'memory'],
  ['memory_plan', 'memory'],
  ['memory_reflect', 'memory'],
  ['skill_list', 'skill'],
  ['skill_view', 'skill'],
  ['skill_create', 'skill'],
  ['skill_enable', 'skill'],
  ['skill_disable', 'skill'],
  ['skill_install', 'skill'],
  ['skill_update', 'skill'],
  ['agent_list', 'agent_config'],
  ['agent_get', 'agent_config'],
  ['agent_create', 'agent_config'],
  ['agent_delegate', 'agent_config'],
  ['agent_config_get', 'agent_config'],
  ['agent_config_patch', 'agent_config'],
  ['agent_config_reset', 'agent_config'],
]);

/**
 * 需要按 Agent 工具策略重新挂审批逻辑的写类工具。
 *
 * write_file 有路径白名单和本次 approvedPath 的特殊逻辑，所以单独在
 * createWriteFileTool() 里处理；其他写工具统一走 withConfiguredApproval()。
 */
const writeToolNames = new Set([
  'write_file',
  'skill_create',
  'skill_enable',
  'skill_disable',
  'skill_install',
  'skill_update',
  'agent_create',
  'agent_delegate',
  'agent_config_patch',
  'agent_config_reset',
]);

/**
 * read_file 的参数 schema。
 *
 * schema 是模型可见的工具契约：字段说明越明确，模型越少传错参数。
 */
const readFileSchema = z.object({
  path: z.string().describe('文件路径（相对或绝对）'),
});

/**
 * search_files 的参数 schema。
 *
 * 这个工具只做文件发现，不返回文件内容；模型找到候选路径后再调用 read_file。
 */
const searchFilesSchema = z.object({
  query: z.string().describe('文件名或路径片段，例如 "delegation"、"service.ts"、"agent-runtime"'),
  root: z.string().optional().describe('可选搜索根目录，默认项目根目录，例如 "src"'),
  limit: z.number().int().min(1).max(200).optional().describe('最多返回多少条结果，默认 50，最大 200'),
});

/**
 * write_file 的参数 schema。
 *
 * 写入是否需要审批不在 schema 里决定，而是在 needsApproval 里按 Agent 策略判断。
 */
const writeFileSchema = z.object({
  path: z.string().describe('文件路径'),
  content: z.string().describe('文件内容'),
  mode: z.enum(['overwrite', 'append', 'create']).describe('写入模式：overwrite=覆盖, append=追加, create=仅创建新文件'),
});

/**
 * read_file 工具实例。
 *
 * 读文件默认是只读能力，但仍尊重当前 Agent 的 requiresApproval 配置；
 * 用户如果把 read_file 加进审批列表，这里会要求确认。
 */
const readFileTool = tool({
    description: '读取指定路径的文件内容',
    inputSchema: readFileSchema,
    needsApproval: async () => evaluateToolPolicy({ toolName: 'read_file' }).requiresApproval,
    execute: async (params: z.infer<typeof readFileSchema>) => {
      return readFile(params.path);
    },
  });

/**
 * search_files 工具实例。
 *
 * 用于解决“Agent 不知道源码文件在哪”的问题，避免它误把目录当文件读。
 */
const searchFilesTool = tool({
    description: '按文件名或路径片段搜索项目内文件；不知道精确路径时先用它找文件，再用 read_file 读取内容',
    inputSchema: searchFilesSchema,
    needsApproval: async () => evaluateToolPolicy({ toolName: 'search_files' }).requiresApproval,
    execute: async (params: z.infer<typeof searchFilesSchema>) => {
      return searchFiles(params);
    },
  });

/**
 * 创建绑定到指定 Agent 的 write_file 工具。
 *
 * write_file 必须按 Agent 读取 allowedPaths，因为每个 Agent 的工具权限独立。
 * `agentId` 不作为模型参数暴露，防止模型绕过当前 Agent 的策略。
 */
function createWriteFileTool(agentId = 'default') {
  return tool({
    description: '写入内容到指定文件',
    inputSchema: writeFileSchema,
    needsApproval: async (params: z.infer<typeof writeFileSchema>) => {
      return evaluateToolPolicy({
        toolName: 'write_file',
        operation: 'write',
        allowlisted: isInputPathAllowlisted(params.path, agentId),
        agentId,
      }).requiresApproval;
    },
    execute: async (params: z.infer<typeof writeFileSchema>, options) => {
      // approvedPath 只代表当前审批放行的具体路径，不会持久写入 agent.json。
      const approvedPath = getApprovedWritePaths(options.experimental_context)
        .find((path) => path === params.path);
      return writeFile(params.path, params.content, params.mode, agentId, { approvedPath });
    },
  });
}

const writeFileTool = createWriteFileTool();

/**
 * 给 context-aware 工具补上当前 Agent 的审批策略。
 *
 * 一些工具来自 Memory / Skill / AgentConfig Service，每次 buildAgentTools 都会重新创建；
 * 这里统一覆盖它们的 needsApproval，确保最终是否审批只由当前 Agent 的 policy 决定。
 */
function withConfiguredApproval(toolName: string, baseTool: Tool, agentId: string): Tool {
  if (!writeToolNames.has(toolName) || toolName === 'write_file') return baseTool;
  return {
    ...baseTool,
    needsApproval: async () => evaluateToolPolicy({
      toolName,
      operation: 'write',
      agentId,
    }).requiresApproval,
  };
}

/**
 * 工具注册分两层：
 * 1. registerTool 保存工具元数据，用于权限策略、控制台展示和测试。
 * 2. buildAgentTools 为每个 task 创建真正传给模型的工具集合。
 *
 * 记忆工具必须用 buildAgentTools(context) 创建，因为它们写事件时需要 taskId/conversationId。
 */
// 文件工具：基础项目文件读写与文件发现能力。
registerTool({
  name: 'search_files',
  tool: searchFilesTool,
  toolset: 'file',
  category: 'read',
});
registerTool({
  name: 'read_file',
  tool: readFileTool,
  toolset: 'file',
  category: 'read',
});
registerTool({
  name: 'write_file',
  tool: writeFileTool,
  toolset: 'file',
  category: 'write',
});

// 低层 memoryTools：面向内部记忆记录的查询、更新和遗忘能力。
registerTool({
  name: 'memory_search',
  tool: memoryTools.memory_search,
  toolset: 'memory',
  category: 'memory_read',
});
registerTool({
  name: 'memory_get',
  tool: memoryTools.memory_get,
  toolset: 'memory',
  category: 'memory_read',
});
registerTool({
  name: 'memory_update',
  tool: memoryTools.memory_update,
  toolset: 'memory',
  category: 'memory_write',
});
registerTool({
  name: 'memory_forget',
  tool: memoryTools.memory_forget,
  toolset: 'memory',
  category: 'memory_write',
});

// 这些工具实例没有绑定 task 上下文，只用于注册元数据和默认工具集导出。
const humanMemoryTools = createHumanMemoryTools();
const skillTools = createSkillTools();
const agentConfigTools = createAgentConfigTools();
const agentTools = createAgentTools();

// 人类可理解的长期记忆工具：给 Agent 主动回忆、记录、计划和反思使用。
registerTool({
  name: 'memory_recall',
  tool: humanMemoryTools.memory_recall,
  toolset: 'memory',
  category: 'memory_read',
});
registerTool({
  name: 'memory_evidence',
  tool: humanMemoryTools.memory_evidence,
  toolset: 'memory',
  category: 'memory_read',
});
registerTool({
  name: 'memory_remember',
  tool: humanMemoryTools.memory_remember,
  toolset: 'memory',
  category: 'memory_write',
});
registerTool({
  name: 'memory_plan',
  tool: humanMemoryTools.memory_plan,
  toolset: 'memory',
  category: 'memory_write',
});
registerTool({
  name: 'memory_reflect',
  tool: humanMemoryTools.memory_reflect,
  toolset: 'memory',
  category: 'memory_write',
});

// Skill 工具：管理当前 Agent 自己的技能索引和 SKILL.md 内容。
registerTool({
  name: 'skill_list',
  tool: skillTools.skill_list,
  toolset: 'skill',
  category: 'read',
});
registerTool({
  name: 'skill_view',
  tool: skillTools.skill_view,
  toolset: 'skill',
  category: 'read',
});
registerTool({
  name: 'skill_create',
  tool: skillTools.skill_create,
  toolset: 'skill',
  category: 'write',
});
registerTool({
  name: 'skill_enable',
  tool: skillTools.skill_enable,
  toolset: 'skill',
  category: 'write',
});
registerTool({
  name: 'skill_disable',
  tool: skillTools.skill_disable,
  toolset: 'skill',
  category: 'write',
});
registerTool({
  name: 'skill_install',
  tool: skillTools.skill_install,
  toolset: 'skill',
  category: 'write',
});
registerTool({
  name: 'skill_update',
  tool: skillTools.skill_update,
  toolset: 'skill',
  category: 'write',
});

// Agent 工具：列出、读取、创建 Agent，以及发起异步 Agent Delegation。
registerTool({
  name: 'agent_list',
  tool: agentTools.agent_list,
  toolset: 'agent_config',
  category: 'read',
});
registerTool({
  name: 'agent_get',
  tool: agentTools.agent_get,
  toolset: 'agent_config',
  category: 'read',
});
registerTool({
  name: 'agent_create',
  tool: agentTools.agent_create,
  toolset: 'agent_config',
  category: 'write',
});
registerTool({
  name: 'agent_delegate',
  tool: agentTools.agent_delegate,
  toolset: 'agent_config',
  category: 'write',
});

// AgentConfig 工具：受控读取和修改当前 Agent 的 agent.json。
registerTool({
  name: 'agent_config_get',
  tool: agentConfigTools.agent_config_get,
  toolset: 'agent_config',
  category: 'read',
});
registerTool({
  name: 'agent_config_patch',
  tool: agentConfigTools.agent_config_patch,
  toolset: 'agent_config',
  category: 'write',
});
registerTool({
  name: 'agent_config_reset',
  tool: agentConfigTools.agent_config_reset,
  toolset: 'agent_config',
  category: 'write',
});

/**
 * 默认工具集合。
 *
 * 主要用于旧调用方和测试。真实运行时应优先使用 buildAgentTools(context)，
 * 因为它会注入 taskId、conversationId、agentId 等上下文。
 */
export const tools = buildAiToolSet('default');

/**
 * 为一次 Agent run 构建工具集合。
 *
 * 与静态 `tools` 不同，这里会把 task/conversation 上下文传给记忆工具，
 * 让 memory.search 等事件能正确关联到本轮任务。
 *
 * @param context 记忆工具上下文，包括 agentId、taskId、conversationId 等。
 * @returns 可传给 AI SDK 的工具集合。
 */
export function buildAgentTools(context: MemoryToolContext = {}) {
  // 每个 Agent run 都创建新的 context-aware memory tools，确保 memory.search 事件归属正确。
  const agentId = context.agentId ?? 'default';
  // enabledToolsets 来自当前 Agent 的 agent.json，用于按工具组控制可见能力。
  const enabledToolsets = new Set(defaultAgentConfigService.getAgentConfig(agentId, context).tools.enabledToolsets);
  // allTools 是“候选全集”；后面会按 enabledToolsets 过滤，再补审批策略。
  const allTools = {
    search_files: searchFilesTool,
    read_file: readFileTool,
    write_file: createWriteFileTool(agentId),
    ...createMemoryTools(context),
    ...createHumanMemoryTools(context),
    ...createSkillTools(context),
    ...createAgentTools(context),
    ...createAgentConfigTools(context),
  };

  return Object.fromEntries(
    Object.entries(allTools)
      // 未登记到 toolsetByName 的工具默认归到 core；当前内置工具都应显式登记。
      .filter(([toolName]) => enabledToolsets.has(toolsetByName.get(toolName) ?? 'core'))
      .map(([toolName, builtTool]) => [toolName, withConfiguredApproval(toolName, builtTool, agentId)]),
  );
}
