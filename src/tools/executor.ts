import { resolve, relative, dirname, basename } from 'node:path';
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, lstatSync, readdirSync, statSync } from 'node:fs';
import { defaultAgentConfigService } from '../agents/config-service';
import { getProjectRoot } from '../core/config';

// ============================================================
// 类型定义
// ============================================================

export interface ToolResult {
  success: boolean;
  data?: { content?: string; path: string; mode?: string };
  error?: {
    type: 'path_not_allowed' | 'file_not_found' | 'permission_denied' | 'invalid_operation' | 'unknown';
    message: string;
    suggestion?: string;
  };
}

export interface SearchFilesResult {
  success: boolean;
  data?: {
    query: string;
    root: string;
    matches: Array<{
      path: string;
      name: string;
      size: number;
      modifiedAt: number;
    }>;
    truncated: boolean;
  };
  error?: ToolResult["error"];
}

const DEFAULT_SEARCH_IGNORES = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".next",
  ".turbo",
  ".cache",
  "coverage",
  "web/dist",
  "data/lancedb",
]);

// ============================================================
// 路径规范化
// ============================================================

/**
 * 规范化路径，防止路径遍历攻击和符号链接
 *
 * 1. 转换为绝对路径
 * 2. 检测符号链接
 * 3. 防止路径遍历（../）
 *
 * @param inputPath 用户或模型传入的相对路径。
 * @returns 项目根目录下的绝对路径。
 * @throws 检测到路径穿越或符号链接时抛出错误。
 */
export function normalizePath(inputPath: string): string {
  const projectRoot = getProjectRoot();
  const absolutePath = resolve(projectRoot, inputPath);

  // 检测软链接
  try {
    const stats = lstatSync(absolutePath);
    if (stats.isSymbolicLink()) {
      throw new Error('Symbolic links are not allowed');
    }
  } catch (err) {
    // 文件不存在时忽略（create 模式需要）
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err;
    }
  }

  // 防止路径遍历攻击
  const relativePath = relative(projectRoot, absolutePath);
  if (relativePath.startsWith('..') || resolve(projectRoot, relativePath) !== absolutePath) {
    throw new Error('Path traversal detected');
  }

  return absolutePath;
}

// ============================================================
// 白名单检查
// ============================================================

/**
 * 检查路径是否在白名单中
 *
 * 允许的路径包括：
 * 1. 白名单中的目录及其子目录
 * 2. 白名单中的文件
 *
 * @param absolutePath 已规范化的绝对路径。
 * @returns 路径在白名单内时返回 `true`。
 */
export function isPathInWhitelist(absolutePath: string, agentId = 'default'): boolean {
  const config = defaultAgentConfigService.getAgentConfig(agentId);
  const allowedPaths = config.tools.allowedPaths.map(p => resolve(getProjectRoot(), p));

  return allowedPaths.some(allowedPath => {
    // 如果是同一个文件
    if (absolutePath === allowedPath) {
      return true;
    }

    // 如果是允许路径的子目录/子文件
    const rel = relative(allowedPath, absolutePath);
    return !rel.startsWith('..') && rel !== '';
  });
}

/**
 * 检查原始输入路径是否可被写工具访问。
 *
 * @param inputPath 用户或模型传入的路径。
 * @returns 路径规范化成功且位于白名单内时返回 `true`。
 */
export function isInputPathAllowlisted(inputPath: string, agentId = 'default'): boolean {
  try {
    return isPathInWhitelist(normalizePath(inputPath), agentId);
  } catch {
    return false;
  }
}

/**
 * 判断路径是否指向任意 Agent 的受控配置文件。
 *
 * agent.json 是 AgentConfigService 的唯一写入口，通用文件工具不能修改它，
 * 否则模型可以绕过 schema 校验、审计和权限策略。
 */
export function isAgentConfigPath(absolutePath: string): boolean {
  const configRoot = defaultAgentConfigService.getConfigPath("default");
  const dataAgentsRoot = resolve(configRoot, "../..");
  const relativePath = relative(dataAgentsRoot, absolutePath);
  return !relativePath.startsWith("..")
    && !relativePath.startsWith("/")
    && relativePath.split(/[\\/]/).length === 2
    && relativePath.endsWith(`agent.json`);
}

// ============================================================
// 文件操作
// ============================================================

/**
 * 读取文件
 *
 * @param path 相对于项目根目录的路径
 * @returns 操作结果；成功时包含文件内容，失败时包含错误类型和建议。
 */
export function readFile(path: string): ToolResult {
  try {
    const absolutePath = normalizePath(path);

    if (!existsSync(absolutePath)) {
      return {
        success: false,
        error: {
          type: 'file_not_found',
          message: `File "${path}" does not exist`,
        },
      };
    }

    const content = readFileSync(absolutePath, 'utf-8');
    return {
      success: true,
      data: { content, path: absolutePath },
    };
  } catch (err) {
    return {
      success: false,
      error: {
        type: 'unknown',
        message: (err as Error).message,
      },
    };
  }
}

