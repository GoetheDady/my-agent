import { NavLink, Outlet } from "react-router";
import {
  Activity,
  ArrowLeft,
  Bot,
  Brain,
  Cable,
  ClipboardList,
  Settings,
  Sparkles,
  Wrench,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useAgentStore } from "../store/agentStore";

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
  { label: "设置", path: "/console/settings", icon: Settings },
];

export default function ConsoleLayout() {
  const selectedAgentId = useAgentStore((s) => s.selectedAgentId);

  return (
    <div className="flex h-screen bg-[var(--color-bg)] text-[var(--color-text)]">
      <aside className="flex w-[220px] shrink-0 flex-col border-r border-[var(--color-border-soft)] bg-white">
        <NavLink
          to="/"
          className="flex items-center gap-2 border-b border-[var(--color-border-soft)] px-5 py-4 text-[13px] font-semibold text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text)]"
        >
          <ArrowLeft size={16} />
          返回对话
        </NavLink>
        <nav className="flex-1 overflow-y-auto px-3 py-3">
          {subNav.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.path === "/console"}
                className={({ isActive }) =>
                  `mb-0.5 flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-[13px] font-medium transition-colors ${
                    isActive
                      ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
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
        <div className="border-t border-[var(--color-border-soft)] px-4 py-3">
          <div className="text-[11px] text-[var(--color-text-soft)]">
            Agent: <span className="font-mono font-semibold text-[var(--color-text)]">{selectedAgentId}</span>
          </div>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex min-h-[52px] items-center border-b border-[var(--color-border-soft)] bg-white/95 px-6 backdrop-blur">
          <div className="text-[13px] font-semibold text-[var(--color-text)]">控制台</div>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
