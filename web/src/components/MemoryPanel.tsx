import { useState, useEffect, useCallback } from "react";
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
} from "lucide-react";
import { useMemoryStore } from "../store/memoryStore";
import type { MemoryItem } from "../store/memoryStore";

const TYPE_CONFIG: Record<string, { label: string; icon: typeof Brain; color: string }> = {
  fact: { label: "事实", icon: BookOpen, color: "text-blue-700" },
  preference: { label: "偏好", icon: Star, color: "text-amber-700" },
  project: { label: "项目", icon: FolderOpen, color: "text-emerald-700" },
  lesson: { label: "教训", icon: Lightbulb, color: "text-orange-700" },
};

const TYPE_TABS = [
  { key: null, label: "全部", icon: Brain },
  { key: "fact", label: "事实", icon: BookOpen },
  { key: "preference", label: "偏好", icon: Star },
  { key: "project", label: "项目", icon: FolderOpen },
  { key: "lesson", label: "教训", icon: Lightbulb },
];

interface Props {
  onClose: () => void;
}

export default function MemoryPanel({ onClose }: Props) {
  const {
    memories,
    stats,
    loading,
    page,
    pageSize,
    total,
    filterType,
    searchQuery,
    fetchMemories,
    fetchStats,
    searchMemories,
    setFilterType,
    setPage,
    deleteMemory,
    updateMemory,
    addMemory,
  } = useMemoryStore();

  const [editId, setEditId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);
  const [addContent, setAddContent] = useState("");
  const [addType, setAddType] = useState("fact");
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deleteTimer, setDeleteTimer] = useState<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetchMemories();
    fetchStats();
  }, []);

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
  const candidateCount = stats?.byStatus.candidate ?? 0;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-slate-900/20 backdrop-blur-[1px]" onClick={onClose} />
      <div className="relative flex w-full max-w-lg flex-col border-l border-[var(--color-border)] bg-white shadow-[var(--shadow-panel)]">
        <div className="flex items-center justify-between border-b border-[var(--color-border-soft)] px-6 py-4">
          <h2 className="text-lg font-semibold text-[var(--color-text)]">记忆管理</h2>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text)]"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex gap-1 overflow-x-auto border-b border-[var(--color-border-soft)] px-4 py-2">
          {TYPE_TABS.map((tab) => {
            const Icon = tab.icon;
            const active = filterType === tab.key;
            return (
              <button
                key={tab.key ?? "all"}
                onClick={() => setFilterType(tab.key)}
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
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder="搜索记忆..."
              className="w-full rounded-lg border border-[var(--color-border)] bg-white py-2 pl-9 pr-3 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-soft)] outline-none focus:border-[var(--color-accent)]"
            />
          </div>
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-1 rounded-lg bg-[var(--color-accent)] px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-[var(--color-accent-strong)]"
          >
            <Plus size={14} />
            添加
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2 px-4 py-3 text-xs">
          <div className="rounded-lg bg-[var(--color-surface-subtle)] px-3 py-2">
            <div className="text-[var(--color-text-soft)]">已生效</div>
            <div className="mt-0.5 text-sm font-semibold text-[var(--color-text)]">{activeCount}</div>
          </div>
          <div className="rounded-lg bg-[var(--color-warning-soft)] px-3 py-2">
            <div className="text-[var(--color-warning)]">候选记忆</div>
            <div className="mt-0.5 text-sm font-semibold text-[var(--color-text)]">{candidateCount}</div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 pb-4">
          {loading && memories.length === 0 && (
            <div className="flex items-center justify-center py-12 text-sm text-[var(--color-text-soft)]">
              加载中...
            </div>
          )}

          {!loading && memories.length === 0 && (
            <div className="flex items-center justify-center py-12 text-sm text-[var(--color-text-soft)]">
              暂无记忆
            </div>
          )}

          <div className="flex flex-col gap-3">
            {memories.map((item) => {
              const cfg = TYPE_CONFIG[item.memory_type];
              const isEditing = editId === item.id;
              const isDeleting = deleteConfirmId === item.id;

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
                      {cfg && <cfg.icon size={12} />}
                      {cfg?.label ?? item.memory_type}
                    </span>
                    <div className="flex items-center gap-1">
                      {!isEditing && (
                        <button
                          onClick={() => handleEdit(item)}
                          className="rounded p-1 text-[var(--color-text-soft)] transition-colors hover:bg-white hover:text-[var(--color-text)]"
                          title="编辑"
                        >
                          <Edit3 size={14} />
                        </button>
                      )}
                      <button
                        onClick={() => handleDelete(item.id)}
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
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        className="w-full resize-none rounded-lg border border-[var(--color-border)] bg-white p-2 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
                        rows={3}
                      />
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={handleCancelEdit}
                          className="rounded-md px-3 py-1 text-xs font-medium text-[var(--color-text-muted)] transition-colors hover:bg-white hover:text-[var(--color-text)]"
                        >
                          取消
                        </button>
                        <button
                          onClick={handleSaveEdit}
                          className="rounded-md bg-[var(--color-accent)] px-3 py-1 text-xs font-semibold text-white transition-colors hover:bg-[var(--color-accent-strong)]"
                        >
                          保存
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-[var(--color-text)] whitespace-pre-wrap leading-relaxed">
                      {item.content}
                    </p>
                  )}

                  <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-[var(--color-text-soft)]">
                    <span>置信度: {(item.confidence * 100).toFixed(0)}%</span>
                    <span>访问: {item.access_count}次</span>
                    <span>{new Date(item.updated_at).toLocaleDateString()}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-center gap-2 text-sm text-[var(--color-text-muted)]">
              <button
                onClick={() => setPage(page - 1)}
                disabled={page <= 1}
                className="rounded-md border border-[var(--color-border)] px-3 py-1 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-30"
              >
                上一页
              </button>
              <span className="px-2">
                {page} / {totalPages}
              </span>
              <button
                onClick={() => setPage(page + 1)}
                disabled={page >= totalPages}
                className="rounded-md border border-[var(--color-border)] px-3 py-1 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-30"
              >
                下一页
              </button>
            </div>
          )}
        </div>

        {showAddModal && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-900/20 backdrop-blur-[1px]">
            <div className="mx-4 w-full max-w-sm rounded-2xl border border-[var(--color-border)] bg-white p-6 shadow-[var(--shadow-panel)]">
              <h3 className="mb-4 text-base font-semibold text-[var(--color-text)]">
                添加记忆
              </h3>
              <textarea
                value={addContent}
                onChange={(e) => setAddContent(e.target.value)}
                placeholder="输入记忆内容..."
                className="w-full resize-none rounded-lg border border-[var(--color-border)] bg-white p-3 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-soft)] outline-none focus:border-[var(--color-accent)]"
                rows={4}
              />
              <select
                value={addType}
                onChange={(e) => setAddType(e.target.value)}
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
                  onClick={() => {
                    setShowAddModal(false);
                    setAddContent("");
                    setAddType("fact");
                  }}
                  className="rounded-lg px-4 py-2 text-sm font-medium text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text)]"
                >
                  取消
                </button>
                <button
                  onClick={handleAdd}
                  className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[var(--color-accent-strong)]"
                >
                  添加
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
