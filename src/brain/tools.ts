import { tool } from 'ai';
import { z } from 'zod';
import { readFile, writeFile, isInputPathAllowlisted } from './tool-executor';
import { createMemoryTools, memoryTools, type MemoryToolContext } from '../memory/memory-tools';
import { createHumanMemoryTools } from '../memory/human-memory-tools';
import { evaluateToolPolicy } from './tool-policy';
import { buildAiToolSet, registerTool } from './tool-registry';

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
  name: 'memory_propose',
  tool: memoryTools.memory_propose,
  toolset: 'memory',
  category: 'memory_write',
  createsCandidateMemory: false,
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

export function buildAgentTools(context: MemoryToolContext = {}) {
  return {
    read_file: readFileTool,
    write_file: writeFileTool,
    ...createMemoryTools(context),
    ...createHumanMemoryTools(context),
  };
}
