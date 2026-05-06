import { useEffect } from "react";
import { useSessionStore } from "../store/sessionStore";
import { useChatStore } from "../store/chatStore";

export default function SessionSidebar() {
  const {
    sessions,
    activeSessionId,
    fetchSessions,
    createSession,
    switchSession,
    deleteSession,
  } = useSessionStore();
  const { loadSession, clearMessages, setSessionId } = useChatStore();

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  async function handleNew() {
    clearMessages();
    const session = await createSession();
    switchSession(session.id);
    setSessionId(session.id);
  }

  async function handleSwitch(id: string) {
    if (id === activeSessionId) return;
    switchSession(id);
    try {
      await loadSession(id);
    } catch {
      useSessionStore.getState().setActiveSessionId(null);
      clearMessages();
    }
  }

  async function handleDelete(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    await deleteSession(id);
    if (id === activeSessionId) {
      clearMessages();
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
          className="w-full rounded-lg border border-white/10 px-3 py-2 text-sm text-[var(--color-text)] hover:bg-white/5"
        >
          + 新对话
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
              &times;
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
