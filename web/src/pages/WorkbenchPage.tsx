import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  FileCode2,
  GitBranch,
  GitMerge,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { PageScaffold, PageSection } from "../components/common/PageScaffold";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";

interface WorkbenchBranch {
  name: string;
  subject: string;
  baseCommit: string;
  headCommit: string;
  createdAt: string;
  changedFiles: number;
  additions: number;
  deletions: number;
  dependencies: string[];
}

interface BranchDiff {
  branch: string;
  diff: string;
  truncated: boolean;
  maxLines: number;
  totalLines: number;
}

type ConfirmAction =
  | { type: "merge"; branch: WorkbenchBranch; includeDependencies: boolean }
  | { type: "discard"; branch: WorkbenchBranch; typedName: string };

const POLL_INTERVAL_MS = 30_000;

export default function WorkbenchPage() {
  const [branches, setBranches] = useState<WorkbenchBranch[]>([]);
  const [loading, setLoading] = useState(false);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [diff, setDiff] = useState<BranchDiff | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);

  useEffect(() => {
    void refreshBranches();
    const timer = window.setInterval(() => void refreshBranches({ quiet: true }), POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, []);

  const totalChanges = useMemo(
    () => branches.reduce((sum, branch) => sum + branch.changedFiles, 0),
    [branches],
  );

  async function refreshBranches(options: { quiet?: boolean } = {}) {
    if (!options.quiet) setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/workbench/branches");
      const body = await readJson<{ branches?: WorkbenchBranch[]; error?: string }>(res);
      if (!res.ok) throw new Error(body.error ?? "读取分支失败");
      setBranches(body.branches ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "读取分支失败");
    } finally {
      if (!options.quiet) setLoading(false);
    }
  }

  async function openDiff(branch: WorkbenchBranch) {
    setDiffLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/workbench/branches/${encodeURIComponent(branch.name)}/diff?maxLines=500`);
      const body = await readJson<BranchDiff & { error?: string }>(res);
      if (!res.ok) throw new Error(body.error ?? "读取 diff 失败");
      setDiff(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "读取 diff 失败");
    } finally {
      setDiffLoading(false);
    }
  }

  async function runMerge(action: Extract<ConfirmAction, { type: "merge" }>) {
    setActing(true);
    setError(null);
    setNotice(null);
    try {
      const endpoint = action.includeDependencies
        ? "merge-with-deps"
        : "merge";
      const res = await fetch(`/api/workbench/branches/${encodeURIComponent(action.branch.name)}/${endpoint}`, {
        method: "POST",
      });
      const body = await readJson<{ merged?: string[]; error?: string }>(res);
      if (!res.ok) throw new Error(body.error ?? "合并失败");
      setNotice(`已合并：${(body.merged ?? [action.branch.name]).join(", ")}`);
      setConfirmAction(null);
      await refreshBranches();
    } catch (err) {
      setError(err instanceof Error ? err.message : "合并失败");
    } finally {
      setActing(false);
    }
  }

  async function runDiscard(action: Extract<ConfirmAction, { type: "discard" }>) {
    if (action.typedName !== action.branch.name) return;
    setActing(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/workbench/branches/${encodeURIComponent(action.branch.name)}/discard`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmed: true }),
      });
      const body = await readJson<{ discarded?: string; error?: string }>(res);
      if (!res.ok) throw new Error(body.error ?? "丢弃失败");
      setNotice(`已丢弃：${body.discarded ?? action.branch.name}`);
      setConfirmAction(null);
      await refreshBranches();
    } catch (err) {
      setError(err instanceof Error ? err.message : "丢弃失败");
    } finally {
      setActing(false);
    }
  }

  return (
    <PageScaffold>
      <PageSection
        title="开发工作台"
        description="查看未合并到 main 的本地分支，检查 diff 后再合并或丢弃。"
      >
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 text-sm text-[var(--color-text-muted)]">
            <StatPill label="未合并分支" value={branches.length.toString()} />
            <StatPill label="涉及文件" value={totalChanges.toString()} />
            <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">
              依赖标记为疑似依赖
            </span>
          </div>
          <button
            onClick={() => void refreshBranches()}
            className="inline-flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-white px-3 py-2 text-sm font-semibold text-[var(--color-text-muted)] hover:bg-[var(--color-surface-subtle)]"
          >
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
            刷新
          </button>
        </div>

        {(error || notice) && (
          <div className={`mb-4 rounded-lg px-3 py-2 text-sm ${error ? "bg-[var(--color-danger-soft)] text-[var(--color-danger)]" : "bg-[var(--color-success-soft)] text-[var(--color-success)]"}`}>
            {error ?? notice}
          </div>
        )}

        <div className="overflow-hidden rounded-xl border border-[var(--color-border-soft)] bg-white">
          <Table>
              <TableHeader className="bg-[var(--color-surface-subtle)]">
                <TableRow>
                  <TableHead>分支</TableHead>
                  <TableHead>文件</TableHead>
                  <TableHead>行数</TableHead>
                  <TableHead>Base</TableHead>
                  <TableHead>创建时间</TableHead>
                  <TableHead>依赖</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {branches.map((branch) => (
                  <TableRow key={branch.name}>
                    <TableCell>
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-accent-soft)] px-2.5 py-1 font-mono text-xs font-semibold text-[var(--color-accent)]">
                        <GitBranch size={13} />
                        {branch.name}
                      </span>
                      {branch.subject && (
                        <details className="mt-1 max-w-72">
                          <summary className="cursor-pointer truncate text-xs text-[var(--color-text-muted)]">
                            {branch.subject.split("\n")[0]}
                          </summary>
                          <pre className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-[var(--color-text-soft)]">{branch.subject}</pre>
                        </details>
                      )}
                    </TableCell>
                    <TableCell className="font-semibold text-[var(--color-text)]">{branch.changedFiles}</TableCell>
                    <TableCell>
                      <span className="font-mono text-emerald-700">+{branch.additions}</span>
                      <span className="mx-1 text-[var(--color-text-soft)]">/</span>
                      <span className="font-mono text-rose-700">-{branch.deletions}</span>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-[var(--color-text-muted)]">{branch.baseCommit}</TableCell>
                    <TableCell className="text-[var(--color-text-muted)]">{formatDate(branch.createdAt)}</TableCell>
                    <TableCell>
                      {branch.dependencies.length > 0 ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">
                          <AlertTriangle size={13} />
                          {branch.dependencies.join(", ")}
                        </span>
                      ) : (
                        <span className="text-xs text-[var(--color-text-soft)]">无</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <IconButton label="查看Diff" onClick={() => void openDiff(branch)} icon={FileCode2} />
                        <IconButton
                          label="合并"
                          onClick={() => setConfirmAction({ type: "merge", branch, includeDependencies: branch.dependencies.length > 0 })}
                          icon={GitMerge}
                        />
                        <IconButton
                          label="丢弃"
                          danger
                          onClick={() => setConfirmAction({ type: "discard", branch, typedName: "" })}
                          icon={Trash2}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {!loading && branches.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="px-4 py-12 text-center text-sm text-[var(--color-text-muted)]">
                      当前没有未合并到 main 的本地分支。
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
        </div>
      </PageSection>

      {diff && (
        <DiffSheet diff={diff} loading={diffLoading} onClose={() => setDiff(null)} />
      )}
      {confirmAction && (
        <ConfirmDialog
          action={confirmAction}
          acting={acting}
          onChange={setConfirmAction}
          onCancel={() => setConfirmAction(null)}
          onConfirm={() => confirmAction.type === "merge" ? void runMerge(confirmAction) : void runDiscard(confirmAction)}
        />
      )}
    </PageScaffold>
  );
}

function StatPill({ label, value }: { label: string; value: string }) {
  return (
    <span className="rounded-full bg-[var(--color-surface-subtle)] px-3 py-1 text-xs font-semibold">
      {label}: <span className="font-mono text-[var(--color-text)]">{value}</span>
    </span>
  );
}

function IconButton({
  label,
  onClick,
  icon: Icon,
  danger = false,
}: {
  label: string;
  onClick: () => void;
  icon: typeof FileCode2;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold transition-colors ${
        danger
          ? "border-rose-100 bg-rose-50 text-rose-700 hover:bg-rose-100"
          : "border-[var(--color-border)] bg-white text-[var(--color-text-muted)] hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text)]"
      }`}
    >
      <Icon size={15} />
      {label}
    </button>
  );
}

function DiffSheet({ diff, loading, onClose }: { diff: BranchDiff; loading: boolean; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/20">
      <aside className="flex h-full w-full max-w-4xl flex-col border-l border-[var(--color-border-soft)] bg-white shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border-soft)] px-5 py-4">
          <div className="min-w-0">
            <div className="font-mono text-sm font-semibold text-[var(--color-text)]">{diff.branch}</div>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">
              {diff.truncated ? `已截断到 ${diff.maxLines} 行，共 ${diff.totalLines} 行。` : `${diff.totalLines} 行 diff。`}
            </p>
          </div>
          <button
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--color-surface-subtle)] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            title="关闭"
          >
            <X size={18} />
          </button>
        </div>
        <pre className="min-h-0 flex-1 overflow-auto bg-[#0b1020] p-5 font-mono text-xs leading-5 text-slate-100">
          {loading ? "加载中..." : diff.diff || "这个分支没有文本 diff。"}
        </pre>
      </aside>
    </div>
  );
}

function ConfirmDialog({
  action,
  acting,
  onChange,
  onCancel,
  onConfirm,
}: {
  action: ConfirmAction;
  acting: boolean;
  onChange: (action: ConfirmAction) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const isDiscard = action.type === "discard";
  const canConfirm = !acting && (!isDiscard || action.typedName === action.branch.name);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-lg rounded-xl border border-[var(--color-border-soft)] bg-white shadow-2xl">
        <div className="border-b border-[var(--color-border-soft)] px-5 py-4">
          <h3 className="text-base font-semibold text-[var(--color-text)]">
            {isDiscard ? "丢弃本地分支" : "合并本地分支"}
          </h3>
          <p className="mt-1 text-sm leading-6 text-[var(--color-text-muted)]">
            {isDiscard
              ? "该操作会强制删除本地分支，不会自动恢复。"
              : "后端会先尝试 fast-forward，无法快进时再执行普通 merge；冲突会返回错误。"}
          </p>
        </div>
        <div className="space-y-4 px-5 py-4">
          <div className="rounded-lg bg-[var(--color-surface-subtle)] px-3 py-2 font-mono text-sm font-semibold">
            {action.branch.name}
          </div>

          {action.type === "merge" && action.branch.dependencies.length > 0 && (
            <label className="flex items-start gap-3 rounded-lg border border-amber-100 bg-amber-50 px-3 py-3 text-sm text-amber-800">
              <input
                type="checkbox"
                checked={action.includeDependencies}
                onChange={(event) => onChange({ ...action, includeDependencies: event.target.checked })}
                className="mt-1 h-4 w-4"
              />
              <span>
                一并合并疑似依赖分支：<span className="font-mono font-semibold">{action.branch.dependencies.join(", ")}</span>
              </span>
            </label>
          )}

          {isDiscard && (
            <label className="block text-sm font-semibold text-[var(--color-text-muted)]">
              输入分支名确认
              <input
                value={action.typedName}
                onChange={(event) => onChange({ ...action, typedName: event.target.value })}
                className="mt-2 w-full rounded-lg border border-[var(--color-border)] px-3 py-2 font-mono text-sm outline-none focus:border-[var(--color-accent)]"
                placeholder={action.branch.name}
              />
            </label>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-[var(--color-border-soft)] px-5 py-4">
          <button
            onClick={onCancel}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-white px-3 py-2 text-sm font-semibold text-[var(--color-text-muted)] hover:bg-[var(--color-surface-subtle)]"
          >
            <X size={16} />
            取消
          </button>
          <button
            onClick={onConfirm}
            disabled={!canConfirm}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 ${
              isDiscard ? "bg-rose-600 hover:bg-rose-700" : "bg-[var(--color-accent)] hover:bg-[var(--color-accent-strong)]"
            }`}
          >
            {isDiscard ? <Trash2 size={16} /> : <Check size={16} />}
            {acting ? "处理中" : isDiscard ? "确认丢弃" : "确认合并"}
          </button>
        </div>
      </div>
    </div>
  );
}

async function readJson<T>(res: Response): Promise<T> {
  return await res.json().catch(() => ({})) as T;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "-";
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
