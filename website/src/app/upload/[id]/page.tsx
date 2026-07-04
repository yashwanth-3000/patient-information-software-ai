"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { touchSession } from "../session-store";

/* ------------------------------------------------------------------ */
/* Demo data: scripted agent runs so the UI can be reviewed before the  */
/* live backend is wired in.                                            */
/* ------------------------------------------------------------------ */

const AGENT_ORDER = ["ocr", "intake", "records", "pharmacist", "composer"] as const;

type AgentKey = (typeof AGENT_ORDER)[number];

const AGENT_LABELS: Record<AgentKey, string> = {
  ocr: "Script OCR Reader",
  intake: "Script Intake Agent",
  records: "Patient Records Agent",
  pharmacist: "Homeopathy Pharmacist",
  composer: "Entry Composer Agent",
};

const AGENT_BLURBS: Record<AgentKey, string> = {
  ocr: "Reads the handwriting on each photographed script.",
  intake: "Normalizes the reading into structured fields.",
  records: "Verifies the patient against the live clinic system.",
  pharmacist: "Grounds every medicine in the remedy corpus.",
  composer: "Prepares the final entry for human review.",
};

const SAMPLE_SCRIPTS = [
  { name: "sample-script-1.jpg", url: "/demo-scripts/script-0207.jpg" },
  { name: "sample-script-2.jpg", url: "/demo-scripts/script-0209.jpg" },
  { name: "sample-script-3.jpg", url: "/demo-scripts/script-0210.jpg" },
  { name: "sample-script-4.jpg", url: "/demo-scripts/script-0211.jpg" },
];

type DemoStep = {
  agent: AgentKey;
  status: "started" | "progress" | "completed" | "error";
  message: string;
  delay: number;
};

type DemoScenario = {
  patient: { regno: string; name: string; age: string; gender: string };
  prescriptions: { text: string; confidence: number }[];
  amount: string;
  outcome: "ready" | "review";
  reviewReasons: string[];
  steps: DemoStep[];
};