/**
 * 按文件名或相对路径片段搜索项目内文件。
 *
 * 这是 read_file 的前置发现工具：Agent 不知道精确路径时先用它找文件，
 * 再用 read_file 读取具体内容。
 */
export function searchFiles(input: {
  query: string;
  root?: string;
  limit?: number;
}): SearchFilesResult {
  try {
    const query = input.query.trim().toLowerCase();
    if (!query) {
      return {
        success: false,
        error: {
          type: "invalid_operation",
          message: "query 不能为空",
        },
      };
    }

    const projectRoot = getProjectRoot();
    const root = input.root?.trim() ? normalizePath(input.root) : projectRoot;
    const relativeRoot = relative(projectRoot, root) || ".";
    const limit = Math.max(1, Math.min(input.limit ?? 50, 200));
    const matches: NonNullable<SearchFilesResult["data"]>["matches"] = [];
    let truncated = false;

    const visit = (dir: string) => {
      if (matches.length >= limit) {
        truncated = true;
        return;
      }

      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const absolutePath = resolve(dir, entry.name);
        const relativePath = relative(projectRoot, absolutePath);
        if (shouldIgnoreSearchPath(relativePath, entry.name)) continue;

        if (entry.isDirectory()) {
          visit(absolutePath);
          if (truncated) return;
          continue;
        }

        if (!entry.isFile()) continue;
        if (!relativePath.toLowerCase().includes(query) && !entry.name.toLowerCase().includes(query)) continue;

        const stats = statSync(absolutePath);
        matches.push({
          path: relativePath,
          name: basename(relativePath),
          size: stats.size,
          modifiedAt: stats.mtimeMs,
        });
        if (matches.length >= limit) {
          truncated = true;
          return;
        }
      }
    };

    visit(root);

    return {
      success: true,
      data: {
        query: input.query,
        root: relativeRoot,
        matches,
        truncated,
      },
    };
  } catch (err) {
    return {
      success: false,
      error: {
        type: "unknown",
        message: (err as Error).message,
      },
    };
  }
}

function shouldIgnoreSearchPath(relativePath: string, name: string): boolean {
  if (DEFAULT_SEARCH_IGNORES.has(name) || DEFAULT_SEARCH_IGNORES.has(relativePath)) return true;
  return relativePath.split(/[\\/]/).some((part) => DEFAULT_SEARCH_IGNORES.has(part));
}

/**
 * 写入文件
 *
 * @param path 相对于项目根目录的路径
 * @param content 文件内容
 * @param mode 写入模式：
 *   - 'create': 创建新文件，文件存在时失败
 *   - 'overwrite': 覆盖文件，不存在时创建
 *   - 'append': 追加到文件末尾，文件不存在时失败
 * @returns 操作结果；成功时包含写入路径和模式，失败时包含错误类型和建议。
 */
export function writeFile(
  path: string,
  content: string,
  mode: 'overwrite' | 'append' | 'create' = 'overwrite',
  agentId = 'default',
  options: { approvedPath?: string } = {},
): ToolResult {
  try {
    const absolutePath = normalizePath(path);

    if (isAgentConfigPath(absolutePath)) {
      return {
        success: false,
        error: {
          type: 'permission_denied',
          message: 'agent.json 只能通过 AgentConfigService 修改，不能使用通用文件工具写入',
          suggestion: 'Use agent_config_patch instead',
        },
      };
    }

    const approvedPath = options.approvedPath ? normalizePath(options.approvedPath) : null;
    if (!isPathInWhitelist(absolutePath, agentId) && absolutePath !== approvedPath) {
      return {
        success: false,
        error: {
          type: 'path_not_allowed',
          message: `Path "${path}" is not in the allowed paths whitelist`,
          suggestion: 'Ask the user to add this path to the whitelist',
        },
      };
    }

    const fileExists = existsSync(absolutePath);

    // 验证模式
    if (mode === 'create' && fileExists) {
      return {
        success: false,
        error: {
          type: 'invalid_operation',
          message: `File "${path}" already exists (mode: create)`,
          suggestion: 'Use mode "overwrite" or "append" instead',
        },
      };
    }

    if (mode === 'append' && !fileExists) {
      return {
        success: false,
        error: {
          type: 'file_not_found',
          message: `File "${path}" does not exist (mode: append)`,
          suggestion: 'Use mode "create" or "overwrite" instead',
        },
      };
    }

    // 确保目录存在
    const dir = dirname(absolutePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // 执行写入
    if (mode === 'append') {
      appendFileSync(absolutePath, content, 'utf-8');
    } else {
      writeFileSync(absolutePath, content, 'utf-8');
    }

    return {
      success: true,
      data: { path: absolutePath, mode },
    };
  } catch (err) {
    return {
      success: false,
      error: {
        type: 'unknown',
        message: (err as Error).message,
      },
    };
  }
}
