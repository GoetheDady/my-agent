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
  fact: { label: "事实", icon: BookOpen, color: "text-blue-400" },
  preference: { label: "偏好", icon: Star, color: "text-yellow-400" },
  project: { label: "项目", icon: FolderOpen, color: "text-green-400" },
  lesson: { label: "教训", icon: Lightbulb, color: "text-orange-400" },
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

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative flex w-full max-w-lg flex-col bg-[var(--color-surface)] border-l border-white/10 shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
          <h2 className="text-lg font-semibold text-[var(--color-text)]">记忆管理</h2>
          <button
            onClick={onClose}
            className="text-white/60 hover:text-white transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex gap-1 border-b border-white/10 px-4 py-2 overflow-x-auto">
          {TYPE_TABS.map((tab) => {
            const Icon = tab.icon;
            const active = filterType === tab.key;
            return (
              <button
                key={tab.key ?? "all"}
                onClick={() => setFilterType(tab.key)}
                className={`flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition-colors ${
                  active
                    ? "bg-white/15 text-[var(--color-text)]"
                    : "text-white/50 hover:text-white/80 hover:bg-white/5"
                }`}
              >
                <Icon size={14} />
                {tab.label}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2 px-4 py-3 border-b border-white/10">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder="搜索记忆..."
              className="w-full rounded-md border border-white/10 bg-white/5 py-2 pl-9 pr-3 text-sm text-[var(--color-text)] placeholder:text-white/30 focus:border-white/20 focus:outline-none"
            />
          </div>
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-1 rounded-md bg-[var(--color-accent)] px-3 py-2 text-sm text-white hover:opacity-90 transition-opacity"
          >
            <Plus size={14} />
            添加
          </button>
        </div>

        <div className="px-4 py-2 text-xs text-white/40">
          共 {stats?.total ?? total} 条记忆
        </div>

        <div className="flex-1 overflow-y-auto px-4 pb-4">
          {loading && memories.length === 0 && (
            <div className="flex items-center justify-center py-12 text-white/40 text-sm">
              加载中...
            </div>
          )}

          {!loading && memories.length === 0 && (
            <div className="flex items-center justify-center py-12 text-white/40 text-sm">
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
                  className="rounded-lg border border-white/10 bg-white/5 p-4"
                >
                  <div className="mb-2 flex items-center justify-between">
                    <span
                      className={`inline-flex items-center gap-1 rounded-md bg-white/10 px-2 py-0.5 text-xs ${
                        cfg?.color ?? "text-white/60"
                      }`}
                    >
                      {cfg && <cfg.icon size={12} />}
                      {cfg?.label ?? item.memory_type}
                    </span>
                    <div className="flex items-center gap-1">
                      {!isEditing && (
                        <button
                          onClick={() => handleEdit(item)}
                          className="rounded p-1 text-white/40 hover:text-white/80 transition-colors"
                          title="编辑"
                        >
                          <Edit3 size={14} />
                        </button>
                      )}
                      <button
                        onClick={() => handleDelete(item.id)}
                        className={`rounded p-1 transition-colors ${
                          isDeleting
                            ? "bg-red-500/20 text-red-400"
                            : "text-white/40 hover:text-red-400"
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
                        className="w-full rounded-md border border-white/10 bg-white/5 p-2 text-sm text-[var(--color-text)] focus:border-white/20 focus:outline-none resize-none"
                        rows={3}
                      />
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={handleCancelEdit}
                          className="rounded-md px-3 py-1 text-xs text-white/50 hover:text-white/80 transition-colors"
                        >
                          取消
                        </button>
                        <button
                          onClick={handleSaveEdit}
                          className="rounded-md bg-[var(--color-accent)] px-3 py-1 text-xs text-white hover:opacity-90 transition-opacity"
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

                  <div className="mt-2 flex items-center gap-3 text-xs text-white/30">
                    <span>置信度: {(item.confidence * 100).toFixed(0)}%</span>
                    <span>访问: {item.access_count}次</span>
                    <span>{new Date(item.updated_at * 1000).toLocaleDateString()}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-center gap-2 text-sm text-white/50">
              <button
                onClick={() => setPage(page - 1)}
                disabled={page <= 1}
                className="rounded-md border border-white/10 px-3 py-1 hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                上一页
              </button>
              <span className="px-2">
                {page} / {totalPages}
              </span>
              <button
                onClick={() => setPage(page + 1)}
                disabled={page >= totalPages}
                className="rounded-md border border-white/10 px-3 py-1 hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                下一页
              </button>
            </div>
          )}
        </div>

        {showAddModal && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40">
            <div className="mx-4 w-full max-w-sm rounded-lg border border-white/10 bg-[var(--color-surface)] p-6 shadow-xl">
              <h3 className="mb-4 text-base font-semibold text-[var(--color-text)]">
                添加记忆
              </h3>
              <textarea
                value={addContent}
                onChange={(e) => setAddContent(e.target.value)}
                placeholder="输入记忆内容..."
                className="w-full rounded-md border border-white/10 bg-white/5 p-3 text-sm text-[var(--color-text)] placeholder:text-white/30 focus:border-white/20 focus:outline-none resize-none"
                rows={4}
              />
              <select
                value={addType}
                onChange={(e) => setAddType(e.target.value)}
                className="mt-3 w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-[var(--color-text)] focus:border-white/20 focus:outline-none"
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
                  className="rounded-md px-4 py-2 text-sm text-white/50 hover:text-white/80 transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={handleAdd}
                  className="rounded-md bg-[var(--color-accent)] px-4 py-2 text-sm text-white hover:opacity-90 transition-opacity"
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