const DEMO_SCENARIOS: DemoScenario[] = [
  {
    patient: { regno: "258", name: "NAGENDER D. CONDUCTER", age: "46", gender: "M" },
    prescriptions: [
      { text: "Arsenicum Album 30C", confidence: 0.96 },
      { text: "Sac Lac (placebo)", confidence: 0.99 },
      { text: "Sac Lac (placebo)", confidence: 0.99 },
    ],
    amount: "-",
    outcome: "ready",
    reviewReasons: [],
    steps: [
      { agent: "ocr", status: "started", message: "Reading handwriting from the photographed script...", delay: 500 },
      { agent: "ocr", status: "completed", message: "Read patient ID 258, complaint \"skin rash\" and 3 medicine lines.", delay: 2300 },
      { agent: "intake", status: "started", message: "Normalizing the OCR reading into structured script fields.", delay: 700 },
      { agent: "intake", status: "completed", message: "Script normalized: 3 medicine lines, 1 patient ID candidate.", delay: 1900 },
      { agent: "records", status: "started", message: "Verifying identity against the live clinic PIS. Candidate: 258.", delay: 600 },
      { agent: "records", status: "progress", message: "Asking the legacy PIS for RegNo 258...", delay: 1400 },
      { agent: "records", status: "completed", message: "Identity verified: RegNo 258 (NAGENDER D. CONDUCTER).", delay: 1800 },
      { agent: "pharmacist", status: "started", message: "Grounding 3 medicine lines against the remedy corpus.", delay: 500 },
      { agent: "pharmacist", status: "progress", message: "\"Ars Alb 30\" matched to Arsenicum Album 30C (score 3.67).", delay: 1300 },
      { agent: "pharmacist", status: "completed", message: "3 medicines canonicalized, 0 flagged.", delay: 1200 },
      { agent: "composer", status: "started", message: "Composing the final entry with confidences and citations.", delay: 600 },
      { agent: "composer", status: "completed", message: "Entry ready for review: RegNo 258, 3 prescriptions.", delay: 1700 },
    ],
  },
  {
    patient: { regno: "315", name: "VIJAYA ALAGANDULA", age: "38", gender: "F" },
    prescriptions: [
      { text: "Silicea 30C - for 15 days", confidence: 0.93 },
      { text: "Murostin 28 (unrecognized)", confidence: 0.31 },
      { text: "Natrum Sulph 6C - for 15 days", confidence: 0.88 },
    ],
    amount: "-",
    outcome: "review",
    reviewReasons: ["\"Murostin 28\" is not in the remedy corpus.", "Amount not written on the script."],
    steps: [
      { agent: "ocr", status: "started", message: "Reading handwriting from the photographed script...", delay: 500 },
      { agent: "ocr", status: "completed", message: "Read patient ID 315 and 3 medicine lines. One line is hard to read.", delay: 2500 },
      { agent: "intake", status: "started", message: "Normalizing the OCR reading into structured script fields.", delay: 700 },
      { agent: "intake", status: "completed", message: "Duration \"for 15 days\" applied to each medicine line.", delay: 1800 },
      { agent: "records", status: "started", message: "Verifying identity against the live clinic PIS. Candidate: 315.", delay: 600 },
      { agent: "records", status: "progress", message: "Asking the legacy PIS for RegNo 315...", delay: 1500 },
      { agent: "records", status: "completed", message: "Identity verified: RegNo 315 (VIJAYA ALAGANDULA).", delay: 1700 },
      { agent: "pharmacist", status: "started", message: "Grounding 3 medicine lines against the remedy corpus.", delay: 500 },
      { agent: "pharmacist", status: "progress", message: "\"Silicea 30\" matched to Silicea 30C (score 5.29).", delay: 1200 },
      { agent: "pharmacist", status: "progress", message: "\"Murostin 28\" has no confident corpus match. Flagging for review.", delay: 1400 },
      { agent: "pharmacist", status: "completed", message: "2 medicines canonicalized, 1 flagged for human review.", delay: 1100 },
      { agent: "composer", status: "started", message: "Composing the final entry with confidences and citations.", delay: 600 },
      { agent: "composer", status: "completed", message: "Entry needs review: 1 unrecognized medicine on RegNo 315.", delay: 1600 },
    ],
  },
  {
    patient: { regno: "1002", name: "APPDEMOTWO PATIENT", age: "42", gender: "F" },
    prescriptions: [
      { text: "Nux Vomica 200C - BD x 3 days", confidence: 0.95 },
      { text: "Belladonna 30C - TDS", confidence: 0.91 },
    ],
    amount: "Rs 150",
    outcome: "ready",
    reviewReasons: [],
    steps: [
      { agent: "ocr", status: "started", message: "Reading handwriting from the photographed script...", delay: 500 },
      { agent: "ocr", status: "completed", message: "Read patient ID 1002, amount Rs 150 and 2 medicine lines.", delay: 2100 },
      { agent: "intake", status: "started", message: "Normalizing the OCR reading into structured script fields.", delay: 700 },
      { agent: "intake", status: "completed", message: "Script normalized: 2 medicine lines, dosage preserved as written.", delay: 1700 },
      { agent: "records", status: "started", message: "Verifying identity against the live clinic PIS. Candidate: 1002.", delay: 600 },
      { agent: "records", status: "progress", message: "Asking the legacy PIS for RegNo 1002...", delay: 1300 },
      { agent: "records", status: "completed", message: "Identity verified: RegNo 1002 (APPDEMOTWO PATIENT).", delay: 1700 },
      { agent: "pharmacist", status: "started", message: "Grounding 2 medicine lines against the remedy corpus.", delay: 500 },
      { agent: "pharmacist", status: "progress", message: "\"Nux Vom 200\" matched to Nux Vomica 200C (score 5.93).", delay: 1300 },
      { agent: "pharmacist", status: "completed", message: "2 medicines canonicalized, 0 flagged.", delay: 1100 },
      { agent: "composer", status: "started", message: "Composing the final entry with confidences and citations.", delay: 600 },
      { agent: "composer", status: "completed", message: "Entry ready for review: RegNo 1002, 2 prescriptions, Rs 150.", delay: 1500 },
    ],
  },
  {
    patient: { regno: "1001", name: "APPDEMOONE PATIENT", age: "31", gender: "M" },
    prescriptions: [
      { text: "Rhus Tox 200C - at bedtime", confidence: 0.94 },
      { text: "Bryonia 30C - TDS x 1 week", confidence: 0.9 },
    ],
    amount: "Rs 200",
    outcome: "ready",
    reviewReasons: [],
    steps: [
      { agent: "ocr", status: "started", message: "Reading handwriting from the photographed script...", delay: 500 },
      { agent: "ocr", status: "completed", message: "Read patient ID 1001, amount Rs 200 and 2 medicine lines.", delay: 2200 },
      { agent: "intake", status: "started", message: "Normalizing the OCR reading into structured script fields.", delay: 700 },
      { agent: "intake", status: "completed", message: "Script normalized: 2 medicine lines, 1 patient ID candidate.", delay: 1600 },
      { agent: "records", status: "started", message: "Verifying identity against the live clinic PIS. Candidate: 1001.", delay: 600 },
      { agent: "records", status: "progress", message: "Asking the legacy PIS for RegNo 1001...", delay: 1400 },
      { agent: "records", status: "completed", message: "Identity verified: RegNo 1001 (APPDEMOONE PATIENT).", delay: 1600 },
      { agent: "pharmacist", status: "started", message: "Grounding 2 medicine lines against the remedy corpus.", delay: 500 },
      { agent: "pharmacist", status: "progress", message: "\"Rhus Tox 200\" matched to Rhus Toxicodendron 200C (score 6.12).", delay: 1200 },
      { agent: "pharmacist", status: "completed", message: "2 medicines canonicalized, 0 flagged.", delay: 1100 },
      { agent: "composer", status: "started", message: "Composing the final entry with confidences and citations.", delay: 600 },
      { agent: "composer", status: "completed", message: "Entry ready for review: RegNo 1001, 2 prescriptions, Rs 200.", delay: 1500 },
    ],
  },
];

