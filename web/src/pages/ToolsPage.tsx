import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Lock, Plus, RefreshCw, Search, ShieldCheck, Trash2, Wrench } from "lucide-react";
import { InfoCard, PageScaffold, PageSection } from "../components/common/PageScaffold";
import { useAgentStore } from "../store/agentStore";
import type { RegisteredToolSummary, ToolApprovalSummary, ToolPolicySummary, ToolsetSummary } from "../types";

interface ToolPageData {
  agentId: string;
  config: ToolPolicySummary;
  toolsets: ToolsetSummary[];
  tools: RegisteredToolSummary[];
}

export default function ToolsPage() {
  const { agents, selectedAgentId, fetchAgents, setSelectedAgentId } = useAgentStore();
  const [data, setData] = useState<ToolPageData | null>(null);
  const [approvals, setApprovals] = useState<ToolApprovalSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pathInput, setPathInput] = useState("");

  useEffect(() => {
    void fetchAgents();
  }, [fetchAgents]);

  useEffect(() => {
    void refresh();
  }, [selectedAgentId]);

  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.id === selectedAgentId) ?? null,
    [agents, selectedAgentId],
  );

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const [toolsRes, approvalsRes] = await Promise.all([
        fetch(`/api/tools?agentId=${encodeURIComponent(selectedAgentId)}`),
        fetch(`/api/tools/approvals?agentId=${encodeURIComponent(selectedAgentId)}&limit=20`),
      ]);
      if (!toolsRes.ok) throw new Error("读取工具权限失败");
      if (!approvalsRes.ok) throw new Error("读取审批记录失败");
      setData(await toolsRes.json() as ToolPageData);
      const approvalsData = await approvalsRes.json() as { approvals: ToolApprovalSummary[] };
      setApprovals(approvalsData.approvals ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "读取工具权限失败");
    } finally {
      setLoading(false);
    }
  }

  async function patchTools(patch: Record<string, string[]>, label: string) {
    setSaving(label);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/tools/config/${encodeURIComponent(selectedAgentId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      const body = await res.json() as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "更新工具策略失败");
      setNotice("工具策略已更新。");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "更新工具策略失败");
    } finally {
      setSaving(null);
    }
  }

  function toggleToolset(toolsetName: string, enabled: boolean) {
    void patchTools(
      enabled
        ? { removeEnabledToolsets: [toolsetName] }
        : { addEnabledToolsets: [toolsetName] },
      `toolset-${toolsetName}`,
    );
  }

  function toggleApproval(toolName: string, required: boolean) {
    void patchTools(
      required
        ? { removeRequiresApproval: [toolName] }
        : { addRequiresApproval: [toolName] },
      `approval-${toolName}`,
    );
  }

  function addAllowedPath() {
    const path = pathInput.trim();
    if (!path) return;
    void patchTools({ addAllowedPaths: [path] }, "path-add");
    setPathInput("");
  }

  function removeAllowedPath(path: string) {
    void patchTools({ removeAllowedPaths: [path] }, `path-${path}`);
  }

  const config = data?.config;
  const enabledToolsets = new Set(config?.enabledToolsets ?? []);
  const approvalTools = new Set(config?.requiresApproval ?? []);

  return (
    <PageScaffold>
      <PageSection title="工具权限" description="按 Agent 管理工具组、审批策略和路径白名单。">
        <div className="mb-4 flex items-center justify-between gap-3">
          <label className="flex items-center gap-2 rounded-lg border border-[var(--color-border-soft)] bg-[var(--color-surface-subtle)] px-3 py-2">
            <span className="text-xs font-semibold text-[var(--color-text-muted)]">Agent</span>
            <select
              value={selectedAgentId}
              onChange={(event) => setSelectedAgentId(event.target.value)}
              className="max-w-[260px] bg-transparent text-sm font-semibold text-[var(--color-text)] outline-none"
            >
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.config.name || agent.name} ({agent.id})
                </option>
              ))}
            </select>
          </label>
          <button
            onClick={() => void refresh()}
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
        <div className="grid gap-4 xl:grid-cols-4">
          <ToolClass icon={Search} title="Read" text="读取类工具默认低风险，但仍受 toolset 开关控制。" />
          <ToolClass icon={Lock} title="Write" text="写入类工具按 Agent 审批策略判断，路径白名单可免审。" />
          <ToolClass icon={Wrench} title="Memory" text="记忆读写通过 MemoryService 记录事件和证据。" />
          <ToolClass icon={ShieldCheck} title="Approval" text="审批记录持久化到 SQLite，并写入 Runtime Events。" />
        </div>
      </PageSection>

      <div className="mt-5 grid gap-5 xl:grid-cols-[1fr_1fr]">
        <PageSection title="Toolsets" description="关闭工具组后，该 Agent 运行时不会把组内工具暴露给模型。">
          <div className="space-y-3">
            {(data?.toolsets ?? []).map((toolset) => {
              const enabled = enabledToolsets.has(toolset.name);
              return (
                <div key={toolset.name} className="rounded-xl border border-[var(--color-border-soft)] bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-[var(--color-text)]">{toolset.name}</div>
                      <p className="mt-1 text-sm leading-6 text-[var(--color-text-muted)]">{toolset.description}</p>
                      <div className="mt-2 text-xs text-[var(--color-text-soft)]">
                        {toolset.tools.length} 个工具：{toolset.tools.join(", ") || "暂无"}
                      </div>
                    </div>
                    <button
                      onClick={() => toggleToolset(toolset.name, enabled)}
                      disabled={saving === `toolset-${toolset.name}`}
                      className={`rounded-lg px-3 py-2 text-xs font-semibold ${enabled ? "bg-[var(--color-success-soft)] text-[var(--color-success)]" : "bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]"}`}
                    >
                      {enabled ? "已启用" : "已停用"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </PageSection>

        <PageSection title="审批工具" description="这里配置哪些工具必须审批；读工具通常不需要审批。">
          <div className="space-y-2">
            {(data?.tools ?? []).map((tool) => {
              const required = approvalTools.has(tool.name);
              return (
                <div key={tool.name} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--color-border-soft)] bg-white px-3 py-2">
                  <div className="min-w-0">
                    <div className="truncate font-mono text-sm font-semibold text-[var(--color-text)]">{tool.name}</div>
                    <div className="text-xs text-[var(--color-text-soft)]">{tool.toolset} / {tool.category}</div>
                  </div>
                  <button
                    onClick={() => toggleApproval(tool.name, required)}
                    disabled={saving === `approval-${tool.name}`}
                    className={`shrink-0 rounded-lg px-3 py-2 text-xs font-semibold ${required ? "bg-[var(--color-warning-soft)] text-[var(--color-warning)]" : "bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]"}`}
                  >
                    {required ? "需要审批" : "无需审批"}
                  </button>
                </div>
              );
            })}
          </div>
        </PageSection>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
        <PageSection title="路径白名单" description="第一版只用于 write_file。路径写入当前 Agent 的 agent.json。">
          <div className="flex gap-2">
            <input
              value={pathInput}
              onChange={(event) => setPathInput(event.target.value)}
              placeholder="例如 README.md 或 docs/"
              className="min-w-0 flex-1 rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
            />
            <button
              onClick={addAllowedPath}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-accent)] px-3 py-2 text-sm font-semibold text-white hover:bg-[var(--color-accent-strong)]"
            >
              <Plus size={15} />
              添加
            </button>
          </div>
          <div className="mt-4 space-y-2">
            {(config?.allowedPaths ?? []).map((path) => (
              <div key={path} className="flex items-center justify-between gap-3 rounded-lg bg-[var(--color-surface-subtle)] px-3 py-2">
                <span className="min-w-0 break-all font-mono text-xs text-[var(--color-text-muted)]">{path}</span>
                <button
                  onClick={() => removeAllowedPath(path)}
                  className="shrink-0 text-[var(--color-danger)] hover:opacity-80"
                  title="移除路径"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
            {(config?.allowedPaths ?? []).length === 0 && (
              <div className="rounded-lg border border-dashed border-[var(--color-border)] py-8 text-center text-sm text-[var(--color-text-soft)]">
                暂无路径白名单。
              </div>
            )}
          </div>
        </PageSection>

        <PageSection title="最近审批" description="聊天内工具审批会在这里留下记录。">
          <div className="space-y-2">
            {approvals.map((approval) => (
              <div key={approval.id} className="rounded-lg border border-[var(--color-border-soft)] bg-white px-3 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-mono text-sm font-semibold text-[var(--color-text)]">{approval.toolName}</div>
                  <ApprovalStatus status={approval.status} />
                </div>
                <div className="mt-2 text-xs text-[var(--color-text-soft)]">
                  {approval.riskLevel} / {approval.reason} / {approval.channel ?? "web"} / {new Date(approval.createdAt).toLocaleString()}
                </div>
                <div className="mt-2 rounded bg-[var(--color-surface-subtle)] px-2 py-1 font-mono text-[11px] text-[var(--color-text-muted)]">
                  {Object.entries(approval.args).map(([key, value]) => `${key}: ${String(value)}`).join(" | ") || "无参数"}
                </div>
              </div>
            ))}
            {approvals.length === 0 && (
              <div className="rounded-lg border border-dashed border-[var(--color-border)] py-8 text-center text-sm text-[var(--color-text-soft)]">
                暂无审批记录。
              </div>
            )}
          </div>
        </PageSection>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-3">
        <InfoCard title="当前 Agent" description={selectedAgent?.config.name ?? selectedAgentId} meta={selectedAgentId} />
        <InfoCard title="启用工具组" description={config?.enabledToolsets.join(", ") || "未读取"} />
        <InfoCard title="强制审批" description={config?.requiresApproval.join(", ") || "无"} />
      </div>
    </PageScaffold>
  );
}

function ToolClass({ icon: Icon, title, text }: { icon: typeof Wrench; title: string; text: string }) {
  return (
    <div className="rounded-xl border border-[var(--color-border-soft)] bg-[var(--color-surface-subtle)] p-4">
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white text-[var(--color-accent)] shadow-sm">
        <Icon size={16} />
      </span>
      <div className="mt-4 text-sm font-semibold text-[var(--color-text)]">{title}</div>
      <p className="mt-2 text-sm leading-6 text-[var(--color-text-muted)]">{text}</p>
    </div>
  );
}

function ApprovalStatus({ status }: { status: ToolApprovalSummary["status"] }) {
  const className = status === "approved"
    ? "bg-[var(--color-success-soft)] text-[var(--color-success)]"
    : status === "denied"
      ? "bg-[var(--color-danger-soft)] text-[var(--color-danger)]"
      : "bg-[var(--color-warning-soft)] text-[var(--color-warning)]";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${className}`}>
      <CheckCircle2 size={12} />
      {status}
    </span>
  );
}
