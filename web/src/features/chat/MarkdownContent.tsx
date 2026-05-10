import ReactMarkdown from "react-markdown";
import type { ReactNode, ReactElement } from "react";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { useState, useRef, useCallback } from "react";
import { Check, Copy } from "lucide-react";

export default function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="max-w-none text-[15px] leading-7 text-[var(--color-text)] [&_a]:text-[var(--color-accent)] [&_blockquote]:border-l-2 [&_blockquote]:border-[var(--color-border)] [&_blockquote]:pl-3 [&_code]:rounded [&_code]:bg-[var(--color-code)] [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[13px] [&_h1]:mb-3 [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:text-lg [&_h2]:font-semibold [&_li]:my-1 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:border [&_pre]:border-[var(--color-border-soft)] [&_pre]:bg-[var(--color-code)] [&_pre]:p-4 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-5">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{ pre: PreBlock }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function extractText(node: ReactNode): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  const el = node as ReactElement<{ children?: ReactNode }>;
  if (el?.props?.children) return extractText(el.props.children);
  return "";
}

function PreBlock({ children }: { children?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const handleCopy = useCallback(() => {
    const text = extractText(children);
    navigator.clipboard.writeText(text).then(
      () => {
        setCopied(true);
        timerRef.current = setTimeout(() => setCopied(false), 2000);
      },
      () => {},
    );
  }, [children]);

  return (
    <div className="relative">
      <button
        onClick={handleCopy}
        className="absolute right-2 top-2 flex items-center gap-1 rounded-md border border-[var(--color-border)] bg-white px-2 py-1 text-xs font-medium text-[var(--color-text-muted)] shadow-sm hover:bg-[var(--color-surface-subtle)]"
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
        {copied ? "已复制" : "复制"}
      </button>
      <pre>{children}</pre>
    </div>
  );
}
