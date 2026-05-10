import { useEffect } from "react";
import { Bot, CheckCircle2, Clock3, Folder, Hash } from "lucide-react";
import { InfoCard, PageScaffold, PageSection } from "../components/common/PageScaffold";
import { useRuntimeStore } from "../store/runtimeStore";

export default function AgentsPage() {
  const { agent, tasks, loading, error, fetchRuntimeSnapshot } = useRuntimeStore();

  useEffect(() => {
    fetchRuntimeSnapshot();
  }, [fetchRuntimeSnapshot]);

  return (
    <PageScaffold>
      <div className="grid gap-5 xl:grid-cols-[1fr_0.8fr]">
        <PageSection title="Default Agent" description="当前 MVP 只启用一个默认 Agent；数据结构已保留 agent_id。">
          <div className="grid gap-3">
            <RuntimeRow icon={Bot} label="名称" value={agent?.name ?? "Default Agent"} />
            <RuntimeRow icon={Hash} label="agent_id" value={agent?.id ?? "default"} />
            <RuntimeRow icon={CheckCircle2} label="状态" value={agent?.status ?? (loading ? "加载中" : "unknown")} />
            <RuntimeRow icon={Folder} label="工作目录" value={agent?.workspace_path ?? "未读取"} />
            {error && <div className="rounded-lg bg-[var(--color-danger-soft)] px-3 py-2 text-sm text-[var(--color-danger)]">{error}</div>}
          </div>
        </PageSection>
        <PageSection title="多 Agent 预留" description="这里先展示架构入口，不提前实现 delegation。">
          <div className="grid gap-3">
            <InfoCard title="单线程执行" description="同一个 Agent 同时只处理一个任务，避免并发写状态和记忆。" />
            <InfoCard title="后续 delegation" description="多 Agent 协作会从任务派发、权限边界和共享记忆视图开始扩展。" />
            <InfoCard title="当前任务数量" description={`runtime 当前返回 ${tasks.length} 条任务记录。`} />
          </div>
        </PageSection>
      </div>
    </PageScaffold>
  );
}

function RuntimeRow({ icon: Icon, label, value }: { icon: typeof Clock3; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg bg-[var(--color-surface-subtle)] px-4 py-3">
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white text-[var(--color-accent)] shadow-sm">
        <Icon size={16} />
      </span>
      <div className="min-w-0">
        <div className="text-xs text-[var(--color-text-soft)]">{label}</div>
        <div className="truncate text-sm font-semibold text-[var(--color-text)]">{value}</div>
      </div>
    </div>
  );
}
