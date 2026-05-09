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
  ClipboardList,
  Route,
  UserRound,
} from "lucide-react";
import { useMemoryStore } from "../store/memoryStore";
import type { MemoryItem, MemoryReviewItem } from "../store/memoryStore";

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
  { key: "reviews", label: "待审查", icon: ShieldQuestion },
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
    reviewItems,
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
    acceptReviewItem,
    rejectReviewItem,
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

  const totalPages = Math.ceil(total / pageSize);
  const activeCount = stats?.byStatus.active ?? total;
  const pendingReviewCount = reviewItems.filter((item) => item.status === "pending").length;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-slate-900/20 backdrop-blur-[1px]" onClick={onClose} />
      <div className="relative flex w-full max-w-3xl flex-col border-l border-[var(--color-border)] bg-white shadow-[var(--shadow-panel)]">
        <div className="flex items-center justify-between border-b border-[var(--color-border-soft)] px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-[var(--color-text)]">记忆管理</h2>
            <p className="mt-0.5 text-xs text-[var(--color-text-soft)]">
              长期记忆、经历、审查建议和梦整理
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

        {section === "reviews" && (
          <div className="flex-1 overflow-y-auto px-4 py-4">
            <div className="mb-3 rounded-lg bg-[var(--color-surface-subtle)] px-3 py-2 text-xs text-[var(--color-text-muted)]">
              待审查建议用于高风险记忆变更，例如冲突处理、近似合并和经验提炼。当前待审查 {pendingReviewCount} 条。
            </div>
            {detailsLoading && reviewItems.length === 0 && <EmptyState text="建议加载中..." />}
            {!detailsLoading && reviewItems.length === 0 && <EmptyState text="暂无待审查建议" />}
            <div className="flex flex-col gap-3">
              {reviewItems.map((item) => (
                <ReviewCard
                  key={item.id}
                  item={item}
                  onAccept={acceptReviewItem}
                  onReject={rejectReviewItem}
                />
              ))}
            </div>
          </div>
        )}

        {section === "dream" && (
          <div className="flex-1 overflow-y-auto px-4 py-4">
            <div className="mb-4 flex items-center justify-between rounded-xl border border-[var(--color-border-soft)] bg-[var(--color-surface-subtle)] p-4">
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text)]">
                  <Sparkles size={16} className="text-[var(--color-accent)]" />
                  梦整理试运行
                </div>
                <p className="mt-1 text-xs text-[var(--color-text-soft)]">
                  汇总当天经历、做确定性去重，并展示待审查数量；试运行不会改写长期记忆。
                </p>
              </div>
              <button
                onClick={runDreamDryRun}
                disabled={dreamLoading}
                className="flex items-center gap-1.5 rounded-lg bg-[var(--color-accent)] px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-[var(--color-accent-strong)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <RefreshCw size={14} className={dreamLoading ? "animate-spin" : ""} />
                {dreamLoading ? "运行中" : "运行"}
              </button>
            </div>

            {dreamResult && (
              <div className="mb-4 rounded-xl border border-[var(--color-border-soft)] bg-white p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text)]">
                  <CalendarDays size={15} className="text-[var(--color-accent)]" />
                  {dreamResult.date} 试运行结果
                </div>
                <p className="mt-3 text-sm leading-relaxed text-[var(--color-text)]">
                  {dreamResult.summary.summary}
                </p>
                <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                  <Metric label="经历数" value={dreamResult.summary.episode_ids.length} />
                  <Metric label="重复组" value={dreamResult.dedupe.duplicateGroups.length} />
                  <Metric label="待审查" value={dreamResult.pendingReviewCount} />
                </div>
              </div>
            )}

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

function ReviewCard(props: {
  item: MemoryReviewItem;
  onAccept: (id: string) => Promise<void>;
  onReject: (id: string) => Promise<void>;
}) {
  const { item } = props;
  return (
    <div className="rounded-xl border border-[var(--color-border-soft)] bg-[var(--color-surface-subtle)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <ShieldQuestion size={15} className="text-[var(--color-accent)]" />
            <h3 className="text-sm font-semibold text-[var(--color-text)]">{item.title}</h3>
          </div>
          <div className="mt-1 text-xs text-[var(--color-text-soft)]">
            {getReviewTypeLabel(item.type)} · 置信度 {(item.confidence * 100).toFixed(0)}% · {formatDateTime(item.created_at)}
          </div>
        </div>
        <span className="rounded-md bg-white px-2 py-1 text-xs text-[var(--color-text-muted)] shadow-sm">
          {getReviewStatusLabel(item.status)}
        </span>
      </div>
      <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-[var(--color-text)]">
        {item.proposed_content}
      </p>
      {item.reason && (
        <p className="mt-2 text-xs leading-relaxed text-[var(--color-text-muted)]">
          原因：{item.reason}
        </p>
      )}
      {item.status === "pending" && (
        <div className="mt-3 flex justify-end gap-2">
          <button
            onClick={() => props.onReject(item.id)}
            className="flex items-center gap-1 rounded-md border border-[var(--color-border)] bg-white px-3 py-1.5 text-xs font-medium text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-danger)]"
          >
            <Ban size={13} />
            拒绝
          </button>
          <button
            onClick={() => props.onAccept(item.id)}
            className="flex items-center gap-1 rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[var(--color-accent-strong)]"
          >
            <Check size={13} />
            接受
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

function getReviewTypeLabel(type: string) {
  const labels: Record<string, string> = {
    merge: "近似合并",
    semantic_update: "语义更新",
    procedural_memory: "流程记忆",
    conflict: "冲突处理",
    reflective_memory: "反思记忆",
  };
  return labels[type] ?? type;
}

function getReviewStatusLabel(status: MemoryReviewItem["status"]) {
  const labels: Record<MemoryReviewItem["status"], string> = {
    pending: "待审查",
    accepted: "已接受",
    rejected: "已拒绝",
  };
  return labels[status];
}
