"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { newSessionId, readSessions, writeSessions, type SessionRecord } from "./session-store";

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function UploadHome() {
  const router = useRouter();
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState("");

  useEffect(() => {
    // Read after mount: localStorage only exists in the browser.
    const frame = requestAnimationFrame(() => setSessions(readSessions()));
    return () => cancelAnimationFrame(frame);
  }, []);

  const startSession = () => {
    const id = newSessionId(new Set(sessions.map((session) => session.id)));
    const record: SessionRecord = {
      id,
      createdAt: new Date().toISOString(),
      photoCount: 0,
      status: "new",
    };
    writeSessions([record, ...sessions]);
    router.push(`/upload/${id}`);
  };

  const openByCode = () => {
    const cleaned = code.replace(/\D/g, "");
    if (cleaned.length < 5) {
      setCodeError("Enter the 5-6 digit session code.");
      return;
    }
    router.push(`/upload/${cleaned}`);
  };

  return (
    <main className="desktop">
      <nav className="nav shell" aria-label="Main navigation">
        <Link className="brand" href="/">
          <span className="brand-icon" aria-hidden="true">P</span>
          <span>patient-information-software-ai</span>
        </Link>
        <div className="nav-links">
          <Link href="/upload">Upload</Link>
          <Link href="/#how-it-works">Workflow</Link>
          <Link href="/#safety">Safety</Link>
        </div>
      </nav>

      <div className="page-window shell">
        <div className="window-titlebar">
          <span className="window-app-icon">P</span>
          <span>Script Upload Sessions</span>
          <div className="window-controls">
            <i aria-hidden="true">_</i>
            <i aria-hidden="true">□</i>
            <button aria-label="Close and go back" className="close" onClick={() => router.push("/")} type="button">×</button>
          </div>
        </div>

        <div className="page-workspace">
          <div className="session-hero">
            <span className="system-label">SCRIPT CAPTURE</span>
            <h1>Photograph scripts. Agents do the typing.</h1>
            <p>
              Start a session, photograph each handwritten script, and save. The
              processing crew reads every script, verifies the patient against the
              clinic system, and prepares entries for review.
            </p>
            <button className="retro-button primary-button big-launch" onClick={startSession} type="button">
              Start new upload session
            </button>

            <div className="session-open-row">
              <input
                aria-label="Session code"
                inputMode="numeric"
                maxLength={6}
                onChange={(event) => { setCode(event.target.value); setCodeError(""); }}
                onKeyDown={(event) => { if (event.key === "Enter") openByCode(); }}
                placeholder="000000"
                value={code}
              />
              <button className="retro-button" onClick={openByCode} type="button">Open session</button>
            </div>
            {codeError ? <p style={{ color: "#a33", fontSize: 12, marginTop: 8 }}>{codeError}</p> : null}
          </div>

          {sessions.length > 0 ? (
            <div className="session-list">
              <h2 className="system-label">RECENT SESSIONS</h2>
              {sessions.slice(0, 8).map((session) => (
                <button className="session-item" key={session.id} onClick={() => router.push(`/upload/${session.id}`)} type="button">
                  <code>#{session.id}</code>
                  <small>{formatWhen(session.createdAt)}</small>
                  <small>{session.photoCount} photo{session.photoCount === 1 ? "" : "s"}</small>
                  <span className="session-badge">{session.status.toUpperCase()}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="window-statusbar">
          <span><i className="status-light" /> Agents on standby</span>
          <span>Session codes are reusable</span>
          <span>Every entry needs human approval</span>
        </div>
      </div>
    </main>
  );
}
