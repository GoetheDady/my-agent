import { useState, useEffect, useRef } from "react";
import MarkdownContent from "./MarkdownContent";
import { Brain, CheckCircle2, ChevronDown, Clock3, Wrench, XCircle } from "lucide-react";
import { ToolApprovalCard } from "./ToolApprovalCard";
import { getNormalizedToolPart } from "../lib/toolPart";

interface MessagePart {
  type: string;
  text?: string;
  reasoning?: string;
  input?: unknown;
  toolCallId?: string;
  state?: string;
  approval?: { id?: string };
  errorText?: string;
  output?: unknown;
  toolInvocation?: { toolName: string; args: Record<string, unknown>; state: string; toolCallId: string };
}

interface AIMessage {
  id: string;
  role: string;
  parts: MessagePart[];
}

export default function MessageBubble({
  message,
  handleApprove,
  handleDeny,
}: {
  message: AIMessage;
  handleApprove?: (toolCallId: string, rememberChoice: boolean) => void;
  handleDeny?: (toolCallId: string) => void;
}) {
  const isUser = message.role === "user";

  if (isUser) {
    const text = message.parts
      .filter((p): p is { type: "text"; text: string } => p.type === "text" && typeof p.text === "string")
      .map((p) => p.text)
      .join("\n");
    return (
      <div className="flex justify-end">
        <div className="max-w-[78%] rounded-2xl rounded-br-md bg-[var(--color-user)] px-4 py-3 text-[var(--color-text)] shadow-sm ring-1 ring-blue-100">
          <p className="whitespace-pre-wrap text-[15px] leading-6">{text}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <div className="max-w-[86%] space-y-3">
        {message.parts.map((part, i) => {
          const tool = getNormalizedToolPart(part);

          // 检测工具审批请求
          if (tool?.state === 'approval-requested') {
            return (
              <ToolApprovalCard
                key={`approval-${tool.approvalId ?? tool.toolCallId ?? i}`}
                toolName={tool.toolName}
                args={tool.args}
                toolCallId={tool.approvalId ?? tool.toolCallId ?? ""}
                onApprove={(rememberChoice) =>
                  handleApprove?.(tool.approvalId ?? tool.toolCallId ?? "", rememberChoice)
                }
                onDeny={() => handleDeny?.(tool.approvalId ?? tool.toolCallId ?? "")}
              />
            );
          }
          if (part.type === "text" && part.text) {
            return (
              <div key={i} className="rounded-2xl rounded-bl-md border border-[var(--color-border-soft)] bg-white px-4 py-3 text-[var(--color-text)] shadow-sm">
                <MarkdownContent content={part.text} />
              </div>
            );
          }
          if ((part.type === "reasoning" || part.type === "thinking") && part.text) {
            return <ThinkingBlock key={i} content={part.text} />;
          }
          if (tool) {
            // 审批请求已经在上面处理了，这里处理其他状态
            if (tool.state === 'approval-requested') return null;
            const memoryTool = isMemoryTool(tool.toolName);
            const ToolIcon = memoryTool ? Brain : Wrench;

            return (
              <div key={i} className="rounded-xl border border-[var(--color-border)] bg-white px-3 py-3 text-xs shadow-sm">
                <div className="mb-2 flex items-center gap-2">
                  <span
                    className={`flex h-7 w-7 items-center justify-center rounded-lg ${
                      memoryTool
                        ? "bg-[var(--color-success-soft)] text-[var(--color-success)]"
                        : "bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
                    }`}
                  >
                    <ToolIcon size={14} />
                  </span>
                  <span className="font-semibold text-[var(--color-text)]">
                    {getToolDisplayName(tool.toolName)}
                  </span>
                  {tool.state === 'output-available' && (
                    <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-[var(--color-success-soft)] px-2 py-0.5 text-[11px] font-semibold text-[var(--color-success)]">
                      <CheckCircle2 size={12} />
                      完成
                    </span>
                  )}
                  {tool.state === 'output-error' && (
                    <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-[var(--color-danger-soft)] px-2 py-0.5 text-[11px] font-semibold text-[var(--color-danger)]">
                      <XCircle size={12} />
                      失败
                    </span>
                  )}
                  {tool.state === 'output-denied' && (
                    <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-[var(--color-danger-soft)] px-2 py-0.5 text-[11px] font-semibold text-[var(--color-danger)]">
                      <XCircle size={12} />
                      已拒绝
                    </span>
                  )}
                  {(tool.state === 'input-available' || tool.state === 'input-streaming') && (
                    <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-[var(--color-warning-soft)] px-2 py-0.5 text-[11px] font-semibold text-[var(--color-warning)]">
                      <Clock3 size={12} />
                      运行中
                    </span>
                  )}
                </div>
                <div className="space-y-1 rounded-lg bg-[var(--color-surface-subtle)] px-3 py-2 font-mono text-[11px] text-[var(--color-text-muted)]">
                  {Object.entries(tool.args).map(([key, value]) => (
                    <div key={key} className="flex gap-2">
                      <span className="shrink-0 text-[var(--color-text-soft)]">{key}:</span>
                      <span className="min-w-0 break-all text-[var(--color-text-muted)]">
                        {typeof value === 'string' && value.length > 60
                          ? value.slice(0, 60) + '...'
                          : String(value)}
                      </span>
                    </div>
                  ))}
                  {Object.keys(tool.args).length === 0 && (
                    <div className="text-[var(--color-text-soft)]">无输入参数</div>
                  )}
                </div>
                {tool.errorText && (
                  <div className="mt-2 rounded-lg bg-[var(--color-danger-soft)] px-3 py-2 text-[11px] text-[var(--color-danger)]">
                    {tool.errorText}
                  </div>
                )}
                {tool.state === "output-available" && tool.output !== undefined && (
                  <ToolOutput output={tool.output} />
                )}
              </div>
            );
          }
          return null;
        })}
      </div>
    </div>
  );
}

function isMemoryTool(toolName: string): boolean {
  return toolName.startsWith("memory_") || toolName.startsWith("memory.");
}

function getToolDisplayName(toolName: string): string {
  const labels: Record<string, string> = {
    read_file: "读取文件",
    write_file: "写入文件",
    list_directory: "列出目录",
    memory_search: "记忆检索",
    memory_get: "读取记忆",
    memory_propose: "写入记忆",
    memory_update: "更新记忆",
    memory_forget: "停用记忆",
    memory_extract: "记忆提取",
    memory_reconsolidate: "记忆再巩固",
  };
  return labels[toolName] ?? toolName.replace(/\./g, "_");
}

function ThinkingBlock({ content }: { content: string }) {
  const [isOpen, setIsOpen] = useState(true);
  const contentRef = useRef<HTMLDivElement>(null);
  const [contentHeight, setContentHeight] = useState<number | undefined>(undefined);

  useEffect(() => {
    if (contentRef.current) {
      setContentHeight(contentRef.current.scrollHeight);
    }
  }, [content, isOpen]);

  return (
    <div className="rounded-xl border border-[var(--color-border-soft)] bg-[var(--color-thinking)] px-3 py-2">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center gap-1.5 text-left text-xs font-medium text-[var(--color-text-soft)] transition-colors hover:text-[var(--color-text-muted)]"
      >
        <ChevronDown
          size={12}
          className={`transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
        />
        思考过程...
      </button>
      <div
        className="overflow-hidden transition-all duration-300 ease-in-out"
        style={{ maxHeight: isOpen ? (contentHeight ? contentHeight + 8 : 2000) : 0, opacity: isOpen ? 1 : 0 }}
      >
        <p
          ref={contentRef}
          className="mt-2 whitespace-pre-wrap text-xs leading-5 text-[var(--color-text-muted)]"
        >
          {content}
        </p>
      </div>
    </div>
  );
}

function ToolOutput({ output }: { output: unknown }) {
  const rows = outputToRows(output);
  if (rows.length === 0) return null;

  return (
    <div className="mt-2 space-y-1 rounded-lg bg-[var(--color-surface-subtle)] px-3 py-2 text-[11px] text-[var(--color-text-muted)]">
      {rows.map(([key, value]) => (
        <div key={key} className="flex gap-2">
          <span className="shrink-0 text-[var(--color-text-soft)]">{key}:</span>
          <span className="min-w-0 break-words">{value}</span>
        </div>
      ))}
    </div>
  );
}

function outputToRows(output: unknown): Array<[string, string]> {
  if (!output || typeof output !== "object" || Array.isArray(output)) {
    return [["结果", String(output)]];
  }

  return Object.entries(output as Record<string, unknown>)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => [key, formatOutputValue(value)]);
}

function formatOutputValue(value: unknown): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return "无";
    return value.map((item) => String(item)).join(", ");
  }
  if (typeof value === "object" && value !== null) {
    return JSON.stringify(value);
  }
  return String(value);
}
