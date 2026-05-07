import { useState } from 'react';

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

  const borderColor = riskLevel === 'high' ? 'border-red-500' :
                      riskLevel === 'medium' ? 'border-yellow-500' :
                      'border-blue-500';

  const bgColor = riskLevel === 'high' ? 'bg-red-950' :
                  riskLevel === 'medium' ? 'bg-yellow-950' :
                  'bg-blue-950';

  return (
    <div className={`border rounded-lg p-4 my-2 ${borderColor} ${bgColor}`}>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xl">🔧</span>
        <span className="font-semibold text-foreground">{toolName}</span>
      </div>

      <div className="text-sm mb-3 text-foreground/90">{description}</div>

      <div className="text-xs bg-surface rounded p-2 mb-3 font-mono text-foreground/80">
        {Object.entries(args).map(([key, value]) => (
          <div key={key} className="flex gap-2">
            <span className="text-foreground/60">{key}:</span>
            <span className="text-foreground/90">{String(value)}</span>
          </div>
        ))}
      </div>

      {riskLevel === 'high' && (
        <div className="text-sm text-red-400 mb-3 flex items-center gap-1">
          <span>⚠️</span>
          <span>此操作可能覆盖现有文件，请谨慎操作</span>
        </div>
      )}

      <div className="space-y-3">
        <label className="flex items-center gap-2 text-sm text-foreground/90">
          <input
            type="checkbox"
            checked={rememberChoice}
            onChange={(e) => setRememberChoice(e.target.checked)}
            disabled={processing}
            className="rounded"
          />
          <span>记住此选择（添加到白名单）</span>
        </label>

        <div className="flex gap-2 justify-end">
          <button
            onClick={handleDeny}
            disabled={processing}
            className="px-4 py-2 rounded bg-surface hover:bg-surface/80 disabled:opacity-50 text-foreground transition-colors"
          >
            拒绝
          </button>
          <button
            onClick={handleApprove}
            disabled={processing}
            className="px-4 py-2 rounded bg-accent hover:bg-accent/80 disabled:opacity-50 text-foreground transition-colors"
          >
            批准
          </button>
        </div>
      </div>
    </div>
  );
}
