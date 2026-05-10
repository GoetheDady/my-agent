import { BrowserRouter, Route, Routes } from "react-router";
import ChatView from "./components/ChatView";
import { ARCHITECTURE_PATH } from "./lib/sessionRoute";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route index element={<ChatView view="chat" />} />
        <Route path="sessions/:sessionId" element={<ChatView view="chat" />} />
        <Route path={ARCHITECTURE_PATH.slice(1)} element={<ChatView view="architecture" />} />
        <Route path="*" element={<ChatView view="chat" />} />
      </Routes>
    </BrowserRouter>
  );
}
