import { useEffect } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useSessionStore } from "../store/sessionStore";

interface SessionSidebarProps {
  onLoadSession: (id: string) => Promise<void>;
  onNewSession: () => void;
}

export default function SessionSidebar({ onLoadSession, onNewSession }: SessionSidebarProps) {
  const {
    sessions,
    activeSessionId,
    fetchSessions,
    switchSession,
    deleteSession,
  } = useSessionStore();

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

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

  return (
    <div className="flex h-full w-64 flex-col border-r border-white/10 bg-[var(--color-surface)]">
      <div className="p-3">
        <button
          onClick={handleNew}
          className="flex w-full items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-sm text-[var(--color-text)] hover:bg-white/5"
        >
          <Plus size={16} />
          新对话
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {sessions.map((s) => (
          <div
            key={s.id}
            onClick={() => handleSwitch(s.id)}
            className={`group flex cursor-pointer items-center justify-between px-3 py-2.5 text-sm ${
              s.id === activeSessionId
                ? "bg-white/10 text-white"
                : "text-white/60 hover:bg-white/5 hover:text-white/80"
            }`}
          >
            <span className="flex-1 truncate">{s.title}</span>
            <span className="mr-2 shrink-0 text-xs text-white/30">
              {formatTime(s.updated_at)}
            </span>
            <button
              onClick={(e) => handleDelete(e, s.id)}
              className="hidden shrink-0 text-white/30 hover:text-red-400 group-hover:block"
              title="删除"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
