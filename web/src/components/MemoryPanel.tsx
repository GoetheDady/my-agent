import { useState, useEffect, useCallback } from "react";
import type { LucideIcon } from "lucide-react";
import {
  X,
  Search,
  Trash2,
  Edit3,
  Plus,
  Brain,
  Star,
  Lightbulb,
  FolderOpen,
  BookOpen,
  History,
  Sparkles,
  ShieldQuestion,
  CalendarDays,
  Check,
  Ban,
  RefreshCw,
  Undo2,
  ClipboardList,
  Route,
  UserRound,
} from "lucide-react";
import { useMemoryStore } from "../store/memoryStore";
import type { MemoryDecisionItem, MemoryItem } from "../store/memoryStore";

const TYPE_CONFIG: Record<string, { label: string; icon: LucideIcon; color: string }> = {
  fact: { label: "事实", icon: BookOpen, color: "text-blue-700" },
  preference: { label: "偏好", icon: Star, color: "text-amber-700" },
  project: { label: "项目", icon: FolderOpen, color: "text-emerald-700" },
  lesson: { label: "教训", icon: Lightbulb, color: "text-orange-700" },
  procedural: { label: "流程", icon: Route, color: "text-indigo-700" },
  prospective: { label: "计划", icon: ClipboardList, color: "text-cyan-700" },
  reflective: { label: "复盘", icon: ShieldQuestion, color: "text-rose-700" },
  social: { label: "协作偏好", icon: UserRound, color: "text-violet-700" },
  identity: { label: "身份", icon: Brain, color: "text-slate-700" },
};

const TYPE_TABS = [
  { key: null, label: "全部", icon: Brain },
  { key: "fact", label: "事实", icon: BookOpen },
  { key: "preference", label: "偏好", icon: Star },
  { key: "project", label: "项目", icon: FolderOpen },
  { key: "procedural", label: "流程", icon: Route },
  { key: "prospective", label: "计划", icon: ClipboardList },
  { key: "reflective", label: "复盘", icon: ShieldQuestion },
  { key: "social", label: "协作", icon: UserRound },
];

const SECTION_TABS = [
  { key: "memories", label: "长期记忆", icon: Brain },
  { key: "episodes", label: "经历", icon: History },
  { key: "decisions", label: "整理记录", icon: ShieldQuestion },
  { key: "dream", label: "梦整理", icon: Sparkles },
] as const;

type SectionKey = (typeof SECTION_TABS)[number]["key"];

interface Props {
  onClose: () => void;
}