/* ------------------------------------------------------------------ */

type Photo = { id: string; name: string; url: string };

type ActivityEvent = {
  id: number;
  jobIndex: number;
  agent: AgentKey;
  status: DemoStep["status"];
  message: string;
  at: string;
};

type Job = {
  photo: Photo;
  scenario: DemoScenario;
  stage: string;
  stageTone: "wait" | "run" | "ok" | "warn";
  progress: number;
  done: boolean;
  logs: ActivityEvent[];
};

function nowStamp(): string {
  return new Date().toLocaleTimeString(undefined, { hour12: false });
}

/** Persist finished jobs so the /review/[id] page can pick them up. */
function saveReviewPayload(id: string, jobs: Job[]) {
  const entries = jobs.map((job, index) => ({
    photoName: job.photo.name,
    photoUrl: job.photo.url.startsWith("blob:") ? "" : job.photo.url,
    index,
    regno: job.scenario.patient.regno,
    patientName: job.scenario.patient.name,
    age: job.scenario.patient.age,
    gender: job.scenario.patient.gender,
    amount: job.scenario.amount === "-" ? "" : job.scenario.amount,
    outcome: job.scenario.outcome,
    reviewReasons: job.scenario.reviewReasons,
    prescriptions: job.scenario.prescriptions,
  }));
  try {
    window.sessionStorage.setItem(`clinicclick-review-${id}`, JSON.stringify(entries));
  } catch { /* storage full: review page falls back to demo data */ }
}

