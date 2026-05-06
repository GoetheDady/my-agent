import { useEffect, useRef } from "react";
import { useChatStore } from "../store/chatStore";
import MessageBubble from "./MessageBubble";

export default function MessageList() {
  const { messages, streamingBlocks, streamingMessageId } = useChatStore();
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
  }, [messages, streamingBlocks]);

  const streamingMsg = streamingMessageId && streamingBlocks.length > 0
    ? { id: streamingMessageId, role: "assistant" as const, blocks: streamingBlocks }
    : null;

  return (
    <div
      ref={scrollRef}
      onScroll={checkNearBottom}
      className="flex-1 overflow-y-auto px-4 py-6"
    >
      <div className="mx-auto max-w-3xl space-y-4" style={{ minHeight: "100%" }}>
        {messages.length === 0 && !streamingMsg && (
          <div className="flex items-center justify-center text-gray-500" style={{ minHeight: "60vh" }}>
            <p>输入消息开始对话</p>
          </div>
        )}
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        {streamingMsg && <MessageBubble message={streamingMsg} />}
      </div>
    </div>
  );
}
