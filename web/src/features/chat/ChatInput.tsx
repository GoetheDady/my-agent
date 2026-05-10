import { useRef } from "react";
import { ArrowUp, Square, Lightbulb } from "lucide-react";

interface ChatInputProps {
  isLoading: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  thinkingEnabled: boolean;
  onToggleThinking: () => void;
}

export default function ChatInput({ isLoading, onSend, onStop, thinkingEnabled, onToggleThinking }: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function handleSend() {
    const text = textareaRef.current?.value.trim() ?? "";
    if (!text || isLoading) return;
    onSend(text);
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
    <div className="border-t border-[var(--color-border-soft)] bg-white px-4 py-4">
      <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-2xl border border-[var(--color-border)] bg-white p-2 shadow-[var(--shadow-soft)]">
        <button
          onClick={onToggleThinking}
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors ${
            thinkingEnabled
              ? "bg-[var(--color-warning-soft)] text-[var(--color-warning)]"
              : "text-[var(--color-text-soft)] hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text-muted)]"
          }`}
          title={thinkingEnabled ? "关闭深度思考" : "开启深度思考"}
        >
          <Lightbulb size={18} />
        </button>
        <textarea
          ref={textareaRef}
          className="min-h-10 flex-1 resize-none bg-transparent px-2 py-2.5 text-[15px] leading-6 text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-soft)] disabled:opacity-50"
          placeholder="输入消息，Enter 发送，Shift + Enter 换行"
          rows={1}
          onKeyDown={handleKeyDown}
          onInput={autoResize}
          disabled={isLoading}
        />
        {isLoading ? (
        <button
          onClick={onStop}
          className="flex h-10 items-center gap-1.5 rounded-xl bg-[var(--color-danger)] px-4 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-50"
        >
          <Square size={16} fill="currentColor" />
          停止
        </button>
      ) : (
        <button
          onClick={handleSend}
          className="flex h-10 items-center gap-1.5 rounded-xl bg-[var(--color-accent)] px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[var(--color-accent-strong)] disabled:opacity-50"
        >
          <ArrowUp size={16} />
          发送
        </button>
        )}
      </div>
    </div>
  );
}
