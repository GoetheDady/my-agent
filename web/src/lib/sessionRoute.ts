const SESSION_PREFIX = "/sessions/";
export const ARCHITECTURE_PATH = "/architecture";
export const MEMORY_PATH = "/memory";
export const PROFILES_PATH = "/profiles";
export const AGENTS_PATH = "/agents";
export const CHANNELS_PATH = "/channels";
export const TOOLS_PATH = "/tools";
export const TASKS_PATH = "/tasks";
export const EVENTS_PATH = "/events";
export const SETTINGS_PATH = "/settings";

export function getSessionPath(sessionId: string): string {
  return `${SESSION_PREFIX}${encodeURIComponent(sessionId)}`;
}

export function getSessionIdFromPath(pathname: string): string | null {
  if (!pathname.startsWith(SESSION_PREFIX)) return null;

  const rawId = pathname.slice(SESSION_PREFIX.length).split("/")[0];
  if (!rawId) return null;

  try {
    return decodeURIComponent(rawId);
  } catch {
    return null;
  }
}
