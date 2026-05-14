import { resolve, relative, dirname, basename } from 'node:path';
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, lstatSync, readdirSync, statSync } from 'node:fs';
import { defaultAgentConfigService } from '../agents/config-service';
import { getProjectRoot } from '../core/config';

// ============================================================
// 类型定义
// ============================================================

export interface ToolResult {
  /** 工具是否执行成功。失败时一定带 `error`。 */
  success: boolean;
  /** 成功结果。读文件会带 content；写文件只返回最终路径和写入模式。 */
  data?: { content?: string; path: string; mode?: string };
  /** 结构化错误，供 Agent 给用户明确说明下一步。 */
  error?: {
    type: 'path_not_allowed' | 'file_not_found' | 'permission_denied' | 'invalid_operation' | 'unknown';
    message: string;
    suggestion?: string;
  };
}

export interface SearchFilesResult {
  /** 搜索是否执行成功。失败时一定带 `error`。 */
  success: boolean;
  /** 成功结果，只包含文件元数据，不读取文件内容。 */
  data?: {
    /** 原始搜索词。 */
    query: string;
    /** 实际搜索根目录，相对于项目根目录。 */
    root: string;
    /** 命中的文件列表，路径均为项目相对路径。 */
    matches: Array<{
      path: string;
      name: string;
      size: number;
      modifiedAt: number;
    }>;
    /** 结果达到 limit 后会截断，避免一次返回过多文件。 */
    truncated: boolean;
  };
  error?: ToolResult["error"];
}

/**
 * 文件发现工具默认跳过的目录或路径片段。
 *
 * 这里的目标是让 Agent 查项目源码时避开依赖、构建产物和大体量运行时数据，
 * 既减少无效结果，也避免把 LanceDB 等二进制数据暴露给文本搜索流程。
 */
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
 * @throws 检测到路径穿越、符号链接或其他不可访问路径时抛出错误。
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
 * @param agentId 读取哪个 Agent 的 `tools.allowedPaths` 配置。
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
 * 这个函数是 `write_file` 审批逻辑的轻量判断入口：
 * 先做路径规范化，再按目标 Agent 的 allowlist 判断。
 *
 * @param inputPath 用户或模型传入的路径。
 * @param agentId 读取哪个 Agent 的 `tools.allowedPaths` 配置。
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
 *
 * @param absolutePath 已规范化的绝对路径。
 * @returns 路径指向 `data/agents/<agentId>/agent.json` 时返回 `true`。
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
 * 读取项目内文本文件。
 *
 * 读操作不使用 `allowedPaths` 白名单；它只受项目根目录和路径穿越检查约束。
 * 写操作仍必须走 `writeFile()` 的白名单和审批逻辑。
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
 *
 * @param input.query 要匹配的文件名或路径片段，大小写不敏感。
 * @param input.root 可选搜索根目录，必须位于项目根目录内，默认项目根目录。
 * @param input.limit 可选最大返回数量，范围会被限制在 1 到 200。
 * @returns 匹配文件的项目相对路径和基础元数据；不会返回文件内容。
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

/**
 * 判断搜索过程是否应该跳过某个路径。
 *
 * @param relativePath 当前条目相对于项目根目录的路径。
 * @param name 当前条目的文件名或目录名。
 * @returns 命中默认忽略目录、路径或路径片段时返回 `true`。
 */
function shouldIgnoreSearchPath(relativePath: string, name: string): boolean {
  if (DEFAULT_SEARCH_IGNORES.has(name) || DEFAULT_SEARCH_IGNORES.has(relativePath)) return true;
  return relativePath.split(/[\\/]/).some((part) => DEFAULT_SEARCH_IGNORES.has(part));
}

/**
 * 写入项目内文件。
 *
 * 写入前会做三层保护：
 * 1. 路径必须位于项目根目录内，不能路径穿越或指向符号链接。
 * 2. 不能写任意 Agent 的 `agent.json`，Agent 配置必须走 AgentConfigService。
 * 3. 目标路径必须在当前 Agent 的 `tools.allowedPaths` 中，或等于本次审批通过的 `approvedPath`。
 *
 * @param path 相对于项目根目录的路径
 * @param content 文件内容
 * @param mode 写入模式：
 *   - 'create': 创建新文件，文件存在时失败
 *   - 'overwrite': 覆盖文件，不存在时创建
 *   - 'append': 追加到文件末尾，文件不存在时失败
 * @param agentId 读取哪个 Agent 的写文件白名单配置。
 * @param options.approvedPath 本次工具审批临时批准的具体路径，不会写入长期白名单。
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
