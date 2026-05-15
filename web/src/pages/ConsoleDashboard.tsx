import { RuntimeSummary } from "../features/runtime/RuntimeSummary";

export default function ConsoleDashboard() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-[var(--color-text)]">总览</h1>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          Runtime 状态、任务执行和事件摘要。
        </p>
      </div>
      <RuntimeSummary mode="tasks" />
    </div>
  );
}
