"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type ReviewMedicine = { text: string; confidence: number };

type ReviewEntry = {
  photoName: string;
  photoUrl: string;
  index: number;
  regno: string;
  patientName: string;
  age: string;
  gender: string;
  outcome: "ready" | "review";
  reviewReasons: string[];
  /* One prescription per script, PIS style: medicines separated by "//",
     days and amount at the end, full remedy names. */
  prescription: string;
  prescriptionConfidence: number;
  medicines: ReviewMedicine[];
};

/** Fallback shown when the review page is opened without a processed batch. */
const FALLBACK_ENTRIES: ReviewEntry[] = [
  {
    photoName: "sample-script-1.jpg",
    photoUrl: "/demo-scripts/script-0207.jpg",
    index: 0,
    regno: "258",
    patientName: "NAGENDER D. CONDUCTER",
    age: "46",
    gender: "M",
    outcome: "ready",
    reviewReasons: [],
    prescription: "40 size Arsenicum Album 30 tid // Sac Lac // Sac Lac // 15 days 300",
    prescriptionConfidence: 0.96,
    medicines: [
      { text: "Arsenicum Album 30", confidence: 0.96 },
      { text: "Sac Lac", confidence: 0.99 },
      { text: "Sac Lac", confidence: 0.99 },
    ],
  },
  {
    photoName: "sample-script-2.jpg",
    photoUrl: "/demo-scripts/script-0209.jpg",
    index: 1,
    regno: "315",
    patientName: "VIJAYA ALAGANDULA",
    age: "38",
    gender: "F",
    outcome: "review",
    reviewReasons: ["\"Murostin 28\" is not in the remedy corpus.", "Amount not written on the script."],
    prescription: "40 size Silicea 30 // Murostin 28 (unrecognized) // Natrum Sulphuricum 6 // 15 days",
    prescriptionConfidence: 0.31,
    medicines: [
      { text: "Silicea 30", confidence: 0.93 },
      { text: "Murostin 28 (unrecognized)", confidence: 0.31 },
      { text: "Natrum Sulphuricum 6", confidence: 0.88 },
    ],
  },
];

type EditableEntry = ReviewEntry & { approved: boolean };

