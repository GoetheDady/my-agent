import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, ShieldQuestion, X } from 'lucide-react';
import type { ToolApprovalSummary, ToolRiskLevel } from '../../types';

const rememberChoiceState = new Map<string, boolean>();

interface ToolApprovalCardProps {
  toolName: string;
  args: Record<string, unknown>;
  toolCallId: string;
  approval?: ToolApprovalSummary;
  loading?: boolean;
  error?: string | null;
  onRegister: () => void;
  onApprove: (rememberChoice: boolean) => Promise<void> | void;
  onDeny: () => Promise<void> | void;
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

function getRiskLevel(toolName: string, args: Record<string, unknown>): ToolRiskLevel {
  if (toolName === 'read_file') return 'low';
  if (toolName === 'write_file') {
    return args.mode === 'overwrite' ? 'high' : 'medium';
  }
  return 'medium';
}

export function ToolApprovalCard({
  toolName,
  args,
  toolCallId,
  approval,
  loading,
  error,
  onRegister,
  onApprove,
  onDeny,
}: ToolApprovalCardProps) {
  const [rememberChoice, setRememberChoice] = useState(() => rememberChoiceState.get(toolCallId) ?? false);
  const [processing, setProcessing] = useState(false);
  const registeredToolCallIdRef = useRef<string | null>(null);

  const description = getOperationDescription(toolName, args);
  const riskLevel = approval?.riskLevel ?? getRiskLevel(toolName, args);
  const canRemember = toolName === 'write_file' && typeof args.path === 'string';
  const pendingApproval = approval?.status === 'pending';
  const actionDisabled = processing || loading || !approval || !pendingApproval;

  useEffect(() => {
    if (registeredToolCallIdRef.current !== toolCallId) {
      registeredToolCallIdRef.current = null;
    }
    if (!approval && !loading && registeredToolCallIdRef.current !== toolCallId) {
      registeredToolCallIdRef.current = toolCallId;
      onRegister();
    }
  }, [approval, loading, onRegister, toolCallId]);

  const handleApprove = async () => {
    setProcessing(true);
    try {
      await onApprove(rememberChoice && canRemember);
    } finally {
      setProcessing(false);
    }
  };

  const handleDeny = async () => {
    setProcessing(true);
    try {
      await onDeny();
    } finally {
      setProcessing(false);
    }
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
          <div className="text-xs text-[var(--color-text-muted)]">
            {loading ? '正在登记审批记录' : approval ? `审批状态：${approval.status}` : '需要授权后继续执行'}
          </div>
        </div>
      </div>

      <div className="mb-3 text-sm text-[var(--color-text)]">{description}</div>
      {approval?.reason && (
        <div className="mb-3 rounded-lg bg-white/70 px-3 py-2 text-xs text-[var(--color-text-muted)]">
          策略原因：{approval.reason}
        </div>
      )}
      {error && (
        <div className="mb-3 rounded-lg bg-[var(--color-danger-soft)] px-3 py-2 text-xs text-[var(--color-danger)]">
          {error}
        </div>
      )}

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
            onChange={(e) => {
              const next = e.target.checked;
              rememberChoiceState.set(toolCallId, next);
              setRememberChoice(next);
            }}
            disabled={actionDisabled || !canRemember}
            className="h-4 w-4 rounded border-[var(--color-border)] accent-[var(--color-accent)]"
          />
          <span>{canRemember ? '记住此路径（加入当前 Agent 白名单）' : '此工具暂不支持记住选择'}</span>
        </label>

        <div className="flex gap-2 justify-end">
          <button
            onClick={handleDeny}
            disabled={actionDisabled}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-white px-4 py-2 text-sm font-semibold text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text)] disabled:opacity-50"
          >
            <X size={14} />
            拒绝
          </button>
          <button
            onClick={handleApprove}
            disabled={actionDisabled}
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
