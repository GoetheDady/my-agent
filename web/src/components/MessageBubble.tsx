import { useState, useEffect, useRef } from "react";
import MarkdownContent from "./MarkdownContent";
import { ChevronDown } from "lucide-react";
import { ToolApprovalCard } from "./ToolApprovalCard";
import type { MemoryExtractStatus } from "../store/chatStore";

interface MessagePart {
  type: string;
  text?: string;
  reasoning?: string;
  toolInvocation?: { toolName: string; args: Record<string, unknown>; state: string; toolCallId: string };
}

interface AIMessage {
  id: string;
  role: string;
  parts: MessagePart[];
}

export default function MessageBubble({
  message,
  memoryStatus,
  handleApprove,
  handleDeny,
}: {
  message: AIMessage;
  memoryStatus?: MemoryExtractStatus;
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
        <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-surface px-4 py-3 text-foreground">
          <p className="whitespace-pre-wrap text-sm">{text}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <div className="max-w-[80%] space-y-2">
        {message.parts.map((part, i) => {
          // 检测工具审批请求
          if (part.type === 'tool-invocation' &&
              part.toolInvocation?.state === 'approval-requested') {
            return (
              <ToolApprovalCard
                key={`approval-${part.toolInvocation.toolCallId}`}
                toolName={part.toolInvocation.toolName}
                args={part.toolInvocation.args}
                toolCallId={part.toolInvocation.toolCallId}
                onApprove={(rememberChoice) =>
                  handleApprove?.(part.toolInvocation!.toolCallId, rememberChoice)
                }
                onDeny={() => handleDeny?.(part.toolInvocation!.toolCallId)}
              />
            );
          }
          if (part.type === "text" && part.text) {
            return (
              <div key={i} className="rounded-2xl rounded-bl-sm bg-assistant px-4 py-3 text-foreground">
                <MarkdownContent content={part.text} />
              </div>
            );
          }
          if ((part.type === "reasoning" || part.type === "thinking") && part.text) {
            return <ThinkingBlock key={i} content={part.text} />;
          }
          if (part.type === "tool-invocation" && part.toolInvocation) {
            const { toolName, args, state } = part.toolInvocation;

            // 审批请求已经在上面处理了，这里处理其他状态
            if (state === 'approval-requested') return null;

            return (
              <div key={i} className="rounded-lg border border-white/10 bg-surface/50 px-3 py-2 text-xs">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-blue-400">🔧</span>
                  <span className="font-medium text-white/70">
                    {toolName === 'read_file' ? '读取文件' :
                     toolName === 'write_file' ? '写入文件' : toolName}
                  </span>
                  {state === 'result' && <span className="text-green-400">✓</span>}
                  {state === 'call' && <span className="text-yellow-400 animate-pulse">⋯</span>}
                </div>
                <div className="text-white/40 font-mono text-[10px] space-y-0.5">
                  {Object.entries(args).map(([key, value]) => (
                    <div key={key}>
                      <span className="text-white/30">{key}:</span>{' '}
                      <span className="text-white/50">
                        {typeof value === 'string' && value.length > 60
                          ? value.slice(0, 60) + '...'
                          : String(value)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
          }
          return null;
        })}
        <MemoryStatusBar memoryStatus={memoryStatus} />
      </div>
    </div>
  );
}

function MemoryStatusBar({ memoryStatus }: { memoryStatus?: MemoryExtractStatus }) {
  if (!memoryStatus) return null;

  if (memoryStatus.status === "loading") {
    return (
      <div className="flex items-center gap-1.5 px-2 py-1 text-xs text-white/30">
        <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        记忆提取中...
      </div>
    );
  }

  if (memoryStatus.status === "success") {
    if (memoryStatus.count === 0) {
      return <div className="px-2 py-1 text-xs text-white/20">无可提取记忆</div>;
    }
    return <div className="px-2 py-1 text-xs text-white/30">已提取 {memoryStatus.count} 条记忆</div>;
  }

  if (memoryStatus.status === "error") {
    return <div className="px-2 py-1 text-xs text-red-400/60">记忆提取失败</div>;
  }

  return null;
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
    <div className="rounded-lg bg-thinking px-3 py-2">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center gap-1.5 text-left text-xs italic text-white/40 hover:text-white/60 transition-colors"
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
          className="mt-2 whitespace-pre-wrap text-xs italic text-white/50"
        >
          {content}
        </p>
      </div>
    </div>
  );
}
