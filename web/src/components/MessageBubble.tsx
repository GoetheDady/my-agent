import type { Message, DisplayBlock } from "../types";
import MarkdownContent from "./MarkdownContent";

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

  return (
    <div className="flex justify-start">
      <div className="max-w-[80%] space-y-2">
        {message.blocks.map((block, i) => (
          <BlockRenderer key={i} block={block} />
        ))}
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
  return (
    <details className="rounded-lg bg-thinking px-3 py-2">
      <summary className="cursor-pointer text-xs italic text-white/40">
        思考过程...
      </summary>
      <p className="mt-2 whitespace-pre-wrap text-xs italic text-white/50">
        {block.content}
      </p>
    </details>
  );
}
