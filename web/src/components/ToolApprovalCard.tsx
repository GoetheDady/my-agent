import { useState } from 'react';
import { AlertTriangle, Check, ShieldQuestion, X } from 'lucide-react';

interface ToolApprovalCardProps {
  toolName: string;
  args: Record<string, unknown>;
  toolCallId: string;
  onApprove: (rememberChoice: boolean) => void;
  onDeny: () => void;
}

function getOperationDescription(toolName: string, args: Record<string, unknown>): string {
  if (toolName === 'read_file') {
    return `读取文件：${args.path}`;
  }
  if (toolName === 'write_file') {
    const mode = args.mode as string;
    const modeText = {
      overwrite: '覆盖',
      append: '追加到',
      create: '创建',
    }[mode] || mode;
    return `${modeText}文件：${args.path}`;
  }
  return `执行 ${toolName}`;
}

function getRiskLevel(toolName: string, args: Record<string, unknown>): 'low' | 'medium' | 'high' {
  if (toolName === 'read_file') return 'low';
  if (toolName === 'write_file') {
    return args.mode === 'overwrite' ? 'high' : 'medium';
  }
  return 'medium';
}

export function ToolApprovalCard({
  toolName,
  args,
  onApprove,
  onDeny,
}: ToolApprovalCardProps) {
  const [rememberChoice, setRememberChoice] = useState(false);
  const [processing, setProcessing] = useState(false);

  const description = getOperationDescription(toolName, args);
  const riskLevel = getRiskLevel(toolName, args);

  const handleApprove = () => {
    setProcessing(true);
    onApprove(rememberChoice);
  };

  const handleDeny = () => {
    setProcessing(true);
    onDeny();
  };

  const toneClass = riskLevel === 'high'
    ? 'border-[var(--color-danger)] bg-[var(--color-danger-soft)]'
    : riskLevel === 'medium'
      ? 'border-amber-300 bg-[var(--color-warning-soft)]'
      : 'border-blue-200 bg-[var(--color-accent-soft)]';

  return (
    <div className={`my-2 rounded-2xl border p-4 shadow-sm ${toneClass}`}>
      <div className="mb-2 flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/80 text-[var(--color-accent)] shadow-sm">
          <ShieldQuestion size={17} />
        </span>
        <div>
          <div className="text-sm font-semibold text-[var(--color-text)]">{toolName}</div>
          <div className="text-xs text-[var(--color-text-muted)]">需要授权后继续执行</div>
        </div>
      </div>

      <div className="mb-3 text-sm text-[var(--color-text)]">{description}</div>

      <div className="mb-3 rounded-lg border border-white/70 bg-white/80 p-2 font-mono text-xs text-[var(--color-text-muted)]">
        {Object.entries(args).map(([key, value]) => (
          <div key={key} className="flex gap-2">
            <span className="shrink-0 text-[var(--color-text-soft)]">{key}:</span>
            <span className="break-all text-[var(--color-text)]">{String(value)}</span>
          </div>
        ))}
      </div>

      {riskLevel === 'high' && (
        <div className="mb-3 flex items-center gap-1.5 text-sm font-medium text-[var(--color-danger)]">
          <AlertTriangle size={15} />
          <span>此操作可能覆盖现有文件，请谨慎操作</span>
        </div>
      )}

      <div className="space-y-3">
        <label className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
          <input
            type="checkbox"
            checked={rememberChoice}
            onChange={(e) => setRememberChoice(e.target.checked)}
            disabled={processing}
            className="h-4 w-4 rounded border-[var(--color-border)] accent-[var(--color-accent)]"
          />
          <span>记住此选择（添加到白名单）</span>
        </label>

        <div className="flex gap-2 justify-end">
          <button
            onClick={handleDeny}
            disabled={processing}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-white px-4 py-2 text-sm font-semibold text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text)] disabled:opacity-50"
          >
            <X size={14} />
            拒绝
          </button>
          <button
            onClick={handleApprove}
            disabled={processing}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[var(--color-accent-strong)] disabled:opacity-50"
          >
            <Check size={14} />
            批准
          </button>
        </div>
      </div>
    </div>
  );
}
