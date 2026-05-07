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
    <div className="flex items-end gap-3 border-t border-white/10 bg-surface p-4">
      <button
        onClick={onToggleThinking}
        className={`mb-0.5 rounded-lg p-2.5 transition-colors ${
          thinkingEnabled
            ? "bg-amber-500/20 text-amber-400 hover:bg-amber-500/30"
            : "text-white/30 hover:bg-white/5 hover:text-white/50"
        }`}
        title={thinkingEnabled ? "关闭深度思考" : "开启深度思考"}
      >
        <Lightbulb size={18} />
      </button>
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
          onClick={onStop}
          className="flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-3 text-white hover:bg-red-700 disabled:opacity-50"
        >
          <Square size={16} fill="currentColor" />
          停止
        </button>
      ) : (
        <button
          onClick={handleSend}
          className="flex items-center gap-1.5 rounded-lg bg-accent px-4 py-3 text-white hover:brightness-110 disabled:opacity-50"
        >
          <ArrowUp size={16} />
          发送
        </button>
      )}
    </div>
  );
}
