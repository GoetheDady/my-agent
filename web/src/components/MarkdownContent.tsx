import ReactMarkdown from "react-markdown";
import type { ReactNode, ReactElement } from "react";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { useState, useRef, useCallback } from "react";

export default function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="prose prose-invert max-w-none text-sm [&_pre]:rounded-lg [&_pre]:bg-code [&_pre]:p-4 [&_code]:text-xs">
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
        className="absolute right-2 top-2 rounded bg-white/10 px-2 py-1 text-xs text-white/60 hover:bg-white/20"
      >
        {copied ? "已复制" : "复制"}
      </button>
      <pre>{children}</pre>
    </div>
  );
}
