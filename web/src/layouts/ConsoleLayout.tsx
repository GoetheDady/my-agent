import { NavLink, Outlet } from "react-router";
import {
  Activity,
  ArrowLeft,
  Bot,
  Brain,
  Cable,
  ClipboardList,
  GitBranch,
  Settings,
  Sparkles,
  Wrench,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useAgentStore } from "../store/agentStore";
import { WORKBENCH_PATH } from "../lib/sessionRoute";

interface ConsoleNavItem {
  label: string;
  path: string;
  icon: LucideIcon;
}

const subNav: ConsoleNavItem[] = [
  { label: "总览", path: "/console", icon: Activity },
  { label: "Agents", path: "/console/agents", icon: Bot },
  { label: "Tasks", path: "/console/tasks", icon: ClipboardList },
  { label: "Tools", path: "/console/tools", icon: Wrench },
  { label: "Skills", path: "/console/skills", icon: Brain },
  { label: "Memory", path: "/console/memory", icon: Brain },
  { label: "Events", path: "/console/events", icon: Sparkles },
  { label: "渠道", path: "/console/channels", icon: Cable },
  { label: "工作台", path: WORKBENCH_PATH, icon: GitBranch },
  { label: "设置", path: "/console/settings", icon: Settings },
];

export default function ConsoleLayout() {
  const selectedAgentId = useAgentStore((s) => s.selectedAgentId);

  return (
    <div className="flex h-screen bg-[var(--color-bg)] text-[var(--color-text)]">
      <aside className="flex w-[232px] shrink-0 flex-col border-r border-[var(--color-border-soft)] bg-gradient-to-b from-white via-white to-[#f8f9fc]">
        <NavLink
          to="/"
          className="group flex items-center gap-2.5 border-b border-[var(--color-border-soft)] bg-white/80 px-5 py-4 text-[13px] font-semibold text-[var(--color-text-muted)] backdrop-blur transition-colors hover:text-[var(--color-accent)]"
        >
          <ArrowLeft size={16} className="transition-transform duration-150 group-hover:-translate-x-1" />
          返回对话
        </NavLink>
        <nav className="flex-1 overflow-y-auto px-3 py-4">
          {subNav.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.path === "/console"}
                className={({ isActive }) =>
                  `relative mb-0.5 flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-[13px] font-medium transition-all duration-150 ${
                    isActive
                      ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)] before:absolute before:left-0 before:top-2 before:bottom-2 before:w-[3px] before:rounded-r-full before:bg-[var(--color-accent)]"
                      : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text)]"
                  }`
                }
              >
                <Icon size={16} />
                {item.label}
              </NavLink>
            );
          })}
        </nav>
        <div className="border-t border-[var(--color-border-soft)] bg-white/60 px-4 py-3 backdrop-blur">
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(22,131,74,0.3)]" />
            <span className="text-[11px] font-medium text-[var(--color-text-soft)]">
              当前 Agent <span className="font-mono font-semibold text-[var(--color-text)]">{selectedAgentId}</span>
            </span>
          </div>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex min-h-[52px] items-center border-b border-[var(--color-border-soft)] bg-white/80 px-6 backdrop-blur-xl">
          <div className="text-[13px] font-bold text-[var(--color-text)] tracking-tight">控制台</div>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto bg-[var(--color-bg)] p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
