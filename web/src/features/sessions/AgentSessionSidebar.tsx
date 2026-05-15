import { useEffect, useMemo } from "react";
import { useNavigate } from "react-router";
import {
  Bot,
  MessageSquare,
  Plus,
  Trash2,
} from "lucide-react";
import { useAgentStore } from "../../store/agentStore";
import { useSessionStore } from "../../store/sessionStore";
import { getSessionPath } from "../../lib/sessionRoute";
import type { AgentSummary, Session } from "../../types";

export default function AgentSessionSidebar() {
  const navigate = useNavigate();
  const agents = useAgentStore((s) => s.agents);
  const fetchAgents = useAgentStore((s) => s.fetchAgents);
  const selectedAgentId = useAgentStore((s) => s.selectedAgentId);
  const sessions = useSessionStore((s) => s.sessions);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const fetchSessions = useSessionStore((s) => s.fetchSessions);
  const deleteSession = useSessionStore((s) => s.deleteSession);

  useEffect(() => {
    fetchAgents();
    fetchSessions();
  }, [fetchAgents, fetchSessions]);

  const sessionsByAgent = useMemo(() => {
    const map: Record<string, Session[]> = {};
    for (const s of sessions) {
      (map[s.agent_id] ??= []).push(s);
    }
    for (const [, list] of Object.entries(map)) {
      list.sort((a, b) => b.updated_at - a.updated_at);
    }
    return map;
  }, [sessions]);

  async function handleNewSession(agentId: string) {
    const session = await useSessionStore.getState().createSession(agentId);
    navigate(getSessionPath(session.id));
  }

  async function handleDelete(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    await deleteSession(id);
    if (id === activeSessionId) navigate("/");
  }

  function formatTime(ts: number): string {
    const d = new Date(ts);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
    }
    return d.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
  }

  const idleAgents = agents.filter((a) => a.status === "idle");
  const busyAgents = agents.filter((a) => a.status === "running");
  const offlineAgents = agents.filter((a) => a.status !== "idle" && a.status !== "running");

  function renderAgentGroup(agent: AgentSummary) {
    const agentSessions = sessionsByAgent[agent.id] ?? [];
    const isBusy = agent.status === "running";
    const isOffline = agent.status !== "idle" && agent.status !== "running";
    return (
      <div key={agent.id} className="mb-3">
        <div className="group flex items-center gap-2.5 rounded-xl px-3 py-2 transition-colors hover:bg-white/60">
          <span className="relative flex h-2 w-2 shrink-0 items-center justify-center">
            {isBusy ? (
              <>
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-400" />
              </>
            ) : (
              <span className={`inline-flex h-2 w-2 rounded-full ${
                agent.status === "idle" ? "bg-emerald-400 shadow-[0_0_6px_rgba(22,131,74,0.3)]" : "bg-gray-300"
              }`} />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-semibold leading-tight text-[var(--color-text)]">
              {agent.config?.name || agent.name}
            </div>
            {!isOffline && (
              <div className="truncate text-[10px] font-medium text-[var(--color-text-soft)]">
                {isBusy ? "任务执行中" : "就绪"}
              </div>
            )}
          </div>
          <button
            onClick={() => handleNewSession(agent.id)}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[var(--color-text-soft)] opacity-0 transition-all duration-150 hover:bg-[var(--color-accent-soft)] hover:text-[var(--color-accent)] hover:scale-110 group-hover:opacity-100"
            title={`新建 ${agent.config?.name || agent.name} 对话`}
          >
            <Plus size={14} />
          </button>
        </div>
        {agentSessions.length > 0 && (
          <div className="ml-4 mt-0.5 space-y-px border-l-2 border-[var(--color-border-soft)] pl-3">
            {agentSessions.slice(0, 20).map((s) => (
              <div
                key={s.id}
                onClick={() => navigate(getSessionPath(s.id))}
                className={`group relative flex cursor-pointer items-center justify-between rounded-r-lg px-2.5 py-2 text-[13px] transition-all duration-150 ${
                  s.id === activeSessionId
                    ? "-ml-[14px] border-l-[3px] border-[var(--color-accent)] bg-white pl-4 text-[var(--color-text)] shadow-sm"
                    : "text-[var(--color-text-muted)] hover:bg-white/60 hover:text-[var(--color-text)] hover:pl-3"
                }`}
              >
                <span className="min-w-0 flex-1 truncate font-medium leading-snug">{s.title}</span>
                <span className="ml-2 shrink-0 text-[10px] font-medium text-[var(--color-text-soft)] tabular-nums">
                  {formatTime(s.updated_at)}
                </span>
                <button
                  onClick={(e) => handleDelete(e, s.id)}
                  className="ml-1 hidden shrink-0 rounded p-1 text-[var(--color-text-soft)] transition-colors hover:bg-[var(--color-danger-soft)] hover:text-[var(--color-danger)] group-hover:inline-flex"
                  title="删除"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <aside className="flex h-full w-[280px] shrink-0 flex-col border-r border-[var(--color-border-soft)] bg-gradient-to-b from-[#f5f6fa] via-[#f0f2f7] to-[#eaecf3]">
      <div className="border-b border-[var(--color-border-soft)] bg-white/60 px-4 pb-4 pt-5 backdrop-blur">
        <div className="mb-4 flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[var(--color-accent)] to-[var(--color-accent-strong)] text-white shadow-[0_4px_12px_rgba(47,95,221,0.25)]">
            <MessageSquare size={16} />
          </div>
          <div>
            <div className="text-[14px] font-bold leading-tight text-[var(--color-text)]">My Agent</div>
            <div className="mt-0.5 text-[11px] font-medium text-[var(--color-text-soft)]">
              {agents.length} 个 Agent · {sessions.length} 个会话
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => handleNewSession(selectedAgentId)}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-[var(--color-accent)] px-3 py-2.5 text-[13px] font-semibold text-white shadow-[0_2px_8px_rgba(47,95,221,0.3)] transition-all duration-150 hover:bg-[var(--color-accent-strong)] hover:shadow-[0_4px_14px_rgba(47,95,221,0.35)] hover:-translate-y-px active:translate-y-0"
          >
            <Plus size={16} />
            新建对话
          </button>
          <div className="relative flex-1">
            <select
              value={selectedAgentId}
              onChange={(e) => {
                useAgentStore.getState().setSelectedAgentId(e.target.value);
              }}
              className="h-full w-full appearance-none rounded-xl border border-[var(--color-border)] bg-white/80 px-3 text-[12px] font-semibold text-[var(--color-text)] outline-none transition-colors hover:bg-white hover:border-[var(--color-accent)]/30 focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent-soft)] cursor-pointer"
            >
              {agents.map((a) => (
                <option key={a.id} value={a.id}>{a.config?.name || a.name}</option>
              ))}
              {agents.length === 0 && <option value="default">default</option>}
            </select>
            <Bot size={12} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-soft)]" />
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2.5 pt-4 pb-3">
        {agents.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-[var(--color-border)] bg-white/40 px-4 py-10 text-center">
            <Bot size={28} className="text-[var(--color-text-soft)] opacity-40" />
            <div className="text-[12px] font-medium text-[var(--color-text-soft)]">暂无 Agent</div>
            <div className="text-[11px] text-[var(--color-text-soft)]/60">启动后端服务后自动发现</div>
          </div>
        )}
        {busyAgents.map(renderAgentGroup)}
        {idleAgents.map(renderAgentGroup)}
        {offlineAgents.map(renderAgentGroup)}
      </div>
    </aside>
  );
}
