import { BrowserRouter, Route, Routes } from "react-router";
import AppShell from "./layouts/AppShell";
import AgentsPage from "./pages/AgentsPage";
import ArchitecturePage from "./pages/ArchitecturePage";
import ChannelsPage from "./pages/ChannelsPage";
import ChatPage from "./pages/ChatPage";
import EventsPage from "./pages/EventsPage";
import MemoryPage from "./pages/MemoryPage";
import ProfilesPage from "./pages/ProfilesPage";
import SettingsPage from "./pages/SettingsPage";
import SkillsPage from "./pages/SkillsPage";
import TasksPage from "./pages/TasksPage";
import ToolsPage from "./pages/ToolsPage";
import {
  AGENTS_PATH,
  ARCHITECTURE_PATH,
  CHANNELS_PATH,
  EVENTS_PATH,
  MEMORY_PATH,
  PROFILES_PATH,
  SETTINGS_PATH,
  SKILLS_PATH,
  TASKS_PATH,
  TOOLS_PATH,
} from "./lib/sessionRoute";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<ChatPage />} />
          <Route path="sessions/:sessionId" element={<ChatPage />} />
          <Route path={ARCHITECTURE_PATH.slice(1)} element={<ArchitecturePage />} />
          <Route path={MEMORY_PATH.slice(1)} element={<MemoryPage />} />
          <Route path={PROFILES_PATH.slice(1)} element={<ProfilesPage />} />
          <Route path={AGENTS_PATH.slice(1)} element={<AgentsPage />} />
          <Route path={CHANNELS_PATH.slice(1)} element={<ChannelsPage />} />
          <Route path={TOOLS_PATH.slice(1)} element={<ToolsPage />} />
          <Route path={SKILLS_PATH.slice(1)} element={<SkillsPage />} />
          <Route path={TASKS_PATH.slice(1)} element={<TasksPage />} />
          <Route path={EVENTS_PATH.slice(1)} element={<EventsPage />} />
          <Route path={SETTINGS_PATH.slice(1)} element={<SettingsPage />} />
          <Route path="*" element={<ChatPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
