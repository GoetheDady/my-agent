import { useEffect } from "react";
import { Activity, AlertCircle, CheckCircle2, Clock3, History, RefreshCw, Square, X } from "lucide-react";
import {
  getCurrentTask,
  getQueuedTasks,
  getRuntimeEventView,
  getTaskStatusDetail,
  getWatchdogNotice,
  useRuntimeStore,
  type RuntimeAgentStatus,
  type RuntimeTask,
  type RuntimeTaskTimelineItem,
  type RuntimeTaskTimelineResponse,
  type RuntimeTaskTimelineTone,
} from "../../store/runtimeStore";
import { useAgentStore } from "../../store/agentStore";

export function RuntimeSummary({ mode = "tasks" }: { mode?: "tasks" | "events" }) {
  const selectedAgentId = useAgentStore((s) => s.selectedAgentId);
  const {
    agent,
    tasks,
    events,
    selectedTaskId,
    selectedTaskTimeline,
    taskTimelineLoading,
    taskTimelineError,
    dismissedWatchdogEventIds,
    loading,
    error,
    fetchRuntimeSnapshot,
    selectTask,
    clearSelectedTask,
    dismissWatchdogNotice,
    cancelTask,
  } = useRuntimeStore();
  const currentTask = getCurrentTask(agent, tasks);
  const queuedTasks = getQueuedTasks(tasks);
  const watchdogNotice = getWatchdogNotice(events, new Set(dismissedWatchdogEventIds));

  useEffect(() => {
    void fetchRuntimeSnapshot(selectedAgentId);
  }, [fetchRuntimeSnapshot, selectedAgentId]);

  return (
    <div className="grid gap-5 xl:grid-cols-[0.85fr_1.15fr]">
      <section className="rounded-xl border border-[var(--color-border-soft)] bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-[var(--color-border-soft)] px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-[var(--color-text)]">Runtime Snapshot</h2>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">当前 Agent 状态、任务队列和错误信息。</p>
          </div>
          <button
            onClick={() => fetchRuntimeSnapshot(selectedAgentId)}
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
            {watchdogNotice && (
              <div
                className={`mt-3 flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left text-sm ${
                watchdogNotice.tone === "error"
                  ? "bg-[var(--color-danger-soft)] text-[var(--color-danger)]"
                  : "bg-[var(--color-warning-soft)] text-[var(--color-warning)]"
              }`}
              >
                <AlertCircle size={14} className="mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <div className="font-semibold">{watchdogNotice.title}</div>
                    <button
                      type="button"
                      onClick={() => dismissWatchdogNotice(watchdogNotice.eventIds)}
                      className="rounded-md bg-white/55 p-1 transition-opacity hover:opacity-80"
                      title="忽略这条提醒"
                    >
                      <X size={13} />
                    </button>
                  </div>
                  <div className="mt-0.5 leading-5">{watchdogNotice.detail}</div>
                  {watchdogNotice.items && watchdogNotice.items.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {watchdogNotice.items.slice(0, 4).map((item, index) => (
                        <button
                          key={`${item.taskId ?? item.reason}-${index}`}
                          type="button"
                          onClick={() => item.taskId && void selectTask(item.taskId)}
                          disabled={!item.taskId}
                          className="block max-w-full truncate rounded-md bg-white/55 px-2 py-1 text-left text-xs transition-opacity enabled:hover:opacity-80 disabled:cursor-default"
                          title={item.taskId ? `${item.detail}: ${item.taskId}` : item.detail}
                        >
                          {item.detail}{item.taskId ? ` · ${item.taskId.slice(0, 8)}` : ""}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="mt-4">
            <h3 className="mb-2 text-sm font-semibold text-[var(--color-text)]">正在执行</h3>
            {currentTask ? (
              <TaskCard
                task={currentTask}
                selected={selectedTaskId === currentTask.id}
                onSelect={() => void selectTask(currentTask.id)}
                onCancel={() => cancelTask(currentTask.id, selectedAgentId)}
              />
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
            <TaskWorkspace
              tasks={tasks}
              queuedTasks={queuedTasks}
              agentId={selectedAgentId}
              selectedTaskId={selectedTaskId}
              selectedTimeline={selectedTaskTimeline}
              loading={taskTimelineLoading}
              error={taskTimelineError}
              onSelect={(taskId) => void selectTask(taskId)}
              onClear={clearSelectedTask}
              onCancel={cancelTask}
            />
          )}
        </div>
      </section>
    </div>
  );
}

function TaskWorkspace({
  tasks,
  queuedTasks,
  agentId,
  selectedTaskId,
  selectedTimeline,
  loading,
  error,
  onSelect,
  onClear,
  onCancel,
}: {
  tasks: RuntimeTask[];
  queuedTasks: RuntimeTask[];
  agentId: string;
  selectedTaskId: string | null;
  selectedTimeline: RuntimeTaskTimelineResponse | null;
  loading: boolean;
  error: string | null;
  onSelect: (taskId: string) => void;
  onClear: () => void;
  onCancel: (taskId: string, agentId?: string) => Promise<void>;
}) {
  return (
    <div className="grid gap-4 2xl:grid-cols-[0.92fr_1.08fr]">
      <TaskList
        tasks={tasks}
        queuedTasks={queuedTasks}
        agentId={agentId}
        selectedTaskId={selectedTaskId}
        onSelect={onSelect}
        onCancel={onCancel}
      />
      <TaskDetailPanel
        timeline={selectedTimeline}
        loading={loading}
        error={error}
        onClear={onClear}
      />
    </div>
  );
}

function TaskList({
  tasks,
  queuedTasks,
  agentId,
  selectedTaskId,
  onSelect,
  onCancel,
}: {
  tasks: RuntimeTask[];
  queuedTasks: RuntimeTask[];
  agentId: string;
  selectedTaskId: string | null;
  onSelect: (taskId: string) => void;
  onCancel: (taskId: string, agentId?: string) => Promise<void>;
}) {
  const historyTasks = [...tasks]
    .filter((task) => task.status !== "queued")
    .sort((a, b) => b.created_at - a.created_at);
  const visibleTasks = queuedTasks.length > 0
    ? [...queuedTasks, ...historyTasks].slice(0, 12)
    : historyTasks.slice(0, 12);
  if (visibleTasks.length === 0) {
    return <EmptyState text="暂无任务记录" />;
  }
  return (
    <div className="space-y-3">
      {visibleTasks.map((task) => (
        <TaskCard
          key={task.id}
          task={task}
          selected={selectedTaskId === task.id}
          onSelect={() => onSelect(task.id)}
          onCancel={task.status === "queued" ? () => onCancel(task.id, agentId) : undefined}
        />
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

function TaskCard({
  task,
  selected,
  onSelect,
  onCancel,
}: {
  task: RuntimeTask;
  selected?: boolean;
  onSelect?: () => void;
  onCancel?: () => void;
}) {
  const detail = getTaskStatusDetail(task);
  return (
    <div
      role={onSelect ? "button" : undefined}
      tabIndex={onSelect ? 0 : undefined}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (!onSelect) return;
        if (event.key === "Enter" || event.key === " ") onSelect();
      }}
      className={`rounded-lg border p-3 transition-colors ${
        selected
          ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)]"
          : "border-[var(--color-border-soft)] bg-[var(--color-surface-subtle)]"
      } ${onSelect ? "cursor-pointer hover:border-[var(--color-accent)]" : ""}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${taskStatusClass(task.status)}`}>
              {taskStatusLabel(task.status)}
            </span>
            <span className="font-mono text-xs text-[var(--color-text-soft)]">{task.id.slice(0, 8)}</span>
          </div>
          <p className="mt-2 line-clamp-2 text-sm leading-6 text-[var(--color-text)]">{task.input}</p>
          {detail && (
            <p className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--color-text-soft)]">{detail}</p>
          )}
        </div>
        {onCancel && (
          <button
            onClick={(event) => {
              event.stopPropagation();
              onCancel();
            }}
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

function TaskDetailPanel({
  timeline,
  loading,
  error,
  onClear,
}: {
  timeline: RuntimeTaskTimelineResponse | null;
  loading: boolean;
  error: string | null;
  onClear: () => void;
}) {
  if (!timeline) {
    return (
      <div className="flex min-h-[360px] items-center justify-center rounded-lg border border-dashed border-[var(--color-border)] bg-white px-4 py-10 text-sm text-[var(--color-text-soft)]">
        {loading ? "正在加载任务时间线..." : "选择一个任务查看执行时间线"}
      </div>
    );
  }

  const { task, current, episode } = timeline;
  return (
    <div className="rounded-lg border border-[var(--color-border-soft)] bg-white">
      <div className="flex items-start justify-between gap-3 border-b border-[var(--color-border-soft)] px-4 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${taskStatusClass(task.status)}`}>
              {taskStatusLabel(task.status)}
            </span>
            <span className="font-mono text-xs text-[var(--color-text-soft)]">{task.id}</span>
          </div>
          <p className="mt-2 break-words text-sm leading-6 text-[var(--color-text)]">{task.input}</p>
        </div>
        <button
          type="button"
          onClick={onClear}
          className="rounded-md p-1.5 text-[var(--color-text-soft)] transition-colors hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text)]"
          title="关闭详情"
        >
          <X size={14} />
        </button>
      </div>

      <div className="space-y-4 p-4">
        {error && (
          <div className="rounded-lg bg-[var(--color-danger-soft)] px-3 py-2 text-sm text-[var(--color-danger)]">{error}</div>
        )}
        {loading && (
          <div className="rounded-lg bg-[var(--color-surface-subtle)] px-3 py-2 text-sm text-[var(--color-text-soft)]">正在刷新时间线...</div>
        )}

        <div className="grid gap-2 sm:grid-cols-2">
          <DetailRow label="Agent" value={task.agent_id} />
          <DetailRow label="渠道" value={task.source_channel} />
          <DetailRow label="尝试" value={`${task.attempt_count ?? 0}/${task.max_attempts ?? 0}`} />
          <DetailRow label="进度" value={current.progressMessage || current.progressStatus} />
          <DetailRow label="最近进展" value={formatFullTime(current.lastProgressAt)} />
          <DetailRow label="租约到期" value={formatFullTime(current.leaseExpiresAt)} />
        </div>

        {(current.failureType || current.failureStage || current.retriable !== null) && (
          <div className="rounded-lg border border-[var(--color-danger-soft)] bg-[var(--color-danger-soft)] px-3 py-2 text-sm text-[var(--color-danger)]">
            失败分类：{current.failureType ?? "unknown"} / {current.failureStage ?? "unknown"} · 可重试：{current.retriable ? "是" : "否"}
          </div>
        )}

        {(current.currentToolName || current.recentOutput) && (
          <div className="rounded-lg border border-[var(--color-border-soft)] bg-[var(--color-surface-subtle)] px-3 py-2">
            {current.currentToolName && (
              <div className="text-xs font-semibold text-[var(--color-text-muted)]">
                最近工具：{current.currentToolName}
                {current.currentToolCallId ? <span className="font-mono"> · {current.currentToolCallId}</span> : null}
              </div>
            )}
            {current.recentOutput && (
              <p className="mt-1 line-clamp-3 break-words text-sm leading-6 text-[var(--color-text)]">{current.recentOutput}</p>
            )}
          </div>
        )}

        <TaskPlanSummary timeline={timeline} />
        <EpisodeSummary episode={episode} />
        <TimelineList items={timeline.timeline} />
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="rounded-lg bg-[var(--color-surface-subtle)] px-3 py-2">
      <div className="text-[11px] text-[var(--color-text-soft)]">{label}</div>
      <div className="mt-1 break-words text-sm font-medium text-[var(--color-text)]">{value || "-"}</div>
    </div>
  );
}

function TaskPlanSummary({ timeline }: { timeline: RuntimeTaskTimelineResponse }) {
  const steps = timeline.plan?.steps ?? [];
  const dependencies = timeline.dependencies ?? [];
  const children = timeline.children ?? [];
  if (steps.length === 0 && dependencies.length === 0 && children.length === 0) return null;

  return (
    <div className="rounded-lg border border-[var(--color-border-soft)] px-3 py-3">
      <div className="text-sm font-semibold text-[var(--color-text)]">任务计划</div>
      {dependencies.length > 0 && (
        <div className="mt-3">
          <div className="text-xs font-semibold text-[var(--color-text-soft)]">依赖</div>
          <div className="mt-1 space-y-1">
            {dependencies.map((dependency) => (
              <div key={dependency.depends_on_task_id} className="flex items-center justify-between gap-2 text-sm text-[var(--color-text-muted)]">
                <span className="min-w-0 truncate">
                  {dependency.reason || dependency.depends_on_input || dependency.depends_on_task_id}
                </span>
                <span className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-semibold ${taskStatusClass(dependency.depends_on_status)}`}>
                  {taskStatusLabel(dependency.depends_on_status)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      {steps.length > 0 && (
        <div className="mt-3">
          <div className="text-xs font-semibold text-[var(--color-text-soft)]">步骤</div>
          <div className="mt-1 space-y-2">
            {steps.map((step) => (
              <div key={step.id} className="rounded-md bg-[var(--color-surface-subtle)] px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-sm font-medium text-[var(--color-text)]">
                    {step.step_index + 1}. {step.title}
                  </span>
                  <span className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-semibold ${stepStatusClass(step.status)}`}>
                    {stepStatusLabel(step.status)}
                  </span>
                </div>
                {step.detail && (
                  <div className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--color-text-muted)]">{step.detail}</div>
                )}
                {step.child_task_id && (
                  <div className="mt-1 font-mono text-[11px] text-[var(--color-text-soft)]">child: {step.child_task_id}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      {children.length > 0 && (
        <div className="mt-3">
          <div className="text-xs font-semibold text-[var(--color-text-soft)]">子任务</div>
          <div className="mt-1 space-y-1">
            {children.map((child) => (
              <div key={child.id} className="flex items-center justify-between gap-2 text-sm text-[var(--color-text-muted)]">
                <span className="min-w-0 truncate">{child.input}</span>
                <span className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-semibold ${taskStatusClass(child.status)}`}>
                  {taskStatusLabel(child.status)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function EpisodeSummary({ episode }: { episode: RuntimeTaskTimelineResponse["episode"] }) {
  if (!episode) {
    return (
      <div className="rounded-lg border border-dashed border-[var(--color-border)] px-3 py-3 text-sm text-[var(--color-text-soft)]">
        暂无经历摘要
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-[var(--color-border-soft)] px-3 py-3">
      <div className="text-sm font-semibold text-[var(--color-text)]">{episode.title}</div>
      <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-[var(--color-text-muted)]">{episode.summary}</p>
      {episode.key_steps.length > 0 && (
        <div className="mt-3">
          <div className="text-xs font-semibold text-[var(--color-text-soft)]">关键步骤</div>
          <div className="mt-1 space-y-1">
            {episode.key_steps.map((step) => (
              <div key={step} className="text-sm text-[var(--color-text-muted)]">• {step}</div>
            ))}
          </div>
        </div>
      )}
      {episode.problems.length > 0 && (
        <div className="mt-3">
          <div className="text-xs font-semibold text-[var(--color-danger)]">问题</div>
          <div className="mt-1 space-y-1">
            {episode.problems.map((problem) => (
              <div key={problem} className="text-sm text-[var(--color-danger)]">• {problem}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TimelineList({ items }: { items: RuntimeTaskTimelineItem[] }) {
  if (items.length === 0) {
    return <EmptyState text="暂无任务事件" />;
  }
  return (
    <div>
      <div className="mb-2 text-sm font-semibold text-[var(--color-text)]">执行时间线</div>
      <div className="space-y-2">
        {items.map((item) => (
          <div key={item.id} className="rounded-lg border border-[var(--color-border-soft)] bg-[var(--color-surface-subtle)] px-3 py-2">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <span className={`h-2 w-2 shrink-0 rounded-full ${timelineToneClass(item.tone)}`} />
                <span className="truncate text-sm font-semibold text-[var(--color-text)]">{item.title}</span>
              </div>
              <span className="shrink-0 text-xs text-[var(--color-text-soft)]">{formatTime(item.createdAt)}</span>
            </div>
            <div className="mt-1 break-words text-sm text-[var(--color-text-muted)]">{item.detail}</div>
            <div className="mt-1 font-mono text-[11px] text-[var(--color-text-soft)]">{item.kind}</div>
          </div>
        ))}
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

function timelineToneClass(tone: RuntimeTaskTimelineTone) {
  const classes: Record<RuntimeTaskTimelineTone, string> = {
    info: "bg-[var(--color-accent)]",
    success: "bg-[var(--color-success)]",
    warning: "bg-[var(--color-warning)]",
    error: "bg-[var(--color-danger)]",
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

function stepStatusLabel(status: RuntimeTaskTimelineResponse["plan"]["steps"][number]["status"]) {
  const labels: Record<RuntimeTaskTimelineResponse["plan"]["steps"][number]["status"], string> = {
    pending: "待执行",
    running: "执行中",
    completed: "完成",
    failed: "失败",
    canceled: "取消",
    skipped: "跳过",
  };
  return labels[status];
}

function stepStatusClass(status: RuntimeTaskTimelineResponse["plan"]["steps"][number]["status"]) {
  const classes: Record<RuntimeTaskTimelineResponse["plan"]["steps"][number]["status"], string> = {
    pending: "bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]",
    running: "bg-[var(--color-warning-soft)] text-[var(--color-warning)]",
    completed: "bg-[var(--color-success-soft)] text-[var(--color-success)]",
    failed: "bg-[var(--color-danger-soft)] text-[var(--color-danger)]",
    canceled: "bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]",
    skipped: "bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]",
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

function formatFullTime(timestamp: number | null): string | null {
  if (!timestamp) return null;
  return new Date(timestamp).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
