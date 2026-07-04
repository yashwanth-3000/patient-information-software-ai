"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type ReviewMedicine = { text: string; confidence: number };

type ReviewEntry = {
  photoName: string;
  photoUrl: string;
  index: number;
  /** Backend job id; present when the batch ran through the live crew. */
  jobId?: string | null;
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

type Decision = "approved" | "skipped";

type EditableEntry = ReviewEntry;

const SWIPE_THRESHOLD = 90;

export default function ReviewSession({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [entries, setEntries] = useState<EditableEntry[] | null>(null);
  const [decisions, setDecisions] = useState<Record<number, Decision>>({});
  const [deckIndex, setDeckIndex] = useState(0);
  const [editing, setEditing] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [drag, setDrag] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [flyOut, setFlyOut] = useState<Decision | null>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const flyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      })));
    });
    return () => clearTimeout(frame);
  }, [id]);

  useEffect(() => () => { if (flyTimer.current) clearTimeout(flyTimer.current); }, []);

  const updateEntry = (index: number, patch: Partial<EditableEntry>) => {
    setEntries((current) => current
      ? current.map((entry, i) => (i === index ? { ...entry, ...patch } : entry))
      : current);
  };

  const decide = useCallback((decision: Decision) => {
    if (!entries || deckIndex >= entries.length || flyOut) return;
    setEditing(false);
    setFlyOut(decision);
    flyTimer.current = setTimeout(() => {
      setDecisions((current) => ({ ...current, [deckIndex]: decision }));
      setDeckIndex((current) => current + 1);
      setFlyOut(null);
      setDrag({ x: 0, y: 0 });
    }, 320);
  }, [entries, deckIndex, flyOut]);

  const undo = () => {
    if (deckIndex === 0 || flyOut) return;
    setEditing(false);
    const prev = deckIndex - 1;
    setDecisions((current) => {
      const next = { ...current };
      delete next[prev];
      return next;
    });
    setDeckIndex(prev);
    setDrag({ x: 0, y: 0 });
  };

  /* Pointer-based swipe */
  const onPointerDown = (event: React.PointerEvent) => {
    if (editing || flyOut) return;
    const target = event.target as HTMLElement;
    if (target.closest("button, input, textarea, a")) return;
    dragStart.current = { x: event.clientX, y: event.clientY };
    setDragging(true);
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: React.PointerEvent) => {
    if (!dragStart.current) return;
    setDrag({ x: event.clientX - dragStart.current.x, y: event.clientY - dragStart.current.y });
  };
  const onPointerUp = () => {
    if (!dragStart.current) return;
    dragStart.current = null;
    setDragging(false);
    if (drag.x > SWIPE_THRESHOLD) decide("approved");
    else if (drag.x < -SWIPE_THRESHOLD) decide("skipped");
    else setDrag({ x: 0, y: 0 });
  };

  const total = entries?.length ?? 0;
  const finished = entries !== null && deckIndex >= total;
  const approvedCount = Object.values(decisions).filter((d) => d === "approved").length;
  const skippedCount = Object.values(decisions).filter((d) => d === "skipped").length;
  const approvedEntryLabel = approvedCount === 1 ? "entry" : "entries";

  const dragRotation = Math.max(-14, Math.min(14, drag.x / 14));
  const dragOpacity = Math.min(1, Math.abs(drag.x) / SWIPE_THRESHOLD);
  const dragDirection = drag.x > 24 ? "approved" : drag.x < -24 ? "skipped" : null;

  const cardStyle = (offset: number): React.CSSProperties => {
    if (offset === 0) {
      if (flyOut) {
        return {
          transform: `translate(${flyOut === "approved" ? 620 : -620}px, ${drag.y + 40}px) rotate(${flyOut === "approved" ? 24 : -24}deg)`,
          opacity: 0,
          transition: "transform .32s cubic-bezier(.5,.4,.6,1), opacity .3s ease",
        };
      }
      return {
        transform: `translate(${drag.x}px, ${drag.y * 0.4}px) rotate(${dragRotation}deg)`,
        transition: dragging ? "none" : "transform .28s cubic-bezier(.2,.9,.3,1.15)",
      };
    }
    const scale = 1 - offset * 0.045;
    const y = offset * 13;
    return { transform: `translateY(${y}px) scale(${scale})`, transition: "transform .3s ease" };
  };

  /** Queue every approved entry on the clinic PIS through the agent backend. */
  const submitApproved = async () => {
    if (!entries || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    const approved = entries
      .map((entry, index) => ({ entry, index }))
      .filter(({ index }) => decisions[index] === "approved");
    try {
      for (const { entry } of approved) {
        if (!entry.jobId) continue; // demo fallback entries have no live job
        const response = await fetch(`/api/agent/jobs/${entry.jobId}/submit`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            form: {
              regno: entry.regno,
              patient_name: entry.patientName,
              prescriptions: [{ text: entry.prescription }],
              amount: null,
            },
          }),
        });
        if (!response.ok) {
          throw new Error(`Queueing ${entry.patientName || "entry"} failed (${response.status})`);
        }
      }
      setSubmitted(true);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Submitting failed. Try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const toggleDecision = (index: number) => {
    setDecisions((current) => ({
      ...current,
      [index]: current[index] === "approved" ? "skipped" : "approved",
    }));
  };

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
              {submitted ? "SUBMITTED" : entries ? (finished ? `${approvedCount}/${total} APPROVED` : `CARD ${deckIndex + 1}/${total}`) : "LOADING"}
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
          ) : !finished ? (
            <>
              <div className="deck-help">
                <span className="deck-help-item" data-kind="skip"><i>←</i> swipe left to skip</span>
                <span className="deck-help-item" data-kind="edit">tap card to edit</span>
                <span className="deck-help-item" data-kind="approve">swipe right to approve <i>→</i></span>
              </div>

              <div className="deck-stage">
                {entries.slice(deckIndex, deckIndex + 3).map((entry, offset) => {
                  const entryIndex = deckIndex + offset;
                  const isTop = offset === 0;
                  return (
                    <article
                      className={`deck-card${isTop ? " top" : ""}`}
                      data-outcome={entry.outcome}
                      key={`${entry.index}-${entry.photoName}`}
                      onPointerCancel={isTop ? onPointerUp : undefined}
                      onPointerDown={isTop ? onPointerDown : undefined}
                      onPointerMove={isTop ? onPointerMove : undefined}
                      onPointerUp={isTop ? onPointerUp : undefined}
                      style={{ ...cardStyle(offset), zIndex: 10 - offset }}
                    >
                      {isTop ? (
                        <>
                          <span className="deck-stamp approve" style={{ opacity: dragDirection === "approved" ? dragOpacity : flyOut === "approved" ? 1 : 0 }}>APPROVE</span>
                          <span className="deck-stamp skip" style={{ opacity: dragDirection === "skipped" ? dragOpacity : flyOut === "skipped" ? 1 : 0 }}>SKIP</span>
                        </>
                      ) : null}

                      <div className="deck-card-head">
                        <span className="deck-card-no">#{entryIndex + 1}</span>
                        <b>{entry.patientName || "Unknown patient"}</b>
                        {entry.outcome === "ready"
                          ? <span className="stage-chip" data-tone="ok"><i />READY</span>
                          : <span className="stage-chip" data-tone="warn"><i />CHECK</span>}
                      </div>

                      <figure className="deck-photo">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img alt={entry.photoName} src={entry.photoUrl} draggable={false} />
                      </figure>
                      <div className="deck-facts">
                        <span><small>REGNO</small><b>{entry.regno || "?"}</b></span>
                        <span><small>AGE / SEX</small><b>{entry.age || "?"} / {entry.gender || "?"}</b></span>
                        <span><small>CONFIDENCE</small><b>{(entry.prescriptionConfidence * 100).toFixed(0)}%</b></span>
                      </div>
                      <p className="deck-rx">{entry.prescription}</p>
                      {entry.reviewReasons.length > 0 ? (
                        <p className="deck-flag">⚠ {entry.reviewReasons.join(" ")}</p>
                      ) : null}
                      {isTop ? (
                        <button className="deck-edit-hint" onClick={() => setEditing(true)} type="button">
                          ✎ Tap to edit this entry
                        </button>
                      ) : null}
                    </article>
                  );
                })}
              </div>

              <div className="deck-actions">
                <button aria-label="Skip this entry" className="deck-button skip" disabled={!!flyOut} onClick={() => decide("skipped")} type="button">✕</button>
                <button aria-label="Undo last decision" className="deck-button undo" disabled={deckIndex === 0 || !!flyOut} onClick={undo} type="button">↺</button>
                <button aria-label="Edit this entry" className="deck-button edit" disabled={!!flyOut} onClick={() => setEditing((open) => !open)} type="button">✎</button>
                <button aria-label="Approve this entry" className="deck-button approve" disabled={!!flyOut} onClick={() => decide("approved")} type="button">✓</button>
              </div>

              <div className="deck-progress">
                {entries.map((entry, index) => (
                  <i
                    data-state={index < deckIndex ? decisions[index] : index === deckIndex ? "current" : "waiting"}
                    key={`${entry.index}-dot`}
                  />
                ))}
              </div>

              {editing && entries[deckIndex] ? (
                <div className="deck-modal-backdrop" onClick={() => setEditing(false)}>
                  <div
                    aria-label={`Edit entry ${deckIndex + 1}`}
                    className="deck-modal"
                    onClick={(event) => event.stopPropagation()}
                    role="dialog"
                  >
                    <div className="window-titlebar deck-modal-title">
                      <span className="window-app-icon">✎</span>
                      <span>Edit Entry #{deckIndex + 1} · {entries[deckIndex].patientName || "Unknown patient"}</span>
                      <div className="window-controls">
                        <button aria-label="Close editor" className="close" onClick={() => setEditing(false)} type="button">×</button>
                      </div>
                    </div>

                    <div className="deck-modal-body">
                      <figure className="deck-edit-photo">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img alt={entries[deckIndex].photoName} src={entries[deckIndex].photoUrl} draggable={false} />
                        <figcaption>original script</figcaption>
                      </figure>

                      <div className="deck-edit-grid">
                        <div className="deck-edit-field">
                          <label htmlFor={`regno-${deckIndex}`}>REGNO</label>
                          <input
                            id={`regno-${deckIndex}`}
                            inputMode="numeric"
                            onChange={(event) => updateEntry(deckIndex, { regno: event.target.value })}
                            value={entries[deckIndex].regno}
                          />
                        </div>
                        <div className="deck-edit-field">
                          <label>PATIENT</label>
                          <input readOnly value={`${entries[deckIndex].patientName || "?"} · ${entries[deckIndex].age || "?"}/${entries[deckIndex].gender || "?"}`} />
                        </div>
                      </div>

                      <div className="deck-edit-field">
                        <label htmlFor={`rx-${deckIndex}`}>PRESCRIPTION</label>
                        <textarea
                          id={`rx-${deckIndex}`}
                          onChange={(event) => updateEntry(deckIndex, { prescription: event.target.value })}
                          rows={4}
                          value={entries[deckIndex].prescription}
                        />
                        <small>Medicines separated by &quot;//&quot;, days and amount at the end. Full remedy names, no short forms.</small>
                      </div>

                      {entries[deckIndex].reviewReasons.length > 0 ? (
                        <p className="deck-flag">⚠ {entries[deckIndex].reviewReasons.join(" ")}</p>
                      ) : null}
                    </div>

                    <div className="deck-modal-foot">
                      <button className="retro-button" onClick={() => setEditing(false)} type="button">Cancel</button>
                      <button className="retro-button primary-button deck-edit-done" onClick={() => setEditing(false)} type="button">
                        ✓ Save changes
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <>
              <div className="review-banner">
                <div>
                  <b>All {total} cards reviewed.</b>
                  <br />
                  <small>
                    {approvedCount} approved, {skippedCount} skipped. Tap an entry to flip
                    its decision, or undo to go back through the deck.
                  </small>
                </div>
                <span className="spacer" />
                <span className="stage-chip" data-tone={approvedCount > 0 ? "ok" : "warn"}>
                  <i />{approvedCount}/{total} APPROVED
                </span>
              </div>

              <div className="deck-summary">
                {entries.map((entry, index) => (
                  <button
                    className="deck-summary-row"
                    data-decision={decisions[index]}
                    key={`${entry.index}-summary`}
                    onClick={() => toggleDecision(index)}
                    type="button"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img alt={entry.photoName} src={entry.photoUrl} />
                    <span className="deck-summary-main">
                      <b>{entry.patientName || "Unknown patient"} ({entry.regno || "?"})</b>
                      <small>{entry.prescription}</small>
                    </span>
                    {decisions[index] === "approved"
                      ? <span className="stage-chip" data-tone="ok"><i />APPROVED</span>
                      : <span className="stage-chip" data-tone="wait"><i />SKIPPED</span>}
                  </button>
                ))}
              </div>

              <div className="review-submit-bar">
                <b style={{ fontSize: 12.5, color: "#123b5c" }}>
                  {approvedCount} of {total} entries approved
                </b>
                <span className="spacer" />
                <button className="retro-button" onClick={undo} type="button">↺ Back to deck</button>
                <button
                  className="retro-button primary-button run-button"
                  disabled={approvedCount === 0 || submitting}
                  onClick={submitApproved}
                  type="button"
                >
                  {submitting ? "Queueing..." : `Send ${approvedCount} ${approvedEntryLabel} to clinic queue`}
                </button>
              </div>
              {submitError ? (
                <p className="deck-flag" role="alert">⚠ {submitError}</p>
              ) : null}
            </>
          )}
        </div>

        <div className="window-statusbar">
          <span><i className="status-light" /> Human approval required</span>
          <span>Session #{id}</span>
          <span>Approved entries queue for the clinic PIS</span>
        </div>
      </div>
    </main>
  );
}
