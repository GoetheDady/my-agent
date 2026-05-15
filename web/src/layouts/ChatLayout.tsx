import { Outlet, useNavigate } from "react-router";
import { Settings } from "lucide-react";
import { useEffect } from "react";
import AgentSessionSidebar from "../features/sessions/AgentSessionSidebar";
import { CONSOLE_PATH } from "../lib/sessionRoute";
import { useRealtimeStore, buildCurrentRealtimeSubscription } from "../store/realtimeStore";
import { useAgentStore } from "../store/agentStore";
import { useChatStore } from "../store/chatStore";

export default function ChatLayout() {
  const navigate = useNavigate();
  const realtimeStatus = useRealtimeStore((s) => s.status);
  const connectRealtime = useRealtimeStore((s) => s.connect);
  const subscribeRealtime = useRealtimeStore((s) => s.subscribe);
  const selectedAgentId = useAgentStore((s) => s.selectedAgentId);
  const sessionId = useChatStore((s) => s.sessionId);

  useEffect(() => {
    connectRealtime();
  }, [connectRealtime]);

  useEffect(() => {
    subscribeRealtime(buildCurrentRealtimeSubscription());
  }, [selectedAgentId, sessionId, subscribeRealtime]);

  return (
    <div className="flex h-screen bg-[var(--color-bg)] text-[var(--color-text)]">
      <AgentSessionSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex min-h-[52px] items-center justify-end gap-3 border-b border-[var(--color-border-soft)] bg-white/80 px-6 backdrop-blur-xl">
          <div className="flex items-center gap-2">
            <span className={`h-1.5 w-1.5 rounded-full ${
              realtimeStatus === "connected"
                ? "bg-emerald-400 shadow-[0_0_6px_rgba(22,131,74,0.5)]"
                : realtimeStatus === "connecting"
                  ? "bg-amber-400 animate-pulse"
                  : "bg-red-400"
            }`} />
            <span className="text-[11px] font-medium text-[var(--color-text-soft)]">
              {realtimeStatus === "connected" ? "已连接" : realtimeStatus === "connecting" ? "连接中" : "离线"}
            </span>
          </div>
          <div className="h-6 w-px bg-[var(--color-border)]" />
          <button
            onClick={() => navigate(CONSOLE_PATH)}
            className="group flex items-center gap-2 rounded-xl border border-[var(--color-border)] bg-white/60 px-4 py-2 text-[13px] font-semibold text-[var(--color-text-muted)] shadow-sm transition-all duration-150 hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text)] hover:border-[var(--color-accent)]/20 hover:shadow-[0_2px_12px_rgba(47,95,221,0.08)]"
            title="控制台"
          >
            <Settings size={15} className="transition-transform duration-300 group-hover:rotate-90" />
            控制台
          </button>
        </header>
        <Outlet />
      </div>
    </div>
  );
}
