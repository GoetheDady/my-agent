import { useEffect, useMemo, useState, type ReactNode } from "react";
import { QRCodeCanvas } from "qrcode.react";
import { Cable, CheckCircle2, Copy, PauseCircle, PlayCircle, Plus, QrCode, RefreshCw, Send, Smartphone, Trash2 } from "lucide-react";
import { InfoCard, PageScaffold, PageSection } from "../components/common/PageScaffold";
import { useAgentStore } from "../store/agentStore";
import type { ChannelSummary, FeishuBindingSummary, FeishuOnboardingState } from "../types";

type Domain = "feishu" | "lark";

interface ManualBindingForm {
  appId: string;
  appSecret: string;
  agentId: string;
  domain: Domain;
}

export default function ChannelsPage() {
  const { agents, selectedAgentId, fetchAgents, setSelectedAgentId } = useAgentStore();
  const [channels, setChannels] = useState<ChannelSummary[]>([]);
  const [bindings, setBindings] = useState<FeishuBindingSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [onboarding, setOnboarding] = useState<FeishuOnboardingState | null>(null);
  const [domain, setDomain] = useState<Domain>("feishu");
  const [manualForm, setManualForm] = useState<ManualBindingForm>({
    appId: "",
    appSecret: "",
    agentId: selectedAgentId,
    domain: "feishu",
  });

  useEffect(() => {
    void fetchAgents();
    void refreshChannels();
  }, [fetchAgents]);

  useEffect(() => {
    setManualForm((current) => ({ ...current, agentId: selectedAgentId }));
  }, [selectedAgentId]);

  useEffect(() => {
    if (!onboarding || onboarding.status !== "pending") return;
    const timer = window.setInterval(() => {
      void pollOnboarding(onboarding.onboardingId);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [onboarding?.onboardingId, onboarding?.status]);

  const feishuSummary = useMemo(
    () => channels.find((channel) => channel.id === "feishu"),
    [channels],
  );
  const selectedAgentName = agents.find((agent) => agent.id === selectedAgentId)?.config.name ?? selectedAgentId;

  async function refreshChannels() {
    setLoading(true);
    setError(null);
    try {
      const [channelsRes, bindingsRes] = await Promise.all([
        fetch("/api/channels"),
        fetch("/api/channels/feishu/bindings"),
      ]);
      if (!channelsRes.ok) throw new Error("读取渠道状态失败");
      if (!bindingsRes.ok) throw new Error("读取飞书绑定失败");
      const channelsData = await channelsRes.json() as { channels: ChannelSummary[] };
      const bindingsData = await bindingsRes.json() as { bindings: FeishuBindingSummary[] };
      setChannels(channelsData.channels ?? []);
      setBindings(bindingsData.bindings ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "读取渠道状态失败");
    } finally {
      setLoading(false);
    }
  }

  async function startOnboarding() {
    setActionLoading("onboarding");
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/channels/feishu/onboarding/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agentId: selectedAgentId, domain }),
      });
      const data = await res.json() as FeishuOnboardingState | { error?: string };
      if (!res.ok) throw new Error("error" in data ? data.error : "生成飞书二维码失败");
      setOnboarding(data as FeishuOnboardingState);
      setNotice("二维码已生成，请用飞书手机端扫码确认。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "生成飞书二维码失败");
    } finally {
      setActionLoading(null);
    }
  }

  async function pollOnboarding(onboardingId: string) {
    try {
      const res = await fetch(`/api/channels/feishu/onboarding/${encodeURIComponent(onboardingId)}/status`);
      const data = await res.json() as FeishuOnboardingState | { error?: string };
      if (!res.ok) throw new Error("error" in data ? data.error : "读取扫码状态失败");
      const next = data as FeishuOnboardingState;
      setOnboarding(next);
      if (next.status === "succeeded") {
        setNotice("飞书机器人已创建并绑定，WebSocket 正在启动。");
        await refreshChannels();
      }
      if (next.status === "failed" || next.status === "expired" || next.status === "canceled") {
        setNotice(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "读取扫码状态失败");
    }
  }

  async function cancelOnboarding() {
    if (!onboarding) return;
    setActionLoading("cancel-onboarding");
    try {
      const res = await fetch(`/api/channels/feishu/onboarding/${encodeURIComponent(onboarding.onboardingId)}/cancel`, {
        method: "POST",
      });
      const data = await res.json() as FeishuOnboardingState | { error?: string };
      if (!res.ok) throw new Error("error" in data ? data.error : "取消扫码失败");
      setOnboarding(data as FeishuOnboardingState);
      setNotice("已取消本次扫码。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "取消扫码失败");
    } finally {
      setActionLoading(null);
    }
  }

  async function createManualBinding() {
    setActionLoading("manual");
    setError(null);
    setNotice(null);
    try {
      if (!manualForm.appId.trim() || !manualForm.appSecret.trim()) {
        throw new Error("请填写 App ID 和 App Secret");
      }
      const res = await fetch("/api/channels/feishu/bindings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(manualForm),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "手动绑定失败");
      setManualForm((current) => ({ ...current, appId: "", appSecret: "" }));
      setNotice("飞书 App 已手动绑定。");
      await refreshChannels();
    } catch (err) {
      setError(err instanceof Error ? err.message : "手动绑定失败");
    } finally {
      setActionLoading(null);
    }
  }

  async function patchBinding(binding: FeishuBindingSummary, patch: Partial<Pick<FeishuBindingSummary, "enabled" | "agentId" | "domain">>) {
    setActionLoading(`patch-${binding.appId}`);
    setError(null);
    try {
      const res = await fetch(`/api/channels/feishu/bindings/${encodeURIComponent(binding.appId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "更新飞书绑定失败");
      setNotice("飞书绑定已更新。");
      await refreshChannels();
    } catch (err) {
      setError(err instanceof Error ? err.message : "更新飞书绑定失败");
    } finally {
      setActionLoading(null);
    }
  }

  async function deleteBinding(binding: FeishuBindingSummary) {
    const confirmed = window.confirm(`删除飞书绑定 ${binding.appId}？这只会删除本地绑定，不会删除飞书开放平台应用。`);
    if (!confirmed) return;
    setActionLoading(`delete-${binding.appId}`);
    setError(null);
    try {
      const res = await fetch(`/api/channels/feishu/bindings/${encodeURIComponent(binding.appId)}`, {
        method: "DELETE",
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "删除飞书绑定失败");
      setNotice("飞书绑定已删除。");
      await refreshChannels();
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除飞书绑定失败");
    } finally {
      setActionLoading(null);
    }
  }

  function copyQrUrl() {
    if (!onboarding?.qrUrl) return;
    void navigator.clipboard.writeText(onboarding.qrUrl);
    setNotice("扫码链接已复制。");
  }

  return (
    <PageScaffold>
      <PageSection title="渠道入口" description="Channel 会把外部消息统一转换成内部 conversation、task 和 runtime events。">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="text-sm text-[var(--color-text-muted)]">
            当前 Agent：<span className="font-semibold text-[var(--color-text)]">{selectedAgentName}</span>
          </div>
          <button
            onClick={() => void refreshChannels()}
            className="inline-flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-white px-3 py-2 text-sm font-semibold text-[var(--color-text-muted)] hover:bg-[var(--color-surface-subtle)]"
          >
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
            刷新
          </button>
        </div>
        <div className="grid gap-4 xl:grid-cols-3">
          <ChannelCard icon={Cable} title="Web" status="已启用" description="当前控制台聊天入口，Web 出站仍通过 HTTP stream 返回。" />
          <ChannelCard
            icon={Send}
            title="Feishu"
            status={feishuSummary?.bindingCount ? "已配置" : "待配置"}
            description={`WebSocket 长连接，绑定 ${feishuSummary?.bindingCount ?? 0} 个，运行 ${feishuSummary?.runningCount ?? 0} 个。`}
          />
          <ChannelCard icon={Smartphone} title="WeChat" status="预留" description="MVP 暂不接真实微信 SDK，只保留渠道边界。" />
        </div>
      </PageSection>

      {(error || notice) && (
        <div className={`mt-5 rounded-xl px-4 py-3 text-sm ${error ? "bg-[var(--color-danger-soft)] text-[var(--color-danger)]" : "bg-[var(--color-success-soft)] text-[var(--color-success)]"}`}>
          {error ?? notice}
        </div>
      )}

      <div className="mt-5 grid gap-5 xl:grid-cols-[1fr_0.95fr]">
        <PageSection title="扫码创建飞书机器人" description="选择目标 Agent 后生成二维码，扫码成功会把新机器人绑定到该 Agent。">
          <div className="grid gap-4 xl:grid-cols-[280px_1fr]">
            <div className="rounded-xl border border-[var(--color-border-soft)] bg-[var(--color-surface-subtle)] p-4">
              {onboarding?.status === "pending" ? (
                <div className="rounded-lg bg-white p-3 shadow-sm">
                  <QRCodeCanvas value={onboarding.qrUrl} size={230} includeMargin />
                </div>
              ) : (
                <div className="flex h-[262px] items-center justify-center rounded-lg border border-dashed border-[var(--color-border)] bg-white text-[var(--color-text-soft)]">
                  <QrCode size={40} />
                </div>
              )}
            </div>
            <div className="space-y-3">
              <SelectField label="目标 Agent" value={selectedAgentId} onChange={setSelectedAgentId}>
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>{agent.config.name || agent.name} ({agent.id})</option>
                ))}
              </SelectField>
              <SelectField label="飞书域名" value={domain} onChange={(value) => setDomain(value as Domain)}>
                <option value="feishu">飞书中国区</option>
                <option value="lark">Lark 国际区</option>
              </SelectField>
              <div className="flex gap-2">
                <button
                  onClick={() => void startOnboarding()}
                  disabled={actionLoading === "onboarding"}
                  className="inline-flex items-center gap-2 rounded-lg bg-[var(--color-accent)] px-3 py-2 text-sm font-semibold text-white hover:bg-[var(--color-accent-strong)] disabled:opacity-60"
                >
                  <QrCode size={16} />
                  {actionLoading === "onboarding" ? "生成中" : "生成二维码"}
                </button>
                {onboarding?.status === "pending" && (
                  <button
                    onClick={() => void cancelOnboarding()}
                    className="rounded-lg border border-[var(--color-border)] bg-white px-3 py-2 text-sm font-semibold text-[var(--color-text-muted)] hover:bg-[var(--color-surface-subtle)]"
                  >
                    取消
                  </button>
                )}
              </div>
              {onboarding && (
                <div className="rounded-lg border border-[var(--color-border-soft)] bg-white p-3 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-semibold text-[var(--color-text)]">扫码状态：{statusLabel(onboarding.status)}</span>
                    {onboarding.status === "pending" && <span className="text-xs text-[var(--color-text-soft)]">自动轮询中</span>}
                  </div>
                  <div className="mt-2 font-mono text-xs text-[var(--color-text-soft)]">Code: {onboarding.userCode || "无"}</div>
                  {onboarding.error && <div className="mt-2 text-[var(--color-danger)]">{onboarding.error}</div>}
                  <button
                    onClick={copyQrUrl}
                    className="mt-3 inline-flex max-w-full items-center gap-2 rounded-lg bg-[var(--color-surface-subtle)] px-3 py-2 text-xs font-semibold text-[var(--color-text-muted)] hover:bg-[var(--color-surface-muted)]"
                  >
                    <Copy size={14} />
                    <span className="truncate">复制扫码链接</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </PageSection>

        <PageSection title="手动绑定" description="已有飞书 App 时可直接填写 App ID / Secret，作为扫码失败时的备用入口。">
          <div className="space-y-3">
            <TextField label="App ID" value={manualForm.appId} onChange={(value) => setManualForm((s) => ({ ...s, appId: value }))} />
            <TextField label="App Secret" type="password" value={manualForm.appSecret} onChange={(value) => setManualForm((s) => ({ ...s, appSecret: value }))} />
            <SelectField label="绑定 Agent" value={manualForm.agentId} onChange={(value) => setManualForm((s) => ({ ...s, agentId: value }))}>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>{agent.config.name || agent.name} ({agent.id})</option>
              ))}
            </SelectField>
            <SelectField label="飞书域名" value={manualForm.domain} onChange={(value) => setManualForm((s) => ({ ...s, domain: value as Domain }))}>
              <option value="feishu">飞书中国区</option>
              <option value="lark">Lark 国际区</option>
            </SelectField>
            <button
              onClick={() => void createManualBinding()}
              disabled={actionLoading === "manual"}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--color-accent)] px-3 py-2.5 text-sm font-semibold text-white hover:bg-[var(--color-accent-strong)] disabled:opacity-60"
            >
              <Plus size={16} />
              {actionLoading === "manual" ? "绑定中" : "绑定飞书 App"}
            </button>
          </div>
        </PageSection>
      </div>

      <div className="mt-5">
        <PageSection title="飞书绑定" description="绑定保存在对应 Agent 的 agent.json 中；App Secret 不会在页面或 API 中明文返回。">
          <div className="space-y-3">
            {bindings.map((binding) => (
              <BindingRow
                key={binding.appId}
                binding={binding}
                agents={agents}
                loading={actionLoading === `patch-${binding.appId}` || actionLoading === `delete-${binding.appId}`}
                onPatch={(patch) => void patchBinding(binding, patch)}
                onDelete={() => void deleteBinding(binding)}
              />
            ))}
            {bindings.length === 0 && (
              <div className="rounded-xl border border-dashed border-[var(--color-border)] py-12 text-center text-sm text-[var(--color-text-soft)]">
                还没有飞书绑定。可以扫码创建机器人，或手动填入已有 App 凭据。
              </div>
            )}
          </div>
        </PageSection>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-3">
        <InfoCard title="配置来源" description="飞书绑定只写入目标 Agent 的 agent.json，不再使用独立 feishu-bindings.json。" />
        <InfoCard title="连接方式" description="飞书使用 WebSocket 长连接，因此不需要公网事件回调 URL。" />
        <InfoCard title="审计事件" description="扫码、绑定、启停和删除都会写入 Runtime Events。" />
      </div>
    </PageScaffold>
  );
}

function ChannelCard({ icon: Icon, title, status, description }: { icon: typeof Cable; title: string; status: string; description: string }) {
  return (
    <div className="rounded-xl border border-[var(--color-border-soft)] bg-[var(--color-surface-subtle)] p-5">
      <div className="flex items-center justify-between">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-white text-[var(--color-accent)] shadow-sm">
          <Icon size={18} />
        </span>
        <span className="rounded-md bg-white px-2 py-1 text-xs font-semibold text-[var(--color-text-muted)] shadow-sm">{status}</span>
      </div>
      <div className="mt-4 text-sm font-semibold text-[var(--color-text)]">{title}</div>
      <p className="mt-2 text-sm leading-6 text-[var(--color-text-muted)]">{description}</p>
    </div>
  );
}

function BindingRow({
  binding,
  agents,
  loading,
  onPatch,
  onDelete,
}: {
  binding: FeishuBindingSummary;
  agents: ReturnType<typeof useAgentStore.getState>["agents"];
  loading: boolean;
  onPatch: (patch: Partial<Pick<FeishuBindingSummary, "enabled" | "agentId" | "domain">>) => void;
  onDelete: () => void;
}) {
  return (
    <div className="rounded-xl border border-[var(--color-border-soft)] bg-white p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-semibold text-[var(--color-text)]">{binding.appId}</span>
            <StatusPill running={binding.websocketStatus === "running"} enabled={binding.enabled} />
            {binding.botName && <span className="rounded-full bg-[var(--color-accent-soft)] px-2 py-1 text-xs font-semibold text-[var(--color-accent)]">{binding.botName}</span>}
          </div>
          <div className="mt-2 flex flex-wrap gap-2 text-xs text-[var(--color-text-soft)]">
            <span>Agent: {binding.agentId}</span>
            <span>Domain: {binding.domain}</span>
            <span>Secret: {binding.hasAppSecret ? "已保存" : "缺失"}</span>
            <span>Updated: {new Date(binding.updatedAt).toLocaleString()}</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={() => onPatch({ enabled: !binding.enabled })}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-white px-3 py-2 text-xs font-semibold text-[var(--color-text-muted)] hover:bg-[var(--color-surface-subtle)] disabled:opacity-60"
          >
            {binding.enabled ? <PauseCircle size={14} /> : <PlayCircle size={14} />}
            {binding.enabled ? "停用" : "启用"}
          </button>
          <button
            onClick={onDelete}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-white px-3 py-2 text-xs font-semibold text-[var(--color-danger)] hover:bg-[var(--color-danger-soft)] disabled:opacity-60"
          >
            <Trash2 size={14} />
            删除
          </button>
        </div>
      </div>
      <div className="mt-3 grid gap-3 xl:grid-cols-2">
        <SelectField label="改绑 Agent" value={binding.agentId} onChange={(value) => onPatch({ agentId: value })}>
          {agents.map((agent) => (
            <option key={agent.id} value={agent.id}>{agent.config.name || agent.name} ({agent.id})</option>
          ))}
        </SelectField>
        <SelectField label="域名" value={binding.domain} onChange={(value) => onPatch({ domain: value as Domain })}>
          <option value="feishu">飞书中国区</option>
          <option value="lark">Lark 国际区</option>
        </SelectField>
      </div>
    </div>
  );
}

function StatusPill({ running, enabled }: { running: boolean; enabled: boolean }) {
  if (!enabled) {
    return <span className="rounded-full bg-[var(--color-surface-muted)] px-2 py-1 text-xs font-semibold text-[var(--color-text-muted)]">已停用</span>;
  }
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold ${running ? "bg-[var(--color-success-soft)] text-[var(--color-success)]" : "bg-[var(--color-warning-soft)] text-[var(--color-warning)]"}`}>
      <CheckCircle2 size={12} />
      {running ? "WebSocket 运行中" : "待连接"}
    </span>
  );
}

function TextField({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-[var(--color-text-muted)]">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-[var(--color-text-muted)]">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
      >
        {children}
      </select>
    </label>
  );
}

function statusLabel(status: FeishuOnboardingState["status"]): string {
  const labels: Record<FeishuOnboardingState["status"], string> = {
    pending: "等待扫码",
    succeeded: "已绑定",
    failed: "失败",
    expired: "已过期",
    canceled: "已取消",
  };
  return labels[status];
}
