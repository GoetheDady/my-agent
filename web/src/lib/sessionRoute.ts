const SESSION_PREFIX = "/sessions/";

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
