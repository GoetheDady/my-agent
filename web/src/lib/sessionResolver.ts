interface SessionResolverOptions {
  getSessionId: () => string | null;
  setSessionId: (id: string) => void;
  setActiveSessionId: (id: string) => void;
  fetchSessions: () => Promise<void>;
  createSession: () => Promise<{ id: string }>;
  onSessionCreated?: (id: string) => void;
}

export function createSessionResolver(options: SessionResolverOptions) {
  let pendingSession: Promise<string> | null = null;

  async function ensureSessionId(): Promise<string> {
    const existingSessionId = options.getSessionId();
    if (existingSessionId) return existingSessionId;

    if (!pendingSession) {
      pendingSession = options.createSession().then((session) => {
        options.setSessionId(session.id);
        options.setActiveSessionId(session.id);
        options.onSessionCreated?.(session.id);
        void options.fetchSessions();
        return session.id;
      }).finally(() => {
        pendingSession = null;
      });
    }

    return pendingSession;
  }

  return { ensureSessionId };
}
