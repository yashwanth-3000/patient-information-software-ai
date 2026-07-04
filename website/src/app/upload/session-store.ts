export type SessionRecord = {
  id: string;
  createdAt: string;
  photoCount: number;
  status: string;
};

const STORAGE_KEY = "clinicclick-upload-sessions";

export function readSessions(): SessionRecord[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as SessionRecord[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writeSessions(sessions: SessionRecord[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions.slice(0, 30)));
}

export function touchSession(id: string, patch: Partial<SessionRecord>) {
  const sessions = readSessions();
  const index = sessions.findIndex((session) => session.id === id);
  if (index >= 0) {
    sessions[index] = { ...sessions[index], ...patch };
  } else {
    sessions.unshift({
      id,
      createdAt: new Date().toISOString(),
      photoCount: 0,
      status: "new",
      ...patch,
    });
  }
  writeSessions(sessions);
}

export function newSessionId(existing: Set<string>): string {
  // 6-digit numeric code: easy to read aloud and type back later.
  for (let attempt = 0; attempt < 50; attempt++) {
    const id = String(Math.floor(100000 + Math.random() * 900000));
    if (!existing.has(id)) return id;
  }
  return String(Date.now()).slice(-6);
}
