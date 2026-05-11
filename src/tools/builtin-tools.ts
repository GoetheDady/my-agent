import { tool } from 'ai';
import { z } from 'zod';
import { readFile, writeFile, isInputPathAllowlisted } from './executor';
import { createMemoryTools, memoryTools, type MemoryToolContext } from '../memory/memory-tools';
import { createHumanMemoryTools } from '../memory/human-memory-tools';
import { evaluateToolPolicy } from './policy';
import { buildAiToolSet, registerTool } from './registry';

const readFileSchema = z.object({
  path: z.string().describe('文件路径（相对或绝对）'),
});

const writeFileSchema = z.object({
  path: z.string().describe('文件路径'),
  content: z.string().describe('文件内容'),
  mode: z.enum(['overwrite', 'append', 'create']).describe('写入模式：overwrite=覆盖, append=追加, create=仅创建新文件'),
});

const readFileTool = tool({
    description: '读取指定路径的文件内容',
    inputSchema: readFileSchema,
    needsApproval: async () => evaluateToolPolicy({ toolName: 'read_file' }).requiresApproval,
    execute: async (params: z.infer<typeof readFileSchema>) => {
      return readFile(params.path);
    },
  });

const writeFileTool = tool({
    description: '写入内容到指定文件',
    inputSchema: writeFileSchema,
    needsApproval: async (params: z.infer<typeof writeFileSchema>) => {
      return evaluateToolPolicy({
        toolName: 'write_file',
        operation: 'write',
        allowlisted: isInputPathAllowlisted(params.path),
      }).requiresApproval;
    },
    execute: async (params: z.infer<typeof writeFileSchema>) => {
      return writeFile(params.path, params.content, params.mode);
    },
  });

/**
 * 工具注册分两层：
 * 1. registerTool 保存工具元数据，用于权限策略、控制台展示和测试。
 * 2. buildAgentTools 为每个 task 创建真正传给模型的工具集合。
 *
 * 记忆工具必须用 buildAgentTools(context) 创建，因为它们写事件时需要 taskId/conversationId。
 */
registerTool({
  name: 'read_file',
  tool: readFileTool,
  toolset: 'filesystem',
  category: 'read',
});
registerTool({
  name: 'write_file',
  tool: writeFileTool,
  toolset: 'filesystem',
  category: 'write',
});

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

const humanMemoryTools = createHumanMemoryTools();
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
  return {
    read_file: readFileTool,
    write_file: writeFileTool,
    ...createMemoryTools(context),
    ...createHumanMemoryTools(context),
  };
}
