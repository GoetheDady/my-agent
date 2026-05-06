import { useState } from "react";
import MessageList from "./MessageList";
import ChatInput from "./ChatInput";
import SessionSidebar from "./SessionSidebar";

export default function ChatView() {
  const [sidebarOpen, setSidebarOpen] = useState(true);

  return (
    <div className="flex h-screen bg-[var(--color-bg)]">
      {sidebarOpen && <SessionSidebar />}

      <div className="flex flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-white/10 bg-[var(--color-surface)] px-6 py-3">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="text-white/60 hover:text-white"
            title={sidebarOpen ? "收起侧栏" : "展开侧栏"}
          >
            {sidebarOpen ? "◁" : "▷"}
          </button>
          <h1 className="text-lg font-semibold text-[var(--color-text)]">
            My Agent
          </h1>
        </header>
        <MessageList />
        <ChatInput />
      </div>
    </div>
  );
}
