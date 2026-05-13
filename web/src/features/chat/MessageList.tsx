import { useEffect, useRef } from "react";
import MessageBubble from "./MessageBubble";
import type { ToolApprovalSummary } from "../../types";

interface MessageListProps {
  messages: Array<{
    id: string;
    role: string;
    parts: Array<{ type: string; text?: string; reasoning?: string; toolInvocation?: { toolName: string; args: Record<string, unknown>; state: string; toolCallId: string } }>;
  }>;
  handleApprove?: (toolCallId: string, rememberChoice: boolean) => Promise<void> | void;
  handleDeny?: (toolCallId: string) => Promise<void> | void;
  approvals?: Record<string, ToolApprovalSummary>;
  approvalLoading?: Record<string, boolean>;
  approvalErrors?: Record<string, string | null>;
  registerApproval?: (input: { toolCallId: string; toolName: string; args: Record<string, unknown> }) => void;
}

export default function MessageList({
  messages,
  handleApprove,
  handleDeny,
  approvals,
  approvalLoading,
  approvalErrors,
  registerApproval,
}: MessageListProps) {
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
            handleApprove={handleApprove}
            handleDeny={handleDeny}
            approvals={approvals}
            approvalLoading={approvalLoading}
            approvalErrors={approvalErrors}
            registerApproval={registerApproval}
          />
        ))}
      </div>
    </div>
  );
}
