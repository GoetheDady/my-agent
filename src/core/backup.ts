import type { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { getRuntimeDataDir } from "./config";
import { getDb } from "./database";
import type { AgentRecord } from "../agents/agent-types";
import type { Session, SessionMessage } from "../sessions/service";
import type { TaskRecord } from "../tasks/task-types";

const DEFAULT_BACKUP_KEEP_COUNT = 5;
const DEFAULT_AUTO_BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface BackupResult {
  path: string;
  size: number;
  createdAt: number;
}

export interface BackupFile {
  filename: string;
  path: string;
  size: number;
  createdAt: number;
}

export interface DatabaseExport {
  version: number;
  exportedAt: number;
  agents: AgentRecord[];
  tasks: TaskRecord[];
  sessions: Session[];
  messages: SessionMessage[];
  memories: {
    count: number;
    note: string;
  };
}

export interface AutoBackupResult {
  created: boolean;
  backup: BackupResult | BackupFile | null;
}

type TaskExportRow = Omit<TaskRecord, "retriable"> & {
  retriable: number | null;
};

/**
 * 获取默认 SQLite 备份目录。
 *
 * 备份目录放在运行时数据目录下，和源码保持隔离。
 */
export function getDefaultBackupDir(): string {
  return resolve(getRuntimeDataDir(), "backups");
}

/**
 * 为当前时间生成一个不会覆盖已有文件的备份路径。
 */
export function createTimestampedBackupPath(backupDir = getDefaultBackupDir()): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return resolve(backupDir, `agent-${timestamp}.sqlite`);
}

/**
 * 使用 SQLite VACUUM INTO 创建一致性备份。
 *
 * VACUUM INTO 是 SQLite 自带的在线快照能力；这里称为热备份，意思是不需要停服务。
 */
export async function backupDatabase(
  targetPath: string,
  database: Database = getDb(),
): Promise<BackupResult> {
  const resolvedTarget = resolve(targetPath);
  if (existsSync(resolvedTarget)) {
    throw new Error(`备份目标已存在: ${resolvedTarget}`);
  }

  mkdirSync(dirname(resolvedTarget), { recursive: true });
  database.exec(`VACUUM INTO ${quoteSqlString(resolvedTarget)}`);

  const fileStat = statSync(resolvedTarget);
  return {
    path: resolvedTarget,
    size: fileStat.size,
    createdAt: fileStat.mtimeMs,
  };
}

/**
 * 导出 SQLite 中的结构化元数据。
 *
 * LanceDB 向量库数据体积较大，当前 JSON 导出只记录记忆数量和说明。
 */
export function exportDatabaseJson(database: Database = getDb()): DatabaseExport {
  return {
    version: 1,
    exportedAt: Date.now(),
    agents: database.query<AgentRecord, []>("SELECT * FROM agents ORDER BY created_at ASC").all(),
    tasks: database
      .query<TaskExportRow, []>("SELECT * FROM tasks ORDER BY created_at ASC")
      .all()
      .map(toTaskRecord),
    sessions: database.query<Session, []>("SELECT * FROM sessions ORDER BY updated_at DESC").all(),
    messages: database.query<SessionMessage, []>("SELECT * FROM messages ORDER BY created_at ASC").all(),
    memories: {
      count: 0,
      note: "长期记忆存放在 LanceDB 向量库中，JSON 导出暂不包含向量数据；请使用 SQLite 备份和运行时数据目录备份保留完整记忆。",
    },
  };
}

/**
 * 列出已有 SQLite 备份文件，按创建时间倒序返回。
 */
export function listBackups(backupDir = getDefaultBackupDir()): BackupFile[] {
  if (!existsSync(backupDir)) return [];
  return readdirSync(backupDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sqlite"))
    .map((entry) => {
      const path = resolve(backupDir, entry.name);
      const fileStat = statSync(path);
      return {
        filename: entry.name,
        path,
        size: fileStat.size,
        createdAt: fileStat.mtimeMs,
      };
    })
    .sort((a, b) => b.createdAt - a.createdAt || b.filename.localeCompare(a.filename));
}

/**
 * 清理旧备份，只保留最近 keepCount 个。
 */
export function pruneBackups(backupDir: string, keepCount = DEFAULT_BACKUP_KEEP_COUNT): void {
  const keep = Math.max(0, Math.floor(keepCount));
  for (const backup of listBackups(backupDir).slice(keep)) {
    unlinkSync(backup.path);
  }
}

/**
 * 启动时的保守自动备份。
 *
 * 如果最近一次备份未超过 intervalMs，则跳过；否则创建一次新备份并清理旧备份。
 */
export async function backupDatabaseIfStale(options: {
  database?: Database;
  backupDir?: string;
  keepCount?: number;
  intervalMs?: number;
} = {}): Promise<AutoBackupResult> {
  const backupDir = options.backupDir ?? getDefaultBackupDir();
  const latest = listBackups(backupDir)[0] ?? null;
  const intervalMs = options.intervalMs ?? DEFAULT_AUTO_BACKUP_INTERVAL_MS;
  if (latest && Date.now() - latest.createdAt < intervalMs) {
    return { created: false, backup: latest };
  }

  const backup = await backupDatabase(createTimestampedBackupPath(backupDir), options.database ?? getDb());
  pruneBackups(backupDir, options.keepCount ?? DEFAULT_BACKUP_KEEP_COUNT);
  return { created: true, backup };
}

function toTaskRecord(row: TaskExportRow): TaskRecord {
  return {
    ...row,
    retriable: row.retriable === null ? null : Boolean(row.retriable),
  };
}

function quoteSqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function backupFileName(path: string): string {
  return basename(path);
}
