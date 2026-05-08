import { useEffect, useRef } from "react";
import MessageBubble from "./MessageBubble";
import type { MemoryExtractStatus } from "../store/chatStore";

interface MessageListProps {
  messages: Array<{
    id: string;
    role: string;
    parts: Array<{ type: string; text?: string; reasoning?: string; toolInvocation?: { toolName: string; args: Record<string, unknown>; state: string; toolCallId: string } }>;
  }>;
  memoryStatusMap: Record<string, MemoryExtractStatus>;
  handleApprove?: (toolCallId: string, rememberChoice: boolean) => void;
  handleDeny?: (toolCallId: string) => void;
}

export default function MessageList({ messages, memoryStatusMap, handleApprove, handleDeny }: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);

  function checkNearBottom() {
    const el = scrollRef.current;
    if (!el) return;
    isNearBottomRef.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 50;
  }

  useEffect(() => {
    if (isNearBottomRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  return (
    <div
      ref={scrollRef}
      onScroll={checkNearBottom}
      className="flex-1 overflow-y-auto bg-[var(--color-bg)] px-4 py-8"
    >
      <div className="mx-auto max-w-3xl space-y-4" style={{ minHeight: "100%" }}>
        {messages.length === 0 && (
          <div className="flex items-center justify-center text-[var(--color-text-soft)]" style={{ minHeight: "60vh" }}>
            <p className="rounded-full border border-[var(--color-border-soft)] bg-white px-4 py-2 text-sm shadow-sm">输入消息开始对话</p>
          </div>
        )}
        {messages.map((msg) => (
          <MessageBubble
            key={msg.id}
            message={msg}
            memoryStatus={memoryStatusMap[msg.id]}
            handleApprove={handleApprove}
            handleDeny={handleDeny}
          />
        ))}
      </div>
    </div>
  );
}
