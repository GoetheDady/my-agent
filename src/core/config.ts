/**
 * 配置加载模块
 *
 * 职责：从配置文件中读取应用配置，合并环境变量，提供类型安全的配置访问。
 *
 * MVP 阶段只需要 provider 相关配置（API key、base URL、model 名），
 * 其他配置项按需逐步添加。
 *
 * 为什么不直接用 process.env？
 *   1. 配置需要做校验（API key 缺失时尽早报错，而非运行时才发现）
 *   2. 配置文件支持默认值和覆盖（JSON 配置 → 环境变量覆盖）
 *   3. 集中管理 key 名，避免字符串散落各处拼写错误
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ============================================================
// 类型定义
// ============================================================

/** Provider 相关配置 */
export interface ProviderConfig {
  /** API 密钥 */
  apiKey: string;
  /** 模型名称 */
  model: string;
  /** API 基础 URL（可选，不填则用 @ai-sdk/deepseek 默认地址） */
  baseURL?: string;
}

/** Embedding 相关配置 */
export interface EmbeddingConfig {
  apiKey: string;
  model: string;
}

/** Tools 相关配置 */
export interface ToolsConfig {
  allowedPaths: string[];
}

/** 运行时数据目录配置 */
export interface RuntimeDataConfig {
  /** 所有本地运行数据的根目录，例如 SQLite、LanceDB、profile 文件 */
  rootDir: string;
}

/** 完整应用配置 */
export interface AppConfig {
  provider: ProviderConfig;
  embedding: EmbeddingConfig;
  tools: ToolsConfig;
  runtimeData: RuntimeDataConfig;
}

// ============================================================
// 默认值
// ============================================================

const DEFAULT_MODEL = "deepseek-v4-flash";
export const DEFAULT_RUNTIME_DATA_DIR_NAME = ".my-agent";

// ============================================================
// 配置加载
// ============================================================

/**
 * 获取项目根目录。
 *
 * Bun 和 Node 的 `import.meta` 行为不同，所以这里做兼容处理：
 * Bun 可以使用 `import.meta.dir`，Node 需要通过 `fileURLToPath` 计算。
 *
 * @returns 项目根目录的绝对路径。
 */
export function getProjectRoot(): string {
  const meta = import.meta as unknown as { dir?: string };
  if (meta.dir) return resolve(meta.dir, "../..");

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  return resolve(__dirname, "../..");
}

/**
 * 获取运行时数据根目录。
 *
 * 运行时数据是用户使用项目后产生的本地状态，例如数据库、向量库和 profile 文件。
 * 默认放在项目根目录的 `.my-agent/` 下，便于把源码和用户数据隔离；部署给别人使用时，
 * 可以通过 `MY_AGENT_DATA_DIR` 改到任意持久化目录。
 *
 * @param root 项目根目录，测试或配置加载时可显式传入。
 * @returns 运行时数据目录的绝对路径。
 */
export function getRuntimeDataDir(root = getProjectRoot()): string {
  return resolve(process.env.MY_AGENT_DATA_DIR ?? resolve(root, DEFAULT_RUNTIME_DATA_DIR_NAME));
}

/**
 * 获取运行时临时目录。
 *
 * 临时目录也放在运行时根目录下，避免远程 skill clone 等副作用散落到系统临时目录。
 *
 * @param root 项目根目录，测试或配置加载时可显式传入。
 * @returns 运行时临时目录的绝对路径。
 */
export function getRuntimeTempDir(root = getProjectRoot()): string {
  return resolve(getRuntimeDataDir(root), "tmp");
}

/**
 * 加载应用配置。
 *
 * 配置优先级为：环境变量 > `config.json` > 默认值。
 *
 * @returns 完整应用配置。
 * @throws 缺少 DeepSeek API Key 时抛出错误。
 */
export function loadConfig(): AppConfig {
  const root = getProjectRoot();
  const configPath = resolve(root, "config.json");

  let fileConfig: Partial<AppConfig> = {};
  if (existsSync(configPath)) {
    try {
      fileConfig = JSON.parse(readFileSync(configPath, "utf-8"));
    } catch (err) {
      console.warn(`配置文件读取失败: ${configPath}`, err);
    }
  }

  const resolveEnv = (value: string | undefined): string | undefined => {
    if (!value) return undefined;
    if (value.startsWith("$")) {
      return process.env[value.slice(1)] ?? undefined;
    }
    return value;
  };

  const apiKey =
    resolveEnv(process.env.DEEPSEEK_API_KEY) ??
    resolveEnv(fileConfig.provider?.apiKey) ??
    "";

  if (!apiKey) {
    throw new Error(
      "缺少 DEEPSEEK_API_KEY。请在环境变量中设置，或在 config.json 中配置"
    );
  }

  // 兼容旧 Anthropic 格式配置：以前可能把 baseURL 写成 /anthropic 结尾。
  // DeepSeek SDK 需要基础地址本身，所以这里统一剥掉后缀。
  let baseURL = fileConfig.provider?.baseURL;
  if (baseURL?.endsWith("/anthropic")) {
    baseURL = baseURL.slice(0, -"/anthropic".length);
  }

  return {
    provider: {
      apiKey,
      model: fileConfig.provider?.model ?? DEFAULT_MODEL,
      baseURL,
    },
    embedding: {
      apiKey: process.env.ZHIPU_API_KEY ?? "",
      model: "embedding-3",
    },
    tools: {
      allowedPaths: fileConfig.tools?.allowedPaths ?? [getProjectRoot()],
    },
    runtimeData: {
      rootDir: getRuntimeDataDir(root),
    },
  };
}

let _config: AppConfig | null = null;

/**
 * 获取缓存后的应用配置。
 *
 * @returns 应用配置；首次调用会读取文件和环境变量，后续复用缓存。
 */
export function getConfig(): AppConfig {
  // 配置只缓存一次，避免每次工具调用都读文件。
  // 如果后续做配置 UI，需要在 saveConfig 后同步刷新这个缓存。
  if (!_config) {
    _config = loadConfig();
  }
  return _config;
}

/**
 * 保存完整应用配置到 `config.json`。
 *
 * @param config 要写入的完整配置对象。
 */
export function saveConfig(config: AppConfig): void {
  // 当前写回整个 config.json。调用方需要传入完整配置，避免局部覆盖丢字段。
  const root = getProjectRoot();
  const configPath = resolve(root, "config.json");

  writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
}
