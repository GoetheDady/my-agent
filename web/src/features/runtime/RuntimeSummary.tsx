import { useEffect } from "react";
import { Activity, AlertCircle, CheckCircle2, Clock3, History, RefreshCw, Square } from "lucide-react";
import {
  getCurrentTask,
  getQueuedTasks,
  getRuntimeEventView,
  useRuntimeStore,
  type RuntimeAgentStatus,
  type RuntimeTask,
} from "../../store/runtimeStore";

export function RuntimeSummary({ mode = "tasks" }: { mode?: "tasks" | "events" }) {
  const {
    agent,
    tasks,
    events,
    loading,
    error,
    fetchRuntimeSnapshot,
    cancelTask,
  } = useRuntimeStore();
  const currentTask = getCurrentTask(agent, tasks);
  const queuedTasks = getQueuedTasks(tasks);

  useEffect(() => {
    void fetchRuntimeSnapshot();
  }, [fetchRuntimeSnapshot]);

  return (
    <div className="grid gap-5 xl:grid-cols-[0.85fr_1.15fr]">
      <section className="rounded-xl border border-[var(--color-border-soft)] bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-[var(--color-border-soft)] px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-[var(--color-text)]">Runtime Snapshot</h2>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">当前 Agent 状态、任务队列和错误信息。</p>
          </div>
          <button
            onClick={() => fetchRuntimeSnapshot()}
            className="rounded-lg p-2 text-[var(--color-text-soft)] transition-colors hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text)]"
            title="刷新运行状态"
          >
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
        <div className="p-5">
          <div className="rounded-xl border border-[var(--color-border-soft)] bg-[var(--color-surface-subtle)] p-4">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-white text-[var(--color-accent)] shadow-sm">
                  <Activity size={18} />
                </span>
                <div>
                  <div className="text-sm font-semibold text-[var(--color-text)]">{agent?.name ?? "Default Agent"}</div>
                  <div className="text-xs text-[var(--color-text-soft)]">agent_id: {agent?.id ?? "default"}</div>
                </div>
              </div>
              <AgentStatusPill status={agent?.status ?? "idle"} />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Metric label="当前任务" value={currentTask ? "1" : "0"} />
              <Metric label="排队" value={String(queuedTasks.length)} />
              <Metric label="事件" value={String(events.length)} />
            </div>
            {error && (
              <div className="mt-3 flex items-center gap-1.5 rounded-lg bg-[var(--color-danger-soft)] px-3 py-2 text-sm text-[var(--color-danger)]">
                <AlertCircle size={14} />
                {error}
              </div>
            )}
          </div>

          <div className="mt-4">
            <h3 className="mb-2 text-sm font-semibold text-[var(--color-text)]">正在执行</h3>
            {currentTask ? (
              <TaskCard task={currentTask} onCancel={() => cancelTask(currentTask.id)} />
            ) : (
              <div className="rounded-lg border border-[var(--color-border-soft)] bg-[var(--color-surface-subtle)] px-4 py-3 text-sm text-[var(--color-text-soft)]">
                当前没有运行中的任务
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-[var(--color-border-soft)] bg-white shadow-sm">
        <div className="border-b border-[var(--color-border-soft)] px-5 py-4">
          <h2 className="text-base font-semibold text-[var(--color-text)]">
            {mode === "events" ? "Runtime Events" : "Task Queue"}
          </h2>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            {mode === "events" ? "最近的 task、tool、memory、profile、dream 事件。" : "排队任务和最近任务。"}
          </p>
        </div>
        <div className="max-h-[calc(100vh-190px)] overflow-y-auto p-5">
          {mode === "events" ? (
            <EventList events={events} />
          ) : (
            <TaskList tasks={tasks} queuedTasks={queuedTasks} onCancel={cancelTask} />
          )}
        </div>
      </section>
    </div>
  );
}

function TaskList({
  tasks,
  queuedTasks,
  onCancel,
}: {
  tasks: RuntimeTask[];
  queuedTasks: RuntimeTask[];
  onCancel: (taskId: string) => Promise<void>;
}) {
  const visibleTasks = queuedTasks.length > 0 ? queuedTasks : tasks.slice(0, 12);
  if (visibleTasks.length === 0) {
    return <EmptyState text="暂无任务记录" />;
  }
  return (
    <div className="space-y-3">
      {visibleTasks.map((task) => (
        <TaskCard key={task.id} task={task} onCancel={task.status === "queued" ? () => onCancel(task.id) : undefined} />
      ))}
    </div>
  );
}

function EventList({ events }: { events: ReturnType<typeof useRuntimeStore.getState>["events"] }) {
  if (events.length === 0) return <EmptyState text="暂无 runtime 事件" />;
  return (
    <div className="space-y-3">
      {events.map((event) => {
        const view = getRuntimeEventView(event);
        return (
          <div key={event.id} className="rounded-lg border border-[var(--color-border-soft)] bg-[var(--color-surface-subtle)] p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <span className={`h-2 w-2 shrink-0 rounded-full ${eventToneClass(view.tone)}`} />
                <span className="truncate text-sm font-semibold text-[var(--color-text)]">{view.label}</span>
              </div>
              <span className="shrink-0 text-xs text-[var(--color-text-soft)]">{formatTime(event.created_at)}</span>
            </div>
            <div className="mt-1 truncate text-sm text-[var(--color-text-muted)]">{view.detail}</div>
            <div className="mt-2 font-mono text-[11px] text-[var(--color-text-soft)]">{event.type}</div>
          </div>
        );
      })}
    </div>
  );
}

function TaskCard({ task, onCancel }: { task: RuntimeTask; onCancel?: () => void }) {
  return (
    <div className="rounded-lg border border-[var(--color-border-soft)] bg-[var(--color-surface-subtle)] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${taskStatusClass(task.status)}`}>
              {taskStatusLabel(task.status)}
            </span>
            <span className="font-mono text-xs text-[var(--color-text-soft)]">{task.id.slice(0, 8)}</span>
          </div>
          <p className="mt-2 line-clamp-2 text-sm leading-6 text-[var(--color-text)]">{task.input}</p>
        </div>
        {onCancel && (
          <button
            onClick={onCancel}
            className="rounded-md p-1.5 text-[var(--color-text-soft)] transition-colors hover:bg-white hover:text-[var(--color-danger)]"
            title="取消任务"
          >
            <Square size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white px-3 py-2 shadow-sm">
      <div className="text-[11px] text-[var(--color-text-soft)]">{label}</div>
      <div className="mt-1 text-base font-semibold text-[var(--color-text)]">{value}</div>
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

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex items-center justify-center rounded-lg border border-dashed border-[var(--color-border)] py-12 text-sm text-[var(--color-text-soft)]">
      <History size={16} className="mr-2" />
      {text}
    </div>
  );
}

function eventToneClass(tone: "task" | "tool" | "memory" | "error" | "neutral") {
  const classes = {
    task: "bg-[var(--color-accent)]",
    tool: "bg-[#7c5cff]",
    memory: "bg-[var(--color-success)]",
    error: "bg-[var(--color-danger)]",
    neutral: "bg-[var(--color-text-soft)]",
  };
  return classes[tone];
}

function taskStatusLabel(status: RuntimeTask["status"]) {
  const labels: Record<RuntimeTask["status"], string> = {
    queued: "排队",
    running: "运行中",
    completed: "完成",
    failed: "失败",
    canceled: "已取消",
  };
  return labels[status];
}

function taskStatusClass(status: RuntimeTask["status"]) {
  const classes: Record<RuntimeTask["status"], string> = {
    queued: "bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]",
    running: "bg-[var(--color-warning-soft)] text-[var(--color-warning)]",
    completed: "bg-[var(--color-success-soft)] text-[var(--color-success)]",
    failed: "bg-[var(--color-danger-soft)] text-[var(--color-danger)]",
    canceled: "bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]",
  };
  return classes[status];
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