export default function UploadSession({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [feed, setFeed] = useState<ActivityEvent[]>([]);
  const [phase, setPhase] = useState<"capture" | "processing" | "done">("capture");
  const [expanded, setExpanded] = useState<number | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const eventCounter = useRef(0);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  useEffect(() => {
    touchSession(id, {});
  }, [id]);

  const addPhotos = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return;
    const additions: Photo[] = Array.from(files)
      .filter((file) => file.type.startsWith("image/"))
      .map((file, index) => ({
        id: `${Date.now()}-${index}-${file.name}`,
        name: file.name,
        url: URL.createObjectURL(file),
      }));
    setPhotos((current) => {
      const next = [...current, ...additions];
      touchSession(id, { photoCount: next.length });
      return next;
    });
  }, [id]);

  const addSamples = () => {
    setPhotos((current) => {
      const have = new Set(current.map((photo) => photo.name));
      const additions = SAMPLE_SCRIPTS
        .filter((sample) => !have.has(sample.name))
        .map((sample, index) => ({ id: `sample-${Date.now()}-${index}`, name: sample.name, url: sample.url }));
      const next = [...current, ...additions];
      touchSession(id, { photoCount: next.length });
      return next;
    });
  };

  const removePhoto = (photoId: string) => {
    setPhotos((current) => {
      const next = current.filter((photo) => photo.id !== photoId);
      touchSession(id, { photoCount: next.length });
      return next;
    });
  };

  const runAgents = () => {
    if (photos.length === 0 || phase !== "capture") return;
    setPhase("processing");
    setExpanded(null);
    touchSession(id, { status: "processing", photoCount: photos.length });

    const initialJobs: Job[] = photos.map((photo, index) => ({
      photo,
      scenario: DEMO_SCENARIOS[index % DEMO_SCENARIOS.length],
      stage: "Queued",
      stageTone: "wait",
      progress: 0,
      done: false,
      logs: [],
    }));
    setJobs(initialJobs);
    setFeed([]);

    let clock = 300;
    initialJobs.forEach((job, jobIndex) => {
      const totalSteps = job.scenario.steps.length;
      job.scenario.steps.forEach((step, stepIndex) => {
        clock += step.delay;
        const timer = setTimeout(() => {
          const event: ActivityEvent = {
            id: eventCounter.current++,
            jobIndex,
            agent: step.agent,
            status: step.status,
            message: step.message,
            at: nowStamp(),
          };
          setFeed((current) => [event, ...current].slice(0, 80));
          setJobs((current) => current.map((entry, index) => {
            if (index !== jobIndex) return entry;
            const isLast = stepIndex === totalSteps - 1;
            const stageLabel = isLast
              ? (entry.scenario.outcome === "ready" ? "Ready for entry" : "Needs review")
              : AGENT_LABELS[step.agent];
            return {
              ...entry,
              stage: stageLabel,
              stageTone: isLast ? (entry.scenario.outcome === "ready" ? "ok" : "warn") : "run",
              progress: Math.round(((stepIndex + 1) / totalSteps) * 100),
              done: isLast,
              logs: [...entry.logs, event],
            };
          }));
          if (jobIndex === initialJobs.length - 1 && stepIndex === totalSteps - 1) {
            setPhase("done");
            touchSession(id, { status: "processed" });
            saveReviewPayload(id, initialJobs);
          }
        }, clock);
        timers.current.push(timer);
      });
    });
  };

  const running = phase === "processing";
  const readyCount = jobs.filter((job) => job.done && job.scenario.outcome === "ready").length;
  const reviewCount = jobs.filter((job) => job.done && job.scenario.outcome === "review").length;
  const totalAgentSteps = Math.max(1, AGENT_ORDER.length * Math.max(1, photos.length));

  const agentEvents = (agent: AgentKey) => feed.filter((entry) => entry.agent === agent);
  const agentCompletedScripts = (agent: AgentKey) => {
    const completed = new Set(
      agentEvents(agent)
        .filter((entry) => entry.status === "completed")
        .map((entry) => entry.jobIndex),
    );
    return completed.size;
  };

  const agentState = (agent: AgentKey): "idle" | "active" | "done" => {
    const events = agentEvents(agent);
    if (events.length === 0) return "idle";
    if (agentCompletedScripts(agent) >= photos.length) return "done";
    return running ? "active" : "done";
  };

  const agentStatusLabel = (agent: AgentKey): string => {
    const completed = agentCompletedScripts(agent);
    const events = agentEvents(agent);
    if (events.length === 0) return "waiting";
    if (completed >= photos.length) return "completed";
    return running ? "processing" : "partial";
  };

  const agentLastMessage = (agent: AgentKey): string => {
    const event = feed.find((entry) => entry.agent === agent);
    return event ? event.message : AGENT_BLURBS[agent];
  };

  const agentEventCount = (agent: AgentKey): number => agentEvents(agent).length;
  const completedAgentSteps = AGENT_ORDER.reduce(
    (total, agent) => total + agentCompletedScripts(agent),
    0,
  );
  const batchProgress = Math.round((completedAgentSteps / totalAgentSteps) * 100);

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
          <span>Upload Session #{id}</span>
          <div className="window-controls" aria-hidden="true"><i>_</i><i>□</i><i className="close">×</i></div>
        </div>

        <div className="page-workspace">
          <div className="session-toolbar">
            <span className="crumbs">
              <Link href="/upload">Sessions</Link> &rsaquo; <code>#{id}</code>
            </span>
            <span className="session-badge">
              {running ? "AGENTS RUNNING" : jobs.length > 0 ? `${readyCount} READY / ${reviewCount} REVIEW` : "AWAITING PHOTOS"}
            </span>
          </div>

          {/* Step 1: capture (only before the one-time upload) */}
          {phase === "capture" ? (
            <section className="sub-window capture-window">
              <div className="sub-title">
                <span className="step-no">1</span>
                <span>Capture scripts</span>
                <small>{photos.length} photo{photos.length === 1 ? "" : "s"} in this batch</small>
              </div>
              <div className="sub-body">
                <input
                  accept="image/*"
                  hidden
                  multiple
                  onChange={(event) => { addPhotos(event.target.files); event.target.value = ""; }}
                  ref={fileInput}
                  type="file"
                />
                <div className="capture-layout">
                  <div
                    className="drop-zone"
                    onClick={() => fileInput.current?.click()}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => { event.preventDefault(); addPhotos(event.dataTransfer.files); }}
                    role="button"
                    tabIndex={0}
                  >
                    <span className="zone-icon" aria-hidden="true">📷</span>
                    <b>Add script photos</b>
                    <span>Click to browse, or drop image files here.<br />One photo per handwritten script.</span>
                    <span className="zone-or">OR</span>
                    <button
                      className="retro-button"
                      onClick={(event) => { event.stopPropagation(); addSamples(); }}
                      type="button"
                    >
                      Load sample scripts
                    </button>
                    <small>4 sample handwritten scripts for testing</small>
                  </div>

                  <div className="tray">
                    <div className="tray-head">
                      <span>SCRIPT TRAY</span>
                      <small>{photos.length === 0 ? "empty" : `${photos.length} ready to process`}</small>
                    </div>
                    {photos.length === 0 ? (
                      <div className="tray-empty">
                        <b>No scripts yet</b>
                        <span>Photos you add appear here before processing.</span>
                      </div>
                    ) : (
                      <div className="thumb-grid">
                        {photos.map((photo, index) => (
                          <figure className="thumb" key={photo.id}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img alt={photo.name} src={photo.url} />
                            <figcaption>
                              <span>{photo.name}</span>
                              <span className="thumb-index">#{index + 1}</span>
                            </figcaption>
                            <button aria-label={`Remove ${photo.name}`} onClick={() => removePhoto(photo.id)} type="button">×</button>
                          </figure>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="capture-footer">
                  <button
                    className="retro-button primary-button run-button"
                    disabled={photos.length === 0}
                    onClick={runAgents}
                    type="button"
                  >
                    Upload and start agents{photos.length > 0 ? ` (${photos.length})` : ""}
                  </button>
                  <span className="spacer" />
                  <span className="hint">
                    <i className="status-light" />
                    One upload per batch. Nothing enters the clinic system without your approval.
                  </span>
                </div>
              </div>
            </section>
          ) : (
            <div className="batch-strip">
              <div className="batch-thumbs">
                {photos.slice(0, 6).map((photo) => (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img alt={photo.name} key={photo.id} src={photo.url} />
                ))}
              </div>
              <div>
                <b>Batch uploaded · {photos.length} script{photos.length === 1 ? "" : "s"}</b>
                <br />
                <small>{running ? "The crew is processing this batch now." : `Finished: ${readyCount} ready for entry, ${reviewCount} need review.`}</small>
              </div>
              <span className="spacer" />
              {phase === "done" ? (
                <button
                  className="retro-button primary-button"
                  onClick={() => router.push(`/review/${id}`)}
                  type="button"
                >
                  Finalize in review ▸
                </button>
              ) : (
                <span className="stage-chip" data-tone="run"><i />PROCESSING</span>
              )}
            </div>
          )}

          {/* Step 2: crew pipeline (after upload) */}
          {phase !== "capture" ? (
            <section className="sub-window pipeline-window">
              <div className="sub-title">
                <span className="step-no">2</span>
                <span>Processing crew</span>
                <small>
                  <span className="crew-count">{completedAgentSteps}/{totalAgentSteps} checks complete</span>
                </small>
              </div>
              <div className="agent-monitor">
                <div className="agent-monitor-top">
                  <div>
                    <b>{running ? "Crew is processing uploaded scripts" : "Crew finished processing"}</b>
                    <span>{photos.length} script{photos.length === 1 ? "" : "s"} · {feed.length} live log events</span>
                  </div>
                  <div className="monitor-progress">
                    <i style={{ width: `${batchProgress}%`, animationPlayState: running ? "running" : "paused" }} />
                  </div>
                </div>
                <div className="agent-monitor-list">
                  {AGENT_ORDER.map((agent, index) => (
                    <article className="agent-monitor-row" data-state={agentState(agent)} key={agent}>
                      <span className="monitor-step">{index + 1}</span>
                      <span className="agent-led" />
                      <div className="monitor-main">
                        <div className="monitor-title">
                          <b>{AGENT_LABELS[agent]}</b>
                          <small>{agentStatusLabel(agent)}</small>
                        </div>
                        <p>{agentLastMessage(agent)}</p>
                      </div>
                      <div className="monitor-metrics">
                        <span>{agentCompletedScripts(agent)}/{photos.length} scripts</span>
                        <small>{agentEventCount(agent)} events</small>
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            </section>
          ) : null}

          {/* Step 3: live log timeline (after upload) */}
          {phase !== "capture" ? (
            <section className="sub-window feed-window">
              <div className="sub-title">
                <span className="step-no">3</span>
                <span>Agent logs</span>
                <small>{running ? "streaming live" : `${feed.length} events`}</small>
              </div>
              <div className="log-timeline" role="log" aria-live="polite">
                {feed.length === 0 ? (
                  <p className="feed-idle">Agents are starting up...</p>
                ) : (
                  feed.map((event, index) => (
                    <LogEvent event={event} isLast={index === feed.length - 1} key={event.id} />
                  ))
                )}
              </div>
            </section>
          ) : null}

          {/* Step 4: summary */}
          {jobs.length > 0 ? (
            <section className="sub-window summary-window">
              <div className="sub-title">
                <span className="step-no">4</span>
                <span>Batch summary</span>
                <small>click a row for full detail and logs</small>
              </div>
              <div className="summary-table-viewport">
                <table className="summary-table">
                  <thead>
                    <tr>
                      <th style={{ width: 170 }}>Script photo</th>
                      <th style={{ width: 200 }}>Patient</th>
                      <th>Prescription</th>
                      <th style={{ width: 150 }}>Agent stage</th>
                      <th style={{ width: 132 }}>Progress</th>
                      <th style={{ width: 108 }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {jobs.map((job, index) => (
                      <JobRow
                        expanded={expanded === index}
                        index={index}
                        job={job}
                        key={job.photo.id}
                        onToggle={() => setExpanded(expanded === index ? null : index)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}
        </div>

        <div className="window-statusbar">
          <span><i className="status-light" /> {running ? "Processing batch" : "Idle"}</span>
          <span>Session #{id} reopens anytime with its code</span>
          <span>Demo data: live pipeline connects next</span>
        </div>
      </div>
    </main>
  );
}

function LogEvent({ event, isLast }: { event: ActivityEvent; isLast: boolean }) {
  const [showJson, setShowJson] = useState(false);
  return (
    <div className="log-event" data-status={event.status}>
      <div className="log-rail" aria-hidden="true">
        <span className="log-dot" />
        {!isLast ? <span className="log-line" /> : null}
      </div>
      <div className="log-card">
        <div className="log-head">
          <b>{AGENT_LABELS[event.agent]}</b>
          <span className="log-status-pill">{event.status}</span>
          <time>{event.at}</time>
          <button
            aria-expanded={showJson}
            className="log-json-toggle"
            onClick={() => setShowJson((open) => !open)}
            type="button"
          >
            JSON <span aria-hidden="true">{showJson ? "▾" : "▸"}</span>
          </button>
        </div>
        <div className="log-message">
          <p>{event.message}</p>
          <span className="log-photo-badge">photo #{event.jobIndex + 1}</span>
        </div>
        {showJson ? (
          <pre className="log-json">{JSON.stringify(
            {
              type: "agent.activity",
              agent: event.agent,
              agentLabel: AGENT_LABELS[event.agent],
              status: event.status,
              message: event.message,
              photo: event.jobIndex + 1,
              timestamp: event.at,
            },
            null,
            2,
          )}</pre>
        ) : null}
      </div>
    </div>
  );
}

function JobRow({ job, index, expanded, onToggle }: {
  job: Job; index: number; expanded: boolean; onToggle: () => void;
}) {
  const started = job.logs.length > 0;
  return (
    <>
      <tr className={`job-row${expanded ? " expanded" : ""}`} onClick={onToggle}>
        <td>
          <span className="summary-photo">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img alt={job.photo.name} src={job.photo.url} />
            <span>#{index + 1} {job.photo.name}</span>
          </span>
        </td>
        <td>{started ? `${job.scenario.patient.name} (${job.scenario.patient.regno})` : "-"}</td>
        <td>{started ? job.scenario.prescriptions.map((p) => p.text).join("; ") : "-"}</td>
        <td>
          <span className="stage-chip" data-tone={job.stageTone}><i />{job.stage}</span>
        </td>
        <td>
          <div className="mini-progress"><i style={{ width: `${job.progress}%`, animationPlayState: job.done ? "paused" : "running" }} /></div>
        </td>
        <td>
          {job.done
            ? (job.scenario.outcome === "ready"
              ? <span className="stage-chip" data-tone="ok"><i />READY</span>
              : <span className="stage-chip" data-tone="warn"><i />REVIEW</span>)
            : started
              ? <span className="stage-chip" data-tone="run"><i />WORKING</span>
              : <span className="stage-chip" data-tone="wait"><i />QUEUED</span>}
        </td>
      </tr>
      {expanded ? (
        <tr className="expanded">
          <td colSpan={6}>
            <div className="job-detail">
              <div className="job-detail-grid">
                <div className="detail-card">
                  <h4>PATIENT (FROM LIVE PIS)</h4>
                  <ul>
                    <li><b>RegNo</b><span>{job.scenario.patient.regno}</span></li>
                    <li><b>Name</b><span>{job.scenario.patient.name}</span></li>
                    <li><b>Age / Gender</b><span>{job.scenario.patient.age} / {job.scenario.patient.gender}</span></li>
                    <li><b>Amount</b><span>{job.scenario.amount}</span></li>
                  </ul>
                </div>
                <div className="detail-card">
                  <h4>PRESCRIPTIONS (GROUNDED)</h4>
                  <ul>
                    {job.scenario.prescriptions.map((prescription) => (
                      <li key={prescription.text}>
                        <b>{prescription.text}</b>
                        <span>confidence {(prescription.confidence * 100).toFixed(0)}%</span>
                      </li>
                    ))}
                    {job.scenario.reviewReasons.map((reason) => (
                      <li key={reason}><b className="review-flag">⚠ {reason}</b></li>
                    ))}
                  </ul>
                </div>
              </div>
              <div className="job-logs">
                {job.logs.map((log) => (
                  <p key={log.id}>
                    <time>{log.at}</time>
                    <span className="log-agent">[{AGENT_LABELS[log.agent]}]</span> {log.status}: {log.message}
                  </p>
                ))}
              </div>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}
