import { useState, useEffect, useRef } from "react";
import MarkdownContent from "./MarkdownContent";
import { ChevronDown } from "lucide-react";
import type { MemoryExtractStatus } from "../store/chatStore";

interface MessagePart {
  type: string;
  text?: string;
  reasoning?: string;
  toolInvocation?: { toolName: string; args: Record<string, unknown>; state: string };
}

interface AIMessage {
  id: string;
  role: string;
  parts: MessagePart[];
}

export default function MessageBubble({ message, memoryStatus }: { message: AIMessage; memoryStatus?: MemoryExtractStatus }) {
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
            return null;
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
