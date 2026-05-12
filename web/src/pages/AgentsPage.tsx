import { useEffect, useMemo, useState } from "react";
import { Bot, CheckCircle2, Cpu, Folder, MessageSquarePlus, Plus, RefreshCw, ShieldCheck, Wrench } from "lucide-react";
import { useNavigate } from "react-router";
import { InfoCard, PageScaffold, PageSection } from "../components/common/PageScaffold";
import { useAgentStore } from "../store/agentStore";
import type { AgentStatus, CreateAgentInput } from "../types";

export default function AgentsPage() {
  const navigate = useNavigate();
  const { agents, selectedAgentId, loading, error, fetchAgents, createAgent, setSelectedAgentId } = useAgentStore();
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState<CreateAgentInput>({
    agentId: "researcher",
    name: "Researcher",
    description: "负责资料检索、整理和研究任务的 Agent。",
    workspacePath: "",
    model: { provider: "", model: "" },
  });

  useEffect(() => {
    void fetchAgents();
  }, [fetchAgents]);

  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.id === selectedAgentId) ?? agents[0] ?? null,
    [agents, selectedAgentId],
  );
  const enabledSkillCount = selectedAgent?.config.skills.enabledCount ?? 0;
  const disabledSkillCount = selectedAgent?.config.skills.disabledCount ?? 0;

  async function handleCreateAgent() {
    setCreating(true);
    setFormError(null);
    try {
      const input: CreateAgentInput = {
        agentId: form.agentId.trim(),
        name: form.name.trim(),
        description: form.description?.trim(),
        workspacePath: form.workspacePath?.trim(),
        model: {
          provider: form.model?.provider?.trim() || undefined,
          model: form.model?.model?.trim() || undefined,
        },
      };
      if (!input.agentId || !input.name) {
        throw new Error("请填写 agentId 和名称");
      }
      const created = await createAgent(input);
      setSelectedAgentId(created.id);
      setForm((current) => ({
        ...current,
        agentId: `${created.id}-next`,
        name: "",
        description: "",
      }));
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "创建 Agent 失败");
    } finally {
      setCreating(false);
    }
  }

  function startChat(agentId: string) {
    setSelectedAgentId(agentId);
    navigate("/");
  }

  return (
    <PageScaffold>
      <div className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
        <PageSection title="Agent 列表" description="每个 Agent 拥有独立 agent.json、skill 目录和 soul.md；会话创建后会绑定到指定 Agent。">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="text-sm text-[var(--color-text-muted)]">
              当前已注册 {agents.length} 个 Agent，选中：<span className="font-semibold text-[var(--color-text)]">{selectedAgentId}</span>
            </div>
            <button
              onClick={() => void fetchAgents()}
              className="inline-flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-white px-3 py-2 text-sm font-semibold text-[var(--color-text-muted)] hover:bg-[var(--color-surface-subtle)]"
            >
              <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
              刷新
            </button>
          </div>

          {error && (
            <div className="mb-4 rounded-lg bg-[var(--color-danger-soft)] px-3 py-2 text-sm text-[var(--color-danger)]">{error}</div>
          )}

          <div className="space-y-3">
            {agents.map((agent) => (
              <div
                key={agent.id}
                onClick={() => setSelectedAgentId(agent.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setSelectedAgentId(agent.id);
                  }
                }}
                role="button"
                tabIndex={0}
                className={`w-full rounded-xl border p-4 text-left transition-colors ${
                  agent.id === selectedAgentId
                    ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)]"
                    : "border-[var(--color-border-soft)] bg-white hover:bg-[var(--color-surface-subtle)]"
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white text-[var(--color-accent)] shadow-sm">
                        <Bot size={17} />
                      </span>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-[var(--color-text)]">
                          {agent.config.name || agent.name}
                        </div>
                        <div className="font-mono text-xs text-[var(--color-text-soft)]">{agent.id}</div>
                      </div>
                    </div>
                    <p className="mt-3 line-clamp-2 text-sm leading-6 text-[var(--color-text-muted)]">
                      {agent.config.description || "暂无描述"}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-[var(--color-text-soft)]">
                      <SmallTag icon={Cpu} text={`${agent.config.model.provider} / ${agent.config.model.model}`} />
                      <SmallTag icon={Wrench} text={`${agent.config.tools.enabledToolsets.length} 个工具组`} />
                      <SmallTag icon={Folder} text={agent.workspace_path || "未设置工作目录"} />
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-3">
                    <AgentStatusPill status={agent.status} />
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        startChat(agent.id);
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-accent)] px-3 py-2 text-xs font-semibold text-white hover:bg-[var(--color-accent-strong)]"
                    >
                      <MessageSquarePlus size={14} />
                      开始聊天
                    </button>
                  </div>
                </div>
              </div>
            ))}
            {agents.length === 0 && (
              <div className="rounded-xl border border-dashed border-[var(--color-border)] py-12 text-center text-sm text-[var(--color-text-soft)]">
                暂无 Agent，点击右侧表单创建。
              </div>
            )}
          </div>
        </PageSection>

        <PageSection title="创建 Agent" description="MVP 只创建独立运行 Agent，不实现 Agent 之间的任务委派。">
          <div className="space-y-3">
            <TextField label="agentId" value={form.agentId} onChange={(value) => setForm((s) => ({ ...s, agentId: value }))} />
            <TextField label="名称" value={form.name} onChange={(value) => setForm((s) => ({ ...s, name: value }))} />
            <label className="block">
              <span className="text-xs font-semibold text-[var(--color-text-muted)]">描述</span>
              <textarea
                value={form.description}
                onChange={(event) => setForm((s) => ({ ...s, description: event.target.value }))}
                rows={3}
                className="mt-1 w-full resize-none rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
              />
            </label>
            <TextField label="工作目录" value={form.workspacePath ?? ""} onChange={(value) => setForm((s) => ({ ...s, workspacePath: value }))} />
            <div className="grid gap-3 xl:grid-cols-2">
              <TextField
                label="模型提供方"
                value={form.model?.provider ?? ""}
                onChange={(value) => setForm((s) => ({ ...s, model: { ...s.model, provider: value } }))}
                placeholder="默认配置"
              />
              <TextField
                label="模型名称"
                value={form.model?.model ?? ""}
                onChange={(value) => setForm((s) => ({ ...s, model: { ...s.model, model: value } }))}
                placeholder="默认模型"
              />
            </div>
            {formError && (
              <div className="rounded-lg bg-[var(--color-danger-soft)] px-3 py-2 text-sm text-[var(--color-danger)]">{formError}</div>
            )}
            <button
              onClick={() => void handleCreateAgent()}
              disabled={creating}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--color-accent)] px-3 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[var(--color-accent-strong)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Plus size={16} />
              {creating ? "创建中" : "创建 Agent"}
            </button>
          </div>
        </PageSection>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-4">
        <InfoCard title="当前 Agent" description={selectedAgent?.config.name ?? selectedAgentId} meta={selectedAgent?.id ?? selectedAgentId} />
        <InfoCard title="Skill" description={`启用 ${enabledSkillCount} 个，停用 ${disabledSkillCount} 个。`} />
        <InfoCard title="工具组" description={selectedAgent?.config.tools.enabledToolsets.join(", ") || "未读取"} />
        <InfoCard title="审批策略" description={selectedAgent?.config.tools.requiresApproval.join(", ") || "无"} />
      </div>
    </PageScaffold>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-[var(--color-text-muted)]">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
      />
    </label>
  );
}

function SmallTag({ icon: Icon, text }: { icon: typeof Cpu; text: string }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-white px-2 py-1 shadow-sm">
      <Icon size={12} />
      <span className="truncate">{text}</span>
    </span>
  );
}

function AgentStatusPill({ status }: { status: AgentStatus }) {
  const config: Record<AgentStatus, { label: string; className: string; icon: typeof CheckCircle2 }> = {
    idle: { label: "空闲", className: "bg-[var(--color-success-soft)] text-[var(--color-success)]", icon: CheckCircle2 },
    running: { label: "运行中", className: "bg-[var(--color-warning-soft)] text-[var(--color-warning)]", icon: Cpu },
    paused: { label: "暂停", className: "bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]", icon: ShieldCheck },
    error: { label: "错误", className: "bg-[var(--color-danger-soft)] text-[var(--color-danger)]", icon: ShieldCheck },
  };
  const item = config[status];
  const Icon = item.icon;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${item.className}`}>
      <Icon size={12} />
      {item.label}
    </span>
  );
}