export default function ReviewSession({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [entries, setEntries] = useState<EditableEntry[] | null>(null);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    // setTimeout instead of requestAnimationFrame: rAF never fires in a
    // hidden/background tab, which left this page stuck on "Loading batch".
    const frame = setTimeout(() => {
      let loaded: ReviewEntry[] = FALLBACK_ENTRIES;
      try {
        const raw = window.sessionStorage.getItem(`clinicclick-review-${id}`);
        if (raw) {
          const parsed = JSON.parse(raw) as ReviewEntry[];
          if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0]?.prescription === "string") {
            loaded = parsed;
          }
        }
      } catch { /* fall back to demo entries */ }
      setEntries(loaded.map((entry) => ({
        ...entry,
        photoUrl: entry.photoUrl || "/demo-scripts/script-0207.jpg",
        approved: entry.outcome === "ready",
      })));
    });
    return () => clearTimeout(frame);
  }, [id]);

  const updateEntry = (index: number, patch: Partial<EditableEntry>) => {
    setEntries((current) => current
      ? current.map((entry, i) => (i === index ? { ...entry, ...patch } : entry))
      : current);
  };


  const approvedCount = entries?.filter((entry) => entry.approved).length ?? 0;
  const approvedEntryLabel = approvedCount === 1 ? "entry" : "entries";

  return (
    <main className="desktop aero-desktop">
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
          <span>Review &amp; Finalize · Session #{id}</span>
          <div className="window-controls">
            <i aria-hidden="true">_</i>
            <i aria-hidden="true">□</i>
            <button aria-label="Close and go back" className="close" onClick={() => router.push(`/upload/${id}`)} type="button">×</button>
          </div>
        </div>

        <div className="page-workspace">
          <div className="session-toolbar">
            <span className="crumbs">
              <Link href="/upload">Sessions</Link> &rsaquo; <Link href={`/upload/${id}`}>#{id}</Link> &rsaquo; <code>Review</code>
            </span>
            <span className="session-badge">
              {submitted ? "SUBMITTED" : entries ? `${approvedCount}/${entries.length} APPROVED` : "LOADING"}
            </span>
          </div>

          {submitted ? (
            <div className="sub-window">
              <div className="review-success">
                <span className="zone-icon" aria-hidden="true">✓</span>
                <h2>{approvedCount} {approvedEntryLabel} queued for the clinic</h2>
                <p>
                  The approved entries are on their way to the Patient Information System.
                  The next time the clinic clicks <b>Get New Data from App</b>, these
                  prescriptions import into the patient records automatically.
                </p>
                <div style={{ display: "flex", gap: 10 }}>
                  <Link className="retro-button primary-button" href="/upload">Start another batch</Link>
                  <Link className="retro-button" href={`/upload/${id}`}>Back to session</Link>
                </div>
              </div>
            </div>
          ) : !entries ? (
            <div className="sub-window"><p className="feed-idle">Loading batch...</p></div>
          ) : (
            <>
              <div className="review-banner">
                <div>
                  <b>Check each entry before it reaches the clinic.</b>
                  <br />
                  <small>
                    Fields are editable. Entries flagged by the crew need your correction
                    or explicit approval; nothing is written to PIS without a tick.
                  </small>
                </div>
                <span className="spacer" />
                <span className="stage-chip" data-tone={approvedCount === entries.length ? "ok" : "warn"}>
                  <i />{approvedCount}/{entries.length} APPROVED
                </span>
              </div>

              {entries.map((entry, entryIndex) => (
                <section className="sub-window entry-card" key={entry.index}>
                  <div className="sub-title">
                    <span>{entry.photoName}</span>
                    <small>
                      {entry.outcome === "ready"
                        ? <span className="stage-chip" data-tone="ok"><i />AGENTS: READY</span>
                        : <span className="stage-chip" data-tone="warn"><i />AGENTS: NEEDS REVIEW</span>}
                    </small>
                  </div>

                  <div className="entry-grid">
                    <figure className="entry-photo">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img alt={entry.photoName} src={entry.photoUrl} />
                      <figcaption>Original script photo</figcaption>
                    </figure>

                    <div className="entry-fields">
                      <div className="field-row">
                        <label htmlFor={`regno-${entryIndex}`}>RegNo</label>
                        <input
                          id={`regno-${entryIndex}`}
                          onChange={(event) => updateEntry(entryIndex, { regno: event.target.value })}
                          value={entry.regno}
                        />
                      </div>
                      <div className="field-row">
                        <label htmlFor={`name-${entryIndex}`}>Patient name</label>
                        <input id={`name-${entryIndex}`} readOnly value={entry.patientName} />
                      </div>
                      <div className="field-row" style={{ alignItems: "start" }}>
                        <label htmlFor={`rx-${entryIndex}`} style={{ paddingTop: 8 }}>Prescription</label>
                        <div className="rx-list">
                          <div className="rx-row" data-flagged={entry.prescriptionConfidence < 0.6}>
                            <textarea
                              id={`rx-${entryIndex}`}
                              onChange={(event) => updateEntry(entryIndex, { prescription: event.target.value })}
                              rows={2}
                              value={entry.prescription}
                            />
                            <span className="rx-conf">
                              {entry.prescriptionConfidence < 0.6 ? "⚠ " : ""}confidence {(entry.prescriptionConfidence * 100).toFixed(0)}%
                            </span>
                          </div>
                          <small className="rx-hint">
                            One entry per script: medicines separated by &quot;//&quot;, days and amount at the end.
                          </small>
                          <ul className="rx-medicines">
                            {entry.medicines.map((medicine) => (
                              <li data-flagged={medicine.confidence < 0.6} key={medicine.text}>
                                <span>{medicine.text}</span>
                                <small>{(medicine.confidence * 100).toFixed(0)}%</small>
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="entry-foot">
                    <label className="approve-check">
                      <input
                        checked={entry.approved}
                        onChange={(event) => updateEntry(entryIndex, { approved: event.target.checked })}
                        type="checkbox"
                      />
                      Approve this entry for PIS import
                    </label>
                    <span className="spacer" />
                    {entry.reviewReasons.length > 0 ? (
                      <span className="review-note">⚠ {entry.reviewReasons.join(" ")}</span>
                    ) : null}
                  </div>
                </section>
              ))}

              <div className="review-submit-bar">
                <b style={{ fontSize: 12.5, color: "#123b5c" }}>
                  {approvedCount} of {entries.length} entries approved
                </b>
                <span className="spacer" />
                <Link className="retro-button" href={`/upload/${id}`}>Back to agents</Link>
                <button
                  className="retro-button primary-button run-button"
                  disabled={approvedCount === 0}
                  onClick={() => setSubmitted(true)}
                  type="button"
                >
                  Send {approvedCount} {approvedEntryLabel} to clinic queue
                </button>
              </div>
            </>
          )}
        </div>

        <div className="window-statusbar">
          <span><i className="status-light" /> Human approval required</span>
          <span>Session #{id}</span>
          <span>Demo data: live pipeline connects next</span>
        </div>
      </div>
    </main>
  );
}
