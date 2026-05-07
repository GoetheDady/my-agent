import { tool } from 'ai';
import { z } from 'zod';
import { readFile, writeFile, isPathInWhitelist } from './tool-executor';

const readFileSchema = z.object({
  path: z.string().describe('文件路径（相对或绝对）'),
});

const writeFileSchema = z.object({
  path: z.string().describe('文件路径'),
  content: z.string().describe('文件内容'),
  mode: z.enum(['overwrite', 'append', 'create']).describe('写入模式：overwrite=覆盖, append=追加, create=仅创建新文件'),
});

export const tools = {
  read_file: tool({
    description: '读取指定路径的文件内容',
    inputSchema: readFileSchema,
    execute: async (params: z.infer<typeof readFileSchema>) => {
      const { path } = params;
      const needsApproval = !isPathInWhitelist(path);
      if (needsApproval) {
        return {
          needsApproval: true,
          path,
        };
      }
      return readFile(path);
    },
  }),

  write_file: tool({
    description: '写入内容到指定文件',
    inputSchema: writeFileSchema,
    execute: async (params: z.infer<typeof writeFileSchema>) => {
      const { path, mode, content } = params;
      const needsApproval = !isPathInWhitelist(path) || mode === 'overwrite';
      if (needsApproval) {
        return {
          needsApproval: true,
          path,
          mode,
        };
      }
      return writeFile(path, content, mode);
    },
  }),
};