export default function MemoryPanel({ onClose }: Props) {
  const {
    memories,
    stats,
    episodes,
    dailySummaries,
    memoryDecisions,
    dreamRuns,
    dreamResult,
    loading,
    detailsLoading,
    dreamLoading,
    page,
    pageSize,
    total,
    filterType,
    searchQuery,
    fetchMemoryWorkspace,
    searchMemories,
    setFilterType,
    setPage,
    deleteMemory,
    updateMemory,
    addMemory,
    runDreamDryRun,
    runDreamRealRun,
    undoMemoryDecision,
  } = useMemoryStore();

  const [section, setSection] = useState<SectionKey>("memories");
  const [editId, setEditId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);
  const [addContent, setAddContent] = useState("");
  const [addType, setAddType] = useState("fact");
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deleteTimer, setDeleteTimer] = useState<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetchMemoryWorkspace();
  }, [fetchMemoryWorkspace]);

  const handleSearch = useCallback(
    (query: string) => {
      searchMemories(query);
    },
    [searchMemories],
  );

  const handleDelete = useCallback(
    (id: string) => {
      if (deleteConfirmId === id) {
        if (deleteTimer) clearTimeout(deleteTimer);
        setDeleteConfirmId(null);
        setDeleteTimer(null);
        deleteMemory(id);
      } else {
        if (deleteTimer) clearTimeout(deleteTimer);
        setDeleteConfirmId(id);
        const timer = setTimeout(() => {
          setDeleteConfirmId(null);
          setDeleteTimer(null);
        }, 3000);
        setDeleteTimer(timer);
      }
    },
    [deleteConfirmId, deleteTimer, deleteMemory],
  );

  const handleEdit = useCallback((item: MemoryItem) => {
    setEditId(item.id);
    setEditContent(item.content);
  }, []);

  const handleSaveEdit = useCallback(() => {
    if (editId && editContent.trim()) {
      updateMemory(editId, editContent.trim());
      setEditId(null);
      setEditContent("");
    }
  }, [editId, editContent, updateMemory]);

  const handleCancelEdit = useCallback(() => {
    setEditId(null);
    setEditContent("");
  }, []);

  const handleAdd = useCallback(() => {
    if (addContent.trim()) {
      addMemory(addContent.trim(), addType);
      setAddContent("");
      setAddType("fact");
      setShowAddModal(false);
    }
  }, [addContent, addType, addMemory]);

  const handleRunDreamRealRun = useCallback(() => {
    const confirmed = window.confirm("真实整理会自动改写本地长期记忆，但可在整理记录里撤销。确认运行吗？");
    if (confirmed) void runDreamRealRun();
  }, [runDreamRealRun]);

  const totalPages = Math.ceil(total / pageSize);
  const activeCount = stats?.byStatus.active ?? total;
  const appliedDecisionCount = memoryDecisions.filter((item) => item.status === "applied").length;
  const skippedDecisionCount = memoryDecisions.filter((item) => item.status === "skipped").length;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-slate-900/20 backdrop-blur-[1px]" onClick={onClose} />
      <div className="relative flex w-full max-w-3xl flex-col border-l border-[var(--color-border)] bg-white shadow-[var(--shadow-panel)]">
        <div className="flex items-center justify-between border-b border-[var(--color-border-soft)] px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-[var(--color-text)]">记忆管理</h2>
            <p className="mt-0.5 text-xs text-[var(--color-text-soft)]">
              长期记忆、经历、自动整理记录和梦整理
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text)]"
            title="关闭"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex gap-1 border-b border-[var(--color-border-soft)] px-4 py-2">
          {SECTION_TABS.map((tab) => {
            const Icon = tab.icon;
            const active = section === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setSection(tab.key)}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors ${
                  active
                    ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
                    : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text)]"
                }`}
              >
                <Icon size={14} />
                {tab.label}
              </button>
            );
          })}
        </div>

        {section === "memories" && (
          <MemoriesSection
            memories={memories}
            loading={loading}
            page={page}
            totalPages={totalPages}
            filterType={filterType}
            searchQuery={searchQuery}
            activeCount={activeCount}
            editId={editId}
            editContent={editContent}
            deleteConfirmId={deleteConfirmId}
            onSearch={handleSearch}
            onFilter={setFilterType}
            onShowAdd={() => setShowAddModal(true)}
            onEdit={handleEdit}
            onEditContent={setEditContent}
            onSaveEdit={handleSaveEdit}
            onCancelEdit={handleCancelEdit}
            onDelete={handleDelete}
            onPage={setPage}
          />
        )}

        {section === "episodes" && (
          <div className="flex-1 overflow-y-auto px-4 py-4">
            {detailsLoading && episodes.length === 0 && <EmptyState text="经历加载中..." />}
            {!detailsLoading && episodes.length === 0 && <EmptyState text="暂无经历记录" />}
            <div className="flex flex-col gap-3">
              {episodes.map((episode) => (
                <div key={episode.id} className="rounded-xl border border-[var(--color-border-soft)] bg-[var(--color-surface-subtle)] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <History size={15} className="text-[var(--color-accent)]" />
                        <h3 className="text-sm font-semibold text-[var(--color-text)]">{episode.title}</h3>
                      </div>
                      <div className="mt-1 text-xs text-[var(--color-text-soft)]">
                        {formatDateTime(episode.time_range_end)} · 重要度 {(episode.importance * 100).toFixed(0)}%
                      </div>
                    </div>
                  </div>
                  <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-[var(--color-text)]">
                    {episode.summary}
                  </p>
                  {(episode.tools_used.length > 0 || episode.files_touched.length > 0) && (
                    <div className="mt-3 flex flex-wrap gap-2 text-xs text-[var(--color-text-muted)]">
                      {episode.tools_used.map((tool) => (
                        <span key={tool} className="rounded-md bg-white px-2 py-1 shadow-sm">
                          工具：{tool}
                        </span>
                      ))}
                      {episode.files_touched.slice(0, 4).map((file) => (
                        <span key={file} className="rounded-md bg-white px-2 py-1 shadow-sm">
                          文件：{file}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {section === "decisions" && (
          <div className="flex-1 overflow-y-auto px-4 py-4">
            <div className="mb-3 rounded-lg bg-[var(--color-surface-subtle)] px-3 py-2 text-xs text-[var(--color-text-muted)]">
              Agent 会自主整理记忆。这里保留每次整理的原因、依据和变更结果，发现判断错误时可以撤销。
              当前已应用 {appliedDecisionCount} 条，已跳过 {skippedDecisionCount} 条。
            </div>
            {detailsLoading && memoryDecisions.length === 0 && <EmptyState text="整理记录加载中..." />}
            {!detailsLoading && memoryDecisions.length === 0 && <EmptyState text="暂无整理记录" />}
            <div className="flex flex-col gap-3">
              {memoryDecisions.map((item) => (
                <DecisionCard
                  key={item.id}
                  item={item}
                  onUndo={undoMemoryDecision}
                />
              ))}
            </div>
          </div>
        )}

        {section === "dream" && (
          <div className="flex-1 overflow-y-auto px-4 py-4">
            <div className="mb-4 flex items-center justify-between gap-4 rounded-xl border border-[var(--color-border-soft)] bg-[var(--color-surface-subtle)] p-4">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text)]">
                  <Sparkles size={16} className="text-[var(--color-accent)]" />
                  梦整理
                </div>
                <p className="mt-1 text-xs text-[var(--color-text-soft)]">
                  dry-run 只预览；真实运行会自动应用高置信整理，并在整理记录里保留撤销入口。
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  onClick={runDreamDryRun}
                  disabled={dreamLoading}
                  className="flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-white px-3 py-2 text-sm font-semibold text-[var(--color-text)] transition-colors hover:bg-[var(--color-surface-subtle)] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <RefreshCw size={14} className={dreamLoading ? "animate-spin" : ""} />
                  {dreamLoading ? "运行中" : "dry-run"}
                </button>
                <button
                  onClick={handleRunDreamRealRun}
                  disabled={dreamLoading}
                  className="flex items-center gap-1.5 rounded-lg bg-[var(--color-accent)] px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-[var(--color-accent-strong)] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Sparkles size={14} />
                  真实整理
                </button>
              </div>
            </div>

            {dreamResult && (
              <div className="mb-4 rounded-xl border border-[var(--color-border-soft)] bg-white p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text)]">
                  <CalendarDays size={15} className="text-[var(--color-accent)]" />
                  {dreamResult.date} {dreamResult.dryRun ? "dry-run" : "真实整理"}结果
                </div>
                <p className="mt-3 text-sm leading-relaxed text-[var(--color-text)]">
                  {dreamResult.summary.summary}
                </p>
                <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                  <Metric label="经历数" value={dreamResult.summary.episode_ids.length} />
                  <Metric label="重复组" value={dreamResult.dedupe.duplicateGroups.length} />
                  <Metric label="整理决策" value={dreamResult.decisionCount} />
                </div>
              </div>
            )}

            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-soft)]">
              运行历史
            </div>
            {dreamRuns.length === 0 && <EmptyState text="暂无运行记录" />}
            <div className="mb-4 flex flex-col gap-2">
              {dreamRuns.slice(0, 5).map((run) => (
                <div key={run.id} className="flex items-center justify-between rounded-lg border border-[var(--color-border-soft)] bg-white px-3 py-2 text-xs">
                  <div className="text-[var(--color-text)]">
                    {run.date} · {run.trigger === "scheduled" ? "自动" : "手动"} · {run.dry_run ? "dry-run" : "真实整理"}
                  </div>
                  <span className="rounded-md bg-[var(--color-surface-subtle)] px-2 py-1 text-[var(--color-text-muted)]">
                    {getDreamRunStatusLabel(run.status)}
                  </span>
                </div>
              ))}
            </div>

            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-soft)]">
              已保存每日总结
            </div>
            {dailySummaries.length === 0 && <EmptyState text="暂无每日总结" />}
            <div className="flex flex-col gap-3">
              {dailySummaries.map((summary) => (
                <div key={summary.id} className="rounded-xl border border-[var(--color-border-soft)] bg-[var(--color-surface-subtle)] p-4">
                  <div className="text-sm font-semibold text-[var(--color-text)]">{summary.date}</div>
                  <p className="mt-2 text-sm leading-relaxed text-[var(--color-text)]">{summary.summary}</p>
                  {summary.highlights.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2 text-xs text-[var(--color-text-muted)]">
                      {summary.highlights.map((highlight) => (
                        <span key={highlight} className="rounded-md bg-white px-2 py-1 shadow-sm">
                          {highlight}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {showAddModal && (
          <AddMemoryModal
            content={addContent}
            type={addType}
            onContent={setAddContent}
            onType={setAddType}
            onCancel={() => {
              setShowAddModal(false);
              setAddContent("");
              setAddType("fact");
            }}
            onAdd={handleAdd}
          />
        )}
      </div>
    </div>
  );
}

function MemoriesSection(props: {
  memories: MemoryItem[];
  loading: boolean;
  page: number;
  totalPages: number;
  filterType: string | null;
  searchQuery: string;
  activeCount: number;
  editId: string | null;
  editContent: string;
  deleteConfirmId: string | null;
  onSearch: (query: string) => void;
  onFilter: (type: string | null) => void;
  onShowAdd: () => void;
  onEdit: (item: MemoryItem) => void;
  onEditContent: (content: string) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onDelete: (id: string) => void;
  onPage: (page: number) => void;
}) {
  return (
    <>
      <div className="flex gap-1 overflow-x-auto border-b border-[var(--color-border-soft)] px-4 py-2">
        {TYPE_TABS.map((tab) => {
          const Icon = tab.icon;
          const active = props.filterType === tab.key;
          return (
            <button
              key={tab.key ?? "all"}
              onClick={() => props.onFilter(tab.key)}
              className={`flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition-colors ${
                active
                  ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
                  : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text)]"
              }`}
            >
              <Icon size={14} />
              {tab.label}
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-2 border-b border-[var(--color-border-soft)] px-4 py-3">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-soft)]" />
          <input
            type="text"
            value={props.searchQuery}
            onChange={(e) => props.onSearch(e.target.value)}
            placeholder="搜索记忆..."
            className="w-full rounded-lg border border-[var(--color-border)] bg-white py-2 pl-9 pr-3 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-soft)] outline-none focus:border-[var(--color-accent)]"
          />
        </div>
        <button
          onClick={props.onShowAdd}
          className="flex items-center gap-1 rounded-lg bg-[var(--color-accent)] px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-[var(--color-accent-strong)]"
        >
          <Plus size={14} />
          添加
        </button>
      </div>

      <div className="px-4 py-3 text-xs">
        <div className="rounded-lg bg-[var(--color-surface-subtle)] px-3 py-2">
          <div className="text-[var(--color-text-soft)]">已生效</div>
          <div className="mt-0.5 text-sm font-semibold text-[var(--color-text)]">{props.activeCount}</div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {props.loading && props.memories.length === 0 && <EmptyState text="加载中..." />}
        {!props.loading && props.memories.length === 0 && <EmptyState text="暂无记忆" />}

        <div className="flex flex-col gap-3">
          {props.memories.map((item) => {
            const cfg = TYPE_CONFIG[item.memory_type];
            const Icon = cfg?.icon ?? Brain;
            const isEditing = props.editId === item.id;
            const isDeleting = props.deleteConfirmId === item.id;

            return (
              <div
                key={item.id}
                className="rounded-xl border border-[var(--color-border-soft)] bg-[var(--color-surface-subtle)] p-4"
              >
                <div className="mb-2 flex items-center justify-between">
                  <span
                    className={`inline-flex items-center gap-1 rounded-md bg-white px-2 py-0.5 text-xs font-medium shadow-sm ${
                      cfg?.color ?? "text-[var(--color-text-muted)]"
                    }`}
                  >
                    <Icon size={12} />
                    {cfg?.label ?? item.memory_type}
                  </span>
                  <div className="flex items-center gap-1">
                    {!isEditing && (
                      <button
                        onClick={() => props.onEdit(item)}
                        className="rounded p-1 text-[var(--color-text-soft)] transition-colors hover:bg-white hover:text-[var(--color-text)]"
                        title="编辑"
                      >
                        <Edit3 size={14} />
                      </button>
                    )}
                    <button
                      onClick={() => props.onDelete(item.id)}
                      className={`rounded p-1 transition-colors ${
                        isDeleting
                          ? "bg-[var(--color-danger-soft)] text-[var(--color-danger)]"
                          : "text-[var(--color-text-soft)] hover:bg-white hover:text-[var(--color-danger)]"
                      }`}
                      title={isDeleting ? "再次点击确认删除" : "删除"}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                {isEditing ? (
                  <div className="flex flex-col gap-2">
                    <textarea
                      value={props.editContent}
                      onChange={(e) => props.onEditContent(e.target.value)}
                      className="w-full resize-none rounded-lg border border-[var(--color-border)] bg-white p-2 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
                      rows={3}
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={props.onCancelEdit}
                        className="rounded-md px-3 py-1 text-xs font-medium text-[var(--color-text-muted)] transition-colors hover:bg-white hover:text-[var(--color-text)]"
                      >
                        取消
                      </button>
                      <button
                        onClick={props.onSaveEdit}
                        className="rounded-md bg-[var(--color-accent)] px-3 py-1 text-xs font-semibold text-white transition-colors hover:bg-[var(--color-accent-strong)]"
                      >
                        保存
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--color-text)]">
                    {item.content}
                  </p>
                )}

                <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-[var(--color-text-soft)]">
                  <span>置信度: {(item.confidence * 100).toFixed(0)}%</span>
                  <span>访问: {item.access_count}次</span>
                  <span>{formatDate(item.updated_at)}</span>
                </div>
              </div>
            );
          })}
        </div>

        {props.totalPages > 1 && (
          <div className="mt-4 flex items-center justify-center gap-2 text-sm text-[var(--color-text-muted)]">
            <button
              onClick={() => props.onPage(props.page - 1)}
              disabled={props.page <= 1}
              className="rounded-md border border-[var(--color-border)] px-3 py-1 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-30"
            >
              上一页
            </button>
            <span className="px-2">
              {props.page} / {props.totalPages}
            </span>
            <button
              onClick={() => props.onPage(props.page + 1)}
              disabled={props.page >= props.totalPages}
              className="rounded-md border border-[var(--color-border)] px-3 py-1 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-30"
            >
              下一页
            </button>
          </div>
        )}
      </div>
    </>
  );
}

function DecisionCard(props: {
  item: MemoryDecisionItem;
  onUndo: (id: string) => Promise<void>;
}) {
  const { item } = props;
  const status = getDecisionStatusLabel(item.status);
  const StatusIcon = item.status === "applied" ? Check : Ban;
  return (
    <div className="rounded-xl border border-[var(--color-border-soft)] bg-[var(--color-surface-subtle)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <ShieldQuestion size={15} className="text-[var(--color-accent)]" />
            <h3 className="text-sm font-semibold text-[var(--color-text)]">{item.title}</h3>
          </div>
          <div className="mt-1 text-xs text-[var(--color-text-soft)]">
            {getDecisionTypeLabel(item.type)} · 置信度 {(item.confidence * 100).toFixed(0)}% · {formatDateTime(item.created_at)}
          </div>
        </div>
        <span className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-1 text-xs text-[var(--color-text-muted)] shadow-sm">
          <StatusIcon size={12} />
          {status}
        </span>
      </div>
      <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-[var(--color-text)]">
        {item.reason || "Agent 已记录本次整理动作。"}
      </p>
      {(item.target_memory_ids.length > 0 || item.created_memory_ids.length > 0) && (
        <div className="mt-3 flex flex-wrap gap-2 text-xs text-[var(--color-text-muted)]">
          {item.target_memory_ids.slice(0, 4).map((id) => (
            <span key={id} className="rounded-md bg-white px-2 py-1 shadow-sm">
              目标：{shortId(id)}
            </span>
          ))}
          {item.created_memory_ids.slice(0, 4).map((id) => (
            <span key={id} className="rounded-md bg-white px-2 py-1 shadow-sm">
              新建：{shortId(id)}
            </span>
          ))}
        </div>
      )}
      {item.after_snapshot.length > 0 && (
        <div className="mt-3 rounded-lg bg-white px-3 py-2 text-xs leading-relaxed text-[var(--color-text-muted)]">
          {summarizeDecisionSnapshots(item)}
        </div>
      )}
      {item.error && (
        <p className="mt-2 text-xs leading-relaxed text-[var(--color-danger)]">
          错误：{item.error}
        </p>
      )}
      {item.status === "applied" && (
        <div className="mt-3 flex justify-end gap-2">
          <button
            onClick={() => props.onUndo(item.id)}
            className="flex items-center gap-1 rounded-md border border-[var(--color-border)] bg-white px-3 py-1.5 text-xs font-medium text-[var(--color-text)] transition-colors hover:text-[var(--color-danger)]"
          >
            <Undo2 size={13} />
            撤销
          </button>
        </div>
      )}
    </div>
  );
}

function AddMemoryModal(props: {
  content: string;
  type: string;
  onContent: (content: string) => void;
  onType: (type: string) => void;
  onCancel: () => void;
  onAdd: () => void;
}) {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-slate-900/20 backdrop-blur-[1px]">
      <div className="mx-4 w-full max-w-sm rounded-2xl border border-[var(--color-border)] bg-white p-6 shadow-[var(--shadow-panel)]">
        <h3 className="mb-4 text-base font-semibold text-[var(--color-text)]">添加记忆</h3>
        <textarea
          value={props.content}
          onChange={(e) => props.onContent(e.target.value)}
          placeholder="输入记忆内容..."
          className="w-full resize-none rounded-lg border border-[var(--color-border)] bg-white p-3 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-soft)] outline-none focus:border-[var(--color-accent)]"
          rows={4}
        />
        <select
          value={props.type}
          onChange={(e) => props.onType(e.target.value)}
          className="mt-3 w-full rounded-lg border border-[var(--color-border)] bg-white px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
        >
          {Object.entries(TYPE_CONFIG).map(([key, cfg]) => (
            <option key={key} value={key}>
              {cfg.label}
            </option>
          ))}
        </select>
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={props.onCancel}
            className="rounded-lg px-4 py-2 text-sm font-medium text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text)]"
          >
            取消
          </button>
          <button
            onClick={props.onAdd}
            className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[var(--color-accent-strong)]"
          >
            添加
          </button>
        </div>
      </div>
    </div>
  );
}

function Metric(props: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-[var(--color-surface-subtle)] px-3 py-2">
      <div className="text-[var(--color-text-soft)]">{props.label}</div>
      <div className="mt-1 text-sm font-semibold text-[var(--color-text)]">{props.value}</div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex items-center justify-center py-12 text-sm text-[var(--color-text-soft)]">
      {text}
    </div>
  );
}

function formatDate(timestamp: number) {
  return new Date(timestamp).toLocaleDateString();
}

function formatDateTime(timestamp: number) {
  return new Date(timestamp).toLocaleString();
}

function shortId(id: string) {
  return id.length > 8 ? id.slice(0, 8) : id;
}

function summarizeDecisionSnapshots(item: MemoryDecisionItem) {
  if (item.type === "exact_dedupe") {
    const inactive = item.after_snapshot.filter((snapshot) => snapshot.status === "inactive");
    return inactive.length > 0
      ? `已停用 ${inactive.length} 条重复记忆。`
      : "未发现需要停用的重复记忆。";
  }
  if (item.type === "conflict_update") {
    const superseded = item.after_snapshot.filter((snapshot) => snapshot.status === "superseded");
    return superseded.length > 0
      ? "已保留偏好变化轨迹，并把旧记忆标记为被替代。"
      : "已更新冲突记忆。";
  }
  if (item.created_memory_ids.length > 0) return `已沉淀 ${item.created_memory_ids.length} 条新记忆。`;
  return `涉及 ${item.after_snapshot.length} 条记忆。`;
}

function getDecisionTypeLabel(type: string) {
  const labels: Record<string, string> = {
    exact_dedupe: "确定去重",
    semantic_merge: "语义合并",
    conflict_update: "冲突更新",
    procedural_extract: "流程沉淀",
    reflective_extract: "复盘沉淀",
  };
  return labels[type] ?? type;
}

function getDecisionStatusLabel(status: MemoryDecisionItem["status"]) {
  const labels: Record<MemoryDecisionItem["status"], string> = {
    applied: "已应用",
    skipped: "已跳过",
    failed: "失败",
    undone: "已撤销",
  };
  return labels[status];
}

function getDreamRunStatusLabel(status: "running" | "completed" | "failed") {
  const labels: Record<"running" | "completed" | "failed", string> = {
    running: "运行中",
    completed: "完成",
    failed: "失败",
  };
  return labels[status];
}
