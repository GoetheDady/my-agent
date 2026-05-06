import { useRef } from "react";
import { useChatStore } from "../store/chatStore";

export default function ChatInput() {
  const { isLoading, sendMessage, abortRequest } = useChatStore();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function handleSend() {
    const text = textareaRef.current?.value.trim() ?? "";
    if (!text || isLoading) return;
    sendMessage(text);
    if (textareaRef.current) textareaRef.current.value = "";
    autoResize();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function autoResize() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }

  return (
    <div className="flex items-end gap-3 border-t border-white/10 bg-surface p-4">
      <textarea
        ref={textareaRef}
        className="flex-1 resize-none rounded-lg border border-white/10 bg-background px-4 py-3 text-foreground outline-none placeholder:text-white/30 focus:border-accent disabled:opacity-50"
        placeholder="输入消息..."
        rows={1}
        onKeyDown={handleKeyDown}
        onInput={autoResize}
        disabled={isLoading}
      />
      {isLoading ? (
        <button
          onClick={abortRequest}
          className="rounded-lg bg-red-600 px-5 py-3 text-white hover:bg-red-700 disabled:opacity-50"
        >
          停止
        </button>
      ) : (
        <button
          onClick={handleSend}
          className="rounded-lg bg-accent px-5 py-3 text-white hover:brightness-110 disabled:opacity-50"
        >
          发送
        </button>
      )}
    </div>
  );
}
