import { useState, useEffect, useRef } from "react";
import type { Message, DisplayBlock } from "../types";
import MarkdownContent from "./MarkdownContent";
import { ChevronDown } from "lucide-react";

export default function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-surface px-4 py-3 text-foreground">
          {message.blocks.map((b, i) => (
            <p key={i} className="whitespace-pre-wrap text-sm">{b.content}</p>
          ))}
        </div>
    </div>
  );
}

function MemoryStatusBar({ blocks }: { blocks: DisplayBlock[] }) {
  const lastTextBlock = blocks.findLast((b) => b.type === "text");
  if (!lastTextBlock?.memoryStatus) return null;

  if (lastTextBlock.memoryStatus === "loading") {
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

  if (lastTextBlock.memoryStatus === "success") {
    return <FadeOutText text={`已提取 ${lastTextBlock.memoryCount ?? 0} 条记忆`} color="text-white/30" />;
  }

  if (lastTextBlock.memoryStatus === "error") {
    return <FadeOutText text="记忆提取失败" color="text-red-400/60" />;
  }

  return null;
}

function FadeOutText({ text, color }: { text: string; color: string }) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), 3000);
    return () => clearTimeout(timer);
  }, []);

  if (!visible) return null;

  return (
    <div className={`px-2 py-1 text-xs ${color} transition-opacity duration-500`}>
      {text}
    </div>
  );
}

  return (
    <div className="flex justify-start">
      <div className="max-w-[80%] space-y-2">
        {message.blocks.map((block, i) => (
          <BlockRenderer key={i} block={block} />
        ))}
        <MemoryStatusBar blocks={message.blocks} />
      </div>
    </div>
  );
}

function BlockRenderer({ block }: { block: DisplayBlock }) {
  switch (block.type) {
    case "text":
      return (
        <div className="rounded-2xl rounded-bl-sm bg-assistant px-4 py-3 text-foreground">
          <MarkdownContent content={block.content} />
        </div>
      );
    case "thinking":
      return <ThinkingBlock block={block} />;
    case "tool_use":
      return null;
    default:
      return null;
  }
}

function ThinkingBlock({ block }: { block: DisplayBlock }) {
  const [isOpen, setIsOpen] = useState(!block.collapsed);
  const contentRef = useRef<HTMLDivElement>(null);
  const [contentHeight, setContentHeight] = useState<number | undefined>(undefined);

  useEffect(() => {
    setIsOpen(!block.collapsed);
  }, [block.collapsed]);

  useEffect(() => {
    if (contentRef.current) {
      setContentHeight(contentRef.current.scrollHeight);
    }
  }, [block.content, isOpen]);

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
          {block.content}
        </p>
      </div>
    </div>
  );
}
