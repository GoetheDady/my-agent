import { BrowserRouter, Route, Routes } from "react-router";
import ChatLayout from "./layouts/ChatLayout";
import ConsoleLayout from "./layouts/ConsoleLayout";
import AgentsPage from "./pages/AgentsPage";
import ChannelsPage from "./pages/ChannelsPage";
import ChatPage from "./pages/ChatPage";
import ConsoleDashboard from "./pages/ConsoleDashboard";
import EventsPage from "./pages/EventsPage";
import MemoryPage from "./pages/MemoryPage";
import SettingsPage from "./pages/SettingsPage";
import SkillsPage from "./pages/SkillsPage";
import TasksPage from "./pages/TasksPage";
import ToolsPage from "./pages/ToolsPage";
import WorkbenchPage from "./pages/WorkbenchPage";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<ChatLayout />}>
          <Route index element={<ChatPage />} />
          <Route path="sessions/:sessionId" element={<ChatPage />} />
        </Route>
        <Route path="console" element={<ConsoleLayout />}>
          <Route index element={<ConsoleDashboard />} />
          <Route path="agents" element={<AgentsPage />} />
          <Route path="tasks" element={<TasksPage />} />
          <Route path="tools" element={<ToolsPage />} />
          <Route path="skills" element={<SkillsPage />} />
          <Route path="memory" element={<MemoryPage />} />
          <Route path="events" element={<EventsPage />} />
          <Route path="channels" element={<ChannelsPage />} />
          <Route path="workbench" element={<WorkbenchPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
        <Route path="*" element={<ChatPage />} />
      </Routes>
    </BrowserRouter>
  );
}
