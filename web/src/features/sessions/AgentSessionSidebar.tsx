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
    return (
      <div key={agent.id} className="mb-4">
        <div className="group flex items-center gap-2 px-3 py-1.5">
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${
              isBusy ? "bg-amber-400" : agent.status === "idle" ? "bg-emerald-400" : "bg-gray-300"
            }`}
          />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-semibold text-[var(--color-text)]">
              {agent.config?.name || agent.name}
            </div>
            <div className="truncate text-[11px] text-[var(--color-text-soft)] font-mono">
              {agent.id}
            </div>
          </div>
          <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
            isBusy
              ? "bg-amber-50 text-amber-700"
              : agent.status === "idle"
                ? "bg-emerald-50 text-emerald-700"
                : "bg-gray-100 text-gray-500"
          }`}>
            {isBusy ? "忙碌" : agent.status === "idle" ? "空闲" : "离线"}
          </span>
          <button
            onClick={() => handleNewSession(agent.id)}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[var(--color-text-soft)] opacity-0 transition-opacity hover:bg-[var(--color-accent-soft)] hover:text-[var(--color-accent)] group-hover:opacity-100"
            title={`新建 ${agent.config?.name || agent.name} 对话`}
          >
            <Plus size={14} />
          </button>
        </div>
        {agentSessions.length > 0 && (
          <div className="ml-5 mt-0.5 space-y-0.5 border-l border-[var(--color-border-soft)] pl-3">
            {agentSessions.slice(0, 20).map((s) => (
              <div
                key={s.id}
                onClick={() => navigate(getSessionPath(s.id))}
                className={`group flex cursor-pointer items-center justify-between rounded-lg px-2.5 py-2 text-[13px] transition-colors ${
                  s.id === activeSessionId
                    ? "bg-white text-[var(--color-text)] shadow-sm ring-1 ring-[var(--color-border-soft)]"
                    : "text-[var(--color-text-muted)] hover:bg-white/70 hover:text-[var(--color-text)]"
                }`}
              >
                <span className="min-w-0 flex-1 truncate font-medium">{s.title}</span>
                <span className="ml-1.5 shrink-0 text-[10px] text-[var(--color-text-soft)]">
                  {formatTime(s.updated_at)}
                </span>
                <button
                  onClick={(e) => handleDelete(e, s.id)}
                  className="ml-1 hidden shrink-0 rounded p-0.5 text-[var(--color-text-soft)] hover:bg-[var(--color-danger-soft)] hover:text-[var(--color-danger)] group-hover:block"
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
    <aside className="flex h-full w-[272px] shrink-0 flex-col border-r border-[var(--color-border-soft)] bg-[#f3f5f8]">
      <div className="border-b border-[var(--color-border-soft)] px-4 py-4">
        <div className="mb-4 flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--color-accent)] text-white">
            <MessageSquare size={16} />
          </div>
          <div>
            <div className="text-sm font-semibold text-[var(--color-text)]">My Agent</div>
            <div className="text-[11px] text-[var(--color-text-soft)]">
              {agents.length} 个 Agent · {sessions.length} 个会话
            </div>
          </div>
        </div>
        <div className="flex gap-1.5">
          <button
            onClick={() => handleNewSession(selectedAgentId)}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[var(--color-accent)] px-3 py-2 text-[13px] font-semibold text-white shadow-sm transition-colors hover:bg-[var(--color-accent-strong)]"
          >
            <Plus size={15} />
            新建对话
          </button>
          <div className="relative flex-1">
            <select
              value={selectedAgentId}
              onChange={(e) => {
                useAgentStore.getState().setSelectedAgentId(e.target.value);
              }}
              className="h-full w-full appearance-none rounded-lg border border-[var(--color-border)] bg-white px-2.5 text-[12px] font-medium text-[var(--color-text)] outline-none cursor-pointer"
            >
              {agents.map((a) => (
                <option key={a.id} value={a.id}>{a.config?.name || a.name}</option>
              ))}
              {agents.length === 0 && <option value="default">default</option>}
            </select>
            <Bot size={12} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-text-soft)]" />
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pt-3 pb-3">
        {agents.length === 0 && (
          <div className="px-3 py-8 text-center text-xs text-[var(--color-text-soft)]">
            暂无 Agent
          </div>
        )}
        {busyAgents.map(renderAgentGroup)}
        {idleAgents.map(renderAgentGroup)}
        {offlineAgents.map(renderAgentGroup)}
      </div>
    </aside>
  );
}
