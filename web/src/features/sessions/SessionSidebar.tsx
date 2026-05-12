import { useEffect } from "react";
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Clock3,
  History,
  MessageSquare,
  Plus,
  RefreshCw,
  Square,
  Trash2,
} from "lucide-react";
import { useSessionStore } from "../../store/sessionStore";
import {
  getCurrentTask,
  getQueuedTasks,
  getRuntimeEventView,
  useRuntimeStore,
  type RuntimeAgentStatus,
  type RuntimeTask,
} from "../../store/runtimeStore";

interface SessionSidebarProps {
  selectedAgentId: string;
  onLoadSession: (id: string) => Promise<void>;
  onNewSession: () => void;
}

export default function SessionSidebar({ selectedAgentId, onLoadSession, onNewSession }: SessionSidebarProps) {
  const {
    sessions,
    activeSessionId,
    fetchSessions,
    switchSession,
    deleteSession,
  } = useSessionStore();
  const {
    agent,
    tasks,
    events,
    loading,
    error,
    fetchRuntimeSnapshot,
    cancelTask,
    startPolling,
    stopPolling,
  } = useRuntimeStore();
  const currentTask = getCurrentTask(agent, tasks);
  const queuedTasks = getQueuedTasks(tasks);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  useEffect(() => {
    startPolling(2500, selectedAgentId);
    return () => stopPolling();
  }, [selectedAgentId, startPolling, stopPolling]);

  async function handleNew() {
    onNewSession();
  }

  async function handleSwitch(id: string) {
    if (id === activeSessionId) return;
    switchSession(id);
    try {
      await onLoadSession(id);
    } catch {
      useSessionStore.getState().setActiveSessionId(null);
      onNewSession();
    }
  }

  async function handleDelete(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    await deleteSession(id);
    if (id === activeSessionId) {
      onNewSession();
    }
  }

  function formatTime(ts: number): string {
    const d = new Date(ts);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
      });
    }
    return d.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
  }

  async function handleCancelTask(task: RuntimeTask) {
    await cancelTask(task.id, selectedAgentId);
  }

  return (
    <aside className="hidden h-full w-[280px] shrink-0 flex-col border-r border-[var(--color-border-soft)] bg-[#f3f5f8] md:flex">
      <div className="border-b border-[var(--color-border-soft)] px-4 py-4">
        <div className="mb-4 flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--color-accent)] text-white">
            <MessageSquare size={16} />
          </div>
          <div>
            <div className="text-sm font-semibold text-[var(--color-text)]">My Agent</div>
            <div className="text-xs text-[var(--color-text-soft)]">Local control UI</div>
          </div>
        </div>
        <button
          onClick={handleNew}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--color-accent)] px-3 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[var(--color-accent-strong)]"
        >
          <Plus size={16} />
          新对话
        </button>
      </div>

      <section className="border-b border-[var(--color-border-soft)] px-3 py-3">
        <div className="mb-2 flex items-center justify-between px-2">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-soft)]">Runtime</div>
          <button
            onClick={() => fetchRuntimeSnapshot(selectedAgentId)}
            className="rounded p-1 text-[var(--color-text-soft)] transition-colors hover:bg-white hover:text-[var(--color-text)]"
            title="刷新运行状态"
          >
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
        <div className="rounded-xl border border-[var(--color-border-soft)] bg-white p-3 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--color-surface-subtle)] text-[var(--color-accent)]">
                <Activity size={16} />
              </span>
              <div>
                <div className="text-sm font-semibold text-[var(--color-text)]">{agent?.name ?? "Default Agent"}</div>
                <div className="text-xs text-[var(--color-text-soft)]">agent_id: {agent?.id ?? "default"}</div>
              </div>
            </div>
            <AgentStatusPill status={agent?.status ?? "idle"} />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Metric label="当前任务" value={currentTask ? "1" : "0"} />
            <Metric label="队列" value={String(queuedTasks.length)} />
          </div>

          {currentTask ? (
            <div className="mt-3 rounded-lg bg-[var(--color-surface-subtle)] p-2">
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-[var(--color-text-muted)]">正在执行</span>
                <button
                  onClick={() => handleCancelTask(currentTask)}
                  className="rounded p-1 text-[var(--color-text-soft)] transition-colors hover:bg-white hover:text-[var(--color-danger)]"
                  title="取消任务"
                >
                  <Square size={12} />
                </button>
              </div>
              <p className="line-clamp-2 text-xs leading-5 text-[var(--color-text)]">{currentTask.input}</p>
            </div>
          ) : (
            <div className="mt-3 rounded-lg bg-[var(--color-surface-subtle)] p-2 text-xs text-[var(--color-text-soft)]">
              当前没有运行中的任务
            </div>
          )}

          {error && (
            <div className="mt-3 flex items-center gap-1.5 rounded-lg bg-[var(--color-danger-soft)] px-2 py-1.5 text-xs text-[var(--color-danger)]">
              <AlertCircle size={13} />
              {error}
            </div>
          )}
        </div>

        <div className="mt-3 rounded-xl border border-[var(--color-border-soft)] bg-white p-3 shadow-sm">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-[var(--color-text-muted)]">
            <History size={13} />
            最近事件
          </div>
          <div className="space-y-2">
            {events.slice(0, 5).map((event) => {
              const view = getRuntimeEventView(event);
              return (
                <div key={event.id} className="flex gap-2">
                  <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${eventToneClass(view.tone)}`} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium text-[var(--color-text)]">{view.label}</div>
                    <div className="truncate text-[11px] text-[var(--color-text-soft)]">{view.detail}</div>
                  </div>
                </div>
              );
            })}
            {events.length === 0 && (
              <div className="text-xs text-[var(--color-text-soft)]">暂无 runtime 事件</div>
            )}
          </div>
        </div>
      </section>

      <div className="flex items-center justify-between px-4 pb-2 pt-4">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-soft)]">Chat</div>
        <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-[var(--color-text-soft)]">{sessions.length}</span>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-3">
        {sessions.map((s) => (
          <div
            key={s.id}
            onClick={() => handleSwitch(s.id)}
            className={`group mb-1 flex cursor-pointer items-center justify-between rounded-lg px-3 py-2.5 text-sm transition-colors ${
              s.id === activeSessionId
                ? "bg-white text-[var(--color-text)] shadow-sm ring-1 ring-[var(--color-border-soft)]"
                : "text-[var(--color-text-muted)] hover:bg-white/70 hover:text-[var(--color-text)]"
            }`}
          >
            <span className="min-w-0 flex-1 truncate font-medium">{s.title}</span>
            <span className="ml-2 shrink-0 rounded-full bg-[var(--color-surface-subtle)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--color-text-soft)]">
              {s.agent_id}
            </span>
            <span className="ml-2 mr-1 shrink-0 text-xs text-[var(--color-text-soft)]">
              {formatTime(s.updated_at)}
            </span>
            <button
              onClick={(e) => handleDelete(e, s.id)}
              className="hidden shrink-0 rounded p-1 text-[var(--color-text-soft)] hover:bg-[var(--color-danger-soft)] hover:text-[var(--color-danger)] group-hover:block"
              title="删除"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
    </aside>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-[var(--color-surface-subtle)] px-2 py-2">
      <div className="text-[11px] text-[var(--color-text-soft)]">{label}</div>
      <div className="text-base font-semibold text-[var(--color-text)]">{value}</div>
    </div>
  );
}

function AgentStatusPill({ status }: { status: RuntimeAgentStatus }) {
  const config: Record<RuntimeAgentStatus, { label: string; className: string; icon: typeof CheckCircle2 }> = {
    idle: { label: "空闲", className: "bg-[var(--color-success-soft)] text-[var(--color-success)]", icon: CheckCircle2 },
    running: { label: "运行中", className: "bg-[var(--color-warning-soft)] text-[var(--color-warning)]", icon: Clock3 },
    paused: { label: "暂停", className: "bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]", icon: Clock3 },
    error: { label: "错误", className: "bg-[var(--color-danger-soft)] text-[var(--color-danger)]", icon: AlertCircle },
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

function eventToneClass(tone: "task" | "tool" | "memory" | "error" | "neutral"): string {
  if (tone === "tool") return "bg-[var(--color-accent)]";
  if (tone === "memory") return "bg-[var(--color-success)]";
  if (tone === "error") return "bg-[var(--color-danger)]";
  if (tone === "task") return "bg-[var(--color-warning)]";
  return "bg-[var(--color-text-soft)]";
}
