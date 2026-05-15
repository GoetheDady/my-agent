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
        <header className="flex min-h-[52px] items-center justify-end gap-3 border-b border-[var(--color-border-soft)] bg-white/95 px-6 backdrop-blur">
          <div
            className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
              realtimeStatus === "connected"
                ? "bg-emerald-50 text-emerald-700"
                : realtimeStatus === "connecting"
                  ? "bg-amber-50 text-amber-700"
                  : "bg-red-50 text-red-600"
            }`}
          >
            {realtimeStatus === "connected" ? "实时已连接" : realtimeStatus === "connecting" ? "实时连接中" : "实时离线"}
          </div>
          <button
            onClick={() => navigate(CONSOLE_PATH)}
            className="flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-white px-3 py-1.5 text-[13px] font-semibold text-[var(--color-text-muted)] shadow-sm transition-colors hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text)]"
            title="控制台"
          >
            <Settings size={15} />
            控制台
          </button>
        </header>
        <Outlet />
      </div>
    </div>
  );
}
