import { resolve, relative, dirname } from 'node:path';
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, lstatSync } from 'node:fs';
import { getProjectRoot, loadConfig } from '../core/config';

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

// ============================================================
// 路径规范化
// ============================================================

/**
 * 规范化路径，防止路径遍历攻击和符号链接
 *
 * 1. 转换为绝对路径
 * 2. 检测符号链接
 * 3. 防止路径遍历（../）
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
 */
export function isPathInWhitelist(absolutePath: string): boolean {
  const config = loadConfig();
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

export function isInputPathAllowlisted(inputPath: string): boolean {
  try {
    return isPathInWhitelist(normalizePath(inputPath));
  } catch {
    return false;
  }
}

// ============================================================
// 文件操作
// ============================================================

/**
 * 读取文件
 *
 * @param path 相对于项目根目录的路径
 * @returns 操作结果
 */
export function readFile(path: string): ToolResult {
  try {
    const absolutePath = normalizePath(path);

    if (!isPathInWhitelist(absolutePath)) {
      return {
        success: false,
        error: {
          type: 'path_not_allowed',
          message: `Path "${path}" is not in the allowed paths whitelist`,
          suggestion: 'Ask the user to add this path to the whitelist',
        },
      };
    }

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
 * 写入文件
 *
 * @param path 相对于项目根目录的路径
 * @param content 文件内容
 * @param mode 写入模式：
 *   - 'create': 创建新文件，文件存在时失败
 *   - 'overwrite': 覆盖文件，不存在时创建
 *   - 'append': 追加到文件末尾，文件不存在时失败
 * @returns 操作结果
 */
export function writeFile(
  path: string,
  content: string,
  mode: 'overwrite' | 'append' | 'create' = 'overwrite'
): ToolResult {
  try {
    const absolutePath = normalizePath(path);

    if (!isPathInWhitelist(absolutePath)) {
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
