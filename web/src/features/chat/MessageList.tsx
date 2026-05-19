import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import MessageBubble from "./MessageBubble";
import type { ToolApprovalSummary } from "../../types";
import type { ChatMessage } from "../../store/chatStore";

interface MessageListProps {
  messages: ChatMessage[];
  handleApprove?: (toolCallId: string, rememberChoice: boolean) => Promise<void> | void;
  handleDeny?: (toolCallId: string) => Promise<void> | void;
  approvals?: Record<string, ToolApprovalSummary>;
  approvalLoading?: Record<string, boolean>;
  approvalErrors?: Record<string, string | null>;
  registerApproval?: (input: { toolCallId: string; toolName: string; args: Record<string, unknown> }) => void;
}

interface RenderRange {
  start: number;
  end: number;
}

const estimatedMessageHeight = 156;
const overscanCount = 8;
const initialRenderCount = 36;

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
  const bottomSentinelRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const itemHeightsRef = useRef<Map<string, number>>(new Map());
  const isNearBottomRef = useRef(true);
  const [heightVersion, setHeightVersion] = useState(0);
  const [range, setRange] = useState<RenderRange>({
    start: 0,
    end: initialRenderCount,
  });

  const updateRange = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;

    const viewportTop = el.scrollTop;
    const viewportBottom = viewportTop + el.clientHeight;
    let currentTop = 0;
    let start = 0;

    while (start < messages.length) {
      const height = getMeasuredHeight(itemHeightsRef.current, messages[start]?.id);
      if (currentTop + height >= viewportTop) break;
      currentTop += height;
      start += 1;
    }

    let end = start;
    let currentBottom = currentTop;
    while (end < messages.length && currentBottom <= viewportBottom) {
      currentBottom += getMeasuredHeight(itemHeightsRef.current, messages[end]?.id);
      end += 1;
    }

    const nextRange = {
      start: Math.max(0, start - overscanCount),
      end: Math.min(messages.length, end + overscanCount),
    };

    setRange((current) => (
      current.start === nextRange.start && current.end === nextRange.end
        ? current
        : nextRange
    ));
  }, [messages]);

  const scheduleRangeUpdate = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null;
      updateRange();
    });
  }, [updateRange]);

  const handleScroll = useCallback(() => {
    scheduleRangeUpdate();
  }, [scheduleRangeUpdate]);

  const handleMeasured = useCallback((id: string, height: number) => {
    const previous = itemHeightsRef.current.get(id);
    if (previous !== undefined && Math.abs(previous - height) < 1) return;
    itemHeightsRef.current.set(id, height);
    setHeightVersion((version) => version + 1);
    scheduleRangeUpdate();
  }, [scheduleRangeUpdate]);

  useEffect(() => {
    const root = scrollRef.current;
    const sentinel = bottomSentinelRef.current;
    if (!root || !sentinel) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        isNearBottomRef.current = Boolean(entry?.isIntersecting);
      },
      { root, threshold: 0.1 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    scheduleRangeUpdate();
    if (isNearBottomRef.current && scrollRef.current) {
      window.requestAnimationFrame(() => {
        const el = scrollRef.current;
        if (!el) return;
        el.scrollTop = el.scrollHeight;
        scheduleRangeUpdate();
      });
    }
  }, [messages, scheduleRangeUpdate]);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  const visibleMessages = useMemo(
    () => messages.slice(range.start, range.end),
    [messages, range.end, range.start],
  );
  const topSpacer = useMemo(
    () => sumEstimatedHeights(messages, 0, range.start, itemHeightsRef.current),
    [heightVersion, messages, range.start],
  );
  const bottomSpacer = useMemo(
    () => sumEstimatedHeights(messages, range.end, messages.length, itemHeightsRef.current),
    [heightVersion, messages, range.end],
  );

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto bg-[var(--color-bg)] px-4 py-8"
    >
      <div className="mx-auto max-w-3xl" style={{ minHeight: "100%" }}>
        {messages.length === 0 && (
          <div className="flex items-center justify-center text-[var(--color-text-soft)]" style={{ minHeight: "60vh" }}>
            <p className="rounded-full border border-[var(--color-border-soft)] bg-white px-4 py-2 text-sm shadow-sm">输入消息开始对话</p>
          </div>
        )}
        {messages.length > 0 && (
          <div>
            <div style={{ height: topSpacer }} />
            <div className="space-y-4">
              {visibleMessages.map((msg) => (
                <MeasuredMessage
                  key={msg.id}
                  message={msg}
                  onMeasured={handleMeasured}
                  handleApprove={handleApprove}
                  handleDeny={handleDeny}
                  approvals={approvals}
                  approvalLoading={approvalLoading}
                  approvalErrors={approvalErrors}
                  registerApproval={registerApproval}
                />
              ))}
            </div>
            <div style={{ height: bottomSpacer }} />
          </div>
        )}
        <div ref={bottomSentinelRef} className="h-px" />
      </div>
    </div>
  );
}

const MeasuredMessage = memo(function MeasuredMessage({
  message,
  onMeasured,
  handleApprove,
  handleDeny,
  approvals,
  approvalLoading,
  approvalErrors,
  registerApproval,
}: {
  message: ChatMessage;
  onMeasured: (id: string, height: number) => void;
  handleApprove?: (toolCallId: string, rememberChoice: boolean) => Promise<void> | void;
  handleDeny?: (toolCallId: string) => Promise<void> | void;
  approvals?: Record<string, ToolApprovalSummary>;
  approvalLoading?: Record<string, boolean>;
  approvalErrors?: Record<string, string | null>;
  registerApproval?: (input: { toolCallId: string; toolName: string; args: Record<string, unknown> }) => void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = rowRef.current;
    if (!node) return;

    const measure = () => onMeasured(message.id, node.getBoundingClientRect().height);
    measure();

    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(node);

    const intersectionObserver = new IntersectionObserver(() => measure(), {
      root: findScrollParent(node),
      threshold: 0.01,
    });
    intersectionObserver.observe(node);

    return () => {
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
    };
  }, [message.id, onMeasured]);

  return (
    <div ref={rowRef}>
      <MessageBubble
        message={message}
        handleApprove={handleApprove}
        handleDeny={handleDeny}
        approvals={approvals}
        approvalLoading={approvalLoading}
        approvalErrors={approvalErrors}
        registerApproval={registerApproval}
      />
    </div>
  );
});

function getMeasuredHeight(heights: Map<string, number>, id: string | undefined): number {
  if (!id) return estimatedMessageHeight;
  return heights.get(id) ?? estimatedMessageHeight;
}

function sumEstimatedHeights(
  messages: ChatMessage[],
  start: number,
  end: number,
  heights: Map<string, number>,
): number {
  let sum = 0;
  for (let index = start; index < end; index += 1) {
    sum += getMeasuredHeight(heights, messages[index]?.id);
  }
  return sum;
}

function findScrollParent(node: HTMLElement): HTMLElement | null {
  let current: HTMLElement | null = node.parentElement;
  while (current) {
    const style = window.getComputedStyle(current);
    if (/(auto|scroll)/.test(style.overflowY)) return current;
    current = current.parentElement;
  }
  return null;
}
