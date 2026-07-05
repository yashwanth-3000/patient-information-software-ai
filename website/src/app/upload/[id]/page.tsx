"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { touchSession } from "../session-store";

/* ------------------------------------------------------------------ */
/* Live pipeline: photos upload to the agent backend on Vultr, and the  */
/* crew's activity streams back over SSE while each script runs through */
/* the full crew (OCR -> intake -> PIS records -> pharmacist -> composer). */
/* ------------------------------------------------------------------ */

const AGENT_ORDER = ["ocr", "intake", "records", "pharmacist", "composer"] as const;

type AgentKey = (typeof AGENT_ORDER)[number];

/** Backend agent ids -> UI agent keys. */
const AGENT_FROM_BACKEND: Record<string, AgentKey> = {
  ocr_reader: "ocr",
  script_intake: "intake",
  patient_records: "records",
  pharmacist: "pharmacist",
  entry_composer: "composer",
};

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

const AGENT_MODELS: Record<AgentKey, string> = {
  ocr: "GPT-4o Vision",
  intake: "DeepSeek-V4-Flash · Vultr",
  records: "DeepSeek-V4-Flash · Vultr",
  pharmacist: "VultronRetriever-8B · Vultr",
  composer: "DeepSeek-V4-Flash · Vultr",
};

/** Real prescriptions from the clinic, photographed by the doctor's family. */
const ORIGINAL_SCRIPTS = [
  { name: "original-script-3183.jpg", url: "/original-scripts/script-3183.jpg", label: "Script A" },
  { name: "original-script-3186.jpg", url: "/original-scripts/script-3186.jpg", label: "Script B" },
  { name: "original-script-3188.jpg", url: "/original-scripts/script-3188.jpg", label: "Script C" },
  { name: "original-script-3189.jpg", url: "/original-scripts/script-3189.jpg", label: "Script D" },
  { name: "original-script-3190.jpg", url: "/original-scripts/script-3190.jpg", label: "Script E" },
  { name: "original-script-3191.jpg", url: "/original-scripts/script-3191.jpg", label: "Script F" },
  { name: "original-script-3192.jpg", url: "/original-scripts/script-3192.jpg", label: "Script G" },
];

/* ------------------------------------------------------------------ */

type Photo = { id: string; name: string; url: string; file: File | null };

type ActivityEvent = {
  id: number;
  jobIndex: number;
  agent: AgentKey;
  status: "started" | "progress" | "completed" | "error";
  message: string;
  at: string;
};

type EntryForm = {
  regno: string | null;
  patient_name: string | null;
  identity?: { status?: string; pis_name?: string | null };
  prescriptions?: { text?: string; confidence?: number }[];
  duration?: string | null;
  amount?: number | null;
  ready_for_entry?: boolean;
  review_reasons?: string[];
  summary?: string;
  evidence?: {
    pis_lookups?: { regno: string; result?: { found?: boolean; patient?: Record<string, unknown> } }[];
  };
};

type Job = {
  photo: Photo;
  jobId: string | null;
  form: EntryForm | null;
  patient: { regno: string; name: string; age: string; gender: string } | null;
  prescription: string;
  prescriptionConfidence: number;
  medicines: { text: string; confidence: number }[];
  outcome: "ready" | "review";
  reviewReasons: string[];
  stage: string;
  stageTone: "wait" | "run" | "ok" | "warn";
  progress: number;
  done: boolean;
  failed: boolean;
  logs: ActivityEvent[];
};

function nowStamp(): string {
  return new Date().toLocaleTimeString(undefined, { hour12: false });
}

function newJob(photo: Photo): Job {
  return {
    photo,
    jobId: null,
    form: null,
    patient: null,
    prescription: "",
    prescriptionConfidence: 0,
    medicines: [],
    outcome: "review",
    reviewReasons: [],
    stage: "Queued",
    stageTone: "wait",
    progress: 0,
    done: false,
    failed: false,
    logs: [],
  };
}

/** Build the PIS-style single prescription line from the composed form. */
function prescriptionLine(form: EntryForm): string {
  const parts = (form.prescriptions || [])
    .map((item) => String(item.text || "").trim())
    .filter(Boolean);
  const tail: string[] = [];
  if (form.duration) tail.push(String(form.duration));
  if (form.amount != null) tail.push(String(form.amount));
  return [...parts, tail.join(" ")].filter(Boolean).join(" // ");
}

function digestForm(form: EntryForm): Pick<Job, "patient" | "prescription" | "prescriptionConfidence" | "medicines" | "outcome" | "reviewReasons"> {
  const lookups = form.evidence?.pis_lookups || [];
  const matched = lookups.find(
    (entry) => entry.result?.found && String(entry.regno) === String(form.regno ?? ""),
  )?.result?.patient as Record<string, unknown> | undefined;
  const medicines = (form.prescriptions || []).map((item) => ({
    text: String(item.text || "").trim(),
    confidence: typeof item.confidence === "number" ? Math.max(0, Math.min(1, item.confidence)) : 0.5,
  })).filter((item) => item.text);
  const confidences = medicines.map((item) => item.confidence);
  return {
    patient: {
      regno: String(form.regno ?? "?"),
      name: String(form.patient_name ?? "Unknown patient").toUpperCase(),
      age: matched?.age != null ? String(matched.age) : "?",
      gender: matched?.gender != null ? String(matched.gender) : "?",
    },
    prescription: prescriptionLine(form),
    prescriptionConfidence: confidences.length ? Math.min(...confidences) : 0,
    medicines,
    outcome: form.ready_for_entry ? "ready" : "review",
    reviewReasons: form.review_reasons || [],
  };
}

/** Persist finished jobs so the /review/[id] page can pick them up. */
function saveReviewPayload(id: string, jobs: Job[]) {
  const entries = jobs.map((job, index) => ({
    photoName: job.photo.name,
    photoUrl: job.photo.url,
    index,
    jobId: job.jobId,
    regno: job.patient?.regno ?? "",
    patientName: job.patient?.name ?? "",
    age: job.patient?.age ?? "?",
    gender: job.patient?.gender ?? "?",
    outcome: job.outcome,
    reviewReasons: job.reviewReasons,
    prescription: job.prescription,
    prescriptionConfidence: job.prescriptionConfidence,
    medicines: job.medicines,
  }));
  try {
    window.sessionStorage.setItem(`clinicclick-review-${id}`, JSON.stringify(entries));
  } catch { /* storage full: review page falls back to demo data */ }
}

/**
 * Downscale + re-encode a photo to JPEG before upload.
 *
 * Raw phone captures are 4-12 MB (Vercel rejects bodies over ~4.5 MB) and can
 * be HEIC (which the OCR model rejects). Drawing onto a canvas fixes both:
 * the browser decodes whatever format it captured and we ship a small JPEG.
 */
async function compressPhoto(blob: Blob, name: string): Promise<{ blob: Blob; name: string }> {
  const MAX_EDGE = 1800;
  // Already small and in a format the OCR accepts: ship untouched, because
  // every re-encode costs handwriting legibility.
  if (blob.size < 3_500_000 && /image\/(jpeg|png|webp)/.test(blob.type)) {
    return { blob, name };
  }
  try {
    const url = URL.createObjectURL(blob);
    try {
      const image = document.createElement("img");
      image.src = url;
      await image.decode();
      const scale = Math.min(1, MAX_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("no canvas context");
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const jpeg = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.85),
      );
      if (!jpeg || jpeg.size === 0) throw new Error("encode failed");
      return { blob: jpeg, name: name.replace(/\.[^.]+$/, "") + ".jpg" };
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch {
    // Could not decode (rare) - send the original and let the backend try.
    return { blob, name };
  }
}

/** Parse an SSE byte stream, invoking onEvent per `data:` payload. */
async function consumeSse(response: Response, onEvent: (data: Record<string, unknown>) => void) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Stream unavailable");
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";
    for (const chunk of chunks) {
      for (const line of chunk.split("\n")) {
        if (!line.startsWith("data:")) continue;
        try {
          onEvent(JSON.parse(line.slice(5).trim()));
        } catch { /* ignore malformed frames */ }
      }
    }
  }
}

export default function UploadSession({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [feed, setFeed] = useState<ActivityEvent[]>([]);
  const [phase, setPhase] = useState<"capture" | "processing" | "done">("capture");
  const [expanded, setExpanded] = useState<number | null>(null);
  const [logsOpen, setLogsOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const fileInput = useRef<HTMLInputElement>(null);
  const eventCounter = useRef(0);
  const jobsRef = useRef<Job[]>([]);

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
        file,
      }));
    setPhotos((current) => {
      const next = [...current, ...additions];
      touchSession(id, { photoCount: next.length });
      return next;
    });
  }, [id]);

  const togglePicked = (name: string) => {
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  const addPicked = () => {
    setPhotos((current) => {
      const have = new Set(current.map((photo) => photo.name));
      const additions = ORIGINAL_SCRIPTS
        .filter((script) => picked.has(script.name) && !have.has(script.name))
        .map((script, index) => ({
          id: `original-${Date.now()}-${index}`,
          name: script.name,
          url: script.url,
          file: null,
        }));
      const next = [...current, ...additions];
      touchSession(id, { photoCount: next.length });
      return next;
    });
    setPickerOpen(false);
    setPicked(new Set());
  };

  const removePhoto = (photoId: string) => {
    setPhotos((current) => {
      const next = current.filter((photo) => photo.id !== photoId);
      touchSession(id, { photoCount: next.length });
      return next;
    });
  };

  const patchJob = useCallback((jobIndex: number, patch: Partial<Job> | ((job: Job) => Partial<Job>)) => {
    setJobs((current) => current.map((job, index) => {
      if (index !== jobIndex) return job;
      const value = typeof patch === "function" ? patch(job) : patch;
      return { ...job, ...value };
    }));
    jobsRef.current = jobsRef.current.map((job, index) => {
      if (index !== jobIndex) return job;
      const value = typeof patch === "function" ? patch(job) : patch;
      return { ...job, ...value };
    });
  }, []);

  const pushEvent = useCallback((jobIndex: number, agent: AgentKey, status: ActivityEvent["status"], message: string) => {
    const event: ActivityEvent = {
      id: eventCounter.current++,
      jobIndex,
      agent,
      status,
      message,
      at: nowStamp(),
    };
    setFeed((current) => [event, ...current].slice(0, 120));
    patchJob(jobIndex, (job) => ({ logs: [...job.logs, event] }));
    return event;
  }, [patchJob]);

  /** Run one photo through the live crew and stream its activity. */
  const runOne = useCallback(async (jobIndex: number, photo: Photo) => {
    patchJob(jobIndex, { stage: "Preparing photo", stageTone: "run", progress: 2 });
    const raw = photo.file ?? await (await fetch(photo.url)).blob();
    const { blob, name } = await compressPhoto(raw, photo.name);
    const body = new FormData();
    body.append("file", blob, name);

    patchJob(jobIndex, { stage: "Uploading", stageTone: "run", progress: 4 });
    const created = await fetch("/api/agent/scripts", { method: "POST", body });
    if (!created.ok) {
      throw new Error(created.status === 413
        ? "Photo too large for upload - please retry"
        : `Upload failed (${created.status})`);
    }
    const { job_id: jobId } = await created.json() as { job_id: string };
    patchJob(jobIndex, { jobId });

    const applyResult = (form: EntryForm) => {
      const digest = digestForm(form);
      patchJob(jobIndex, {
        form,
        ...digest,
        stage: digest.outcome === "ready" ? "Ready for entry" : "Needs review",
        stageTone: digest.outcome === "ready" ? "ok" : "warn",
        progress: 100,
        done: true,
      });
    };

    /* Live SSE stream through the Vercel proxy. Mobile browsers drop these
       streams freely (screen lock, network switch, proxy limits), so any
       stream failure falls through to polling below instead of failing. */
    let pipelineError: string | null = null;
    try {
      const stream = await fetch(`/api/agent/jobs/${jobId}/stream`, {
        headers: { accept: "text/event-stream" },
        cache: "no-store",
      });
      if (!stream.ok) throw new Error(`Stream failed (${stream.status})`);

      let seenSteps = 0;
      await consumeSse(stream, (data) => {
        if (data.type === "agent_activity") {
          const agent = AGENT_FROM_BACKEND[String(data.agent)] ?? "composer";
          const status = (["started", "progress", "completed", "error"].includes(String(data.status))
            ? String(data.status)
            : "progress") as ActivityEvent["status"];
          pushEvent(jobIndex, agent, status, String(data.message ?? ""));
          seenSteps += 1;
          patchJob(jobIndex, {
            stage: AGENT_LABELS[agent],
            stageTone: "run",
            progress: Math.min(96, 5 + seenSteps * 6),
          });
        } else if (data.type === "result") {
          applyResult(data.form as EntryForm);
        } else if (data.type === "error") {
          pipelineError = String(data.message ?? "Pipeline failed");
        }
      });
    } catch { /* stream dropped - recover via polling */ }

    if (pipelineError) throw new Error(pipelineError);
    if (jobsRef.current[jobIndex]?.done) return;

    /* Fallback: the backend keeps running even when the stream dies. Poll the
       job until the crew finishes (a full script takes up to ~2 minutes). */
    patchJob(jobIndex, { stage: "Reconnecting", stageTone: "run" });
    for (let attempt = 0; attempt < 60; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      let job: { status?: string; error?: string; form?: EntryForm } | null = null;
      try {
        const response = await fetch(`/api/agent/jobs/${jobId}`, { cache: "no-store" });
        if (!response.ok) continue;
        job = await response.json();
      } catch { continue; }
      if (!job) continue;
      if (job.status === "failed") throw new Error(job.error || "Pipeline failed");
      if (job.form) {
        pushEvent(jobIndex, "composer", "completed", "Connection recovered - entry retrieved from the crew.");
        applyResult(job.form);
        return;
      }
    }
    throw new Error("Lost connection to the crew - reopen this session to retry.");
  }, [patchJob, pushEvent]);

  const runAgents = async () => {
    if (photos.length === 0 || phase !== "capture") return;
    setPhase("processing");
    setExpanded(null);
    touchSession(id, { status: "processing", photoCount: photos.length });

    const initialJobs = photos.map(newJob);
    jobsRef.current = initialJobs;
    setJobs(initialJobs);
    setFeed([]);

    /* Each script runs through the WHOLE crew before the next one starts. */
    for (let index = 0; index < photos.length; index += 1) {
      try {
        await runOne(index, photos[index]);
      } catch (error) {
        pushEvent(index, "composer", "error", error instanceof Error ? error.message : "Processing failed");
        patchJob(index, {
          stage: "Failed",
          stageTone: "warn",
          progress: 100,
          done: true,
          failed: true,
          outcome: "review",
          reviewReasons: ["Processing failed - retry this script or enter it manually."],
        });
      }
    }

    setPhase("done");
    touchSession(id, { status: "processed" });
    saveReviewPayload(id, jobsRef.current);
  };

  const running = phase === "processing";
  const readyCount = jobs.filter((job) => job.done && !job.failed && job.outcome === "ready").length;
  const reviewCount = jobs.filter((job) => job.done && (job.failed || job.outcome === "review")).length;
  const currentEvent = feed[0];

  /* Each script runs through the whole crew before the next one starts,
     so the active agent + script come straight from the newest event.
     Completion counts come from per-job logs (not the capped feed). */
  const activeAgent = running && currentEvent ? currentEvent.agent : null;
  const activeScript = running && currentEvent ? currentEvent.jobIndex + 1 : null;

  const agentCompletedScripts = (agent: AgentKey) =>
    jobs.filter((job) => job.logs.some((log) => log.agent === agent && log.status === "completed")).length;

  const agentState = (agent: AgentKey): "idle" | "active" | "done" => {
    if (jobs.length > 0 && agentCompletedScripts(agent) >= jobs.length) return "done";
    if (activeAgent === agent) return "active";
    return "idle";
  };

  const agentStatusLabel = (agent: AgentKey): string => {
    const total = jobs.length;
    const completed = agentCompletedScripts(agent);
    if (total > 0 && completed >= total) return "completed";
    if (activeAgent === agent) return `processing script ${activeScript}/${total}`;
    if (completed > 0) return `${completed}/${total} scripts done`;
    return "waiting";
  };

  const agentLastMessage = (agent: AgentKey): string => {
    const event = feed.find((entry) => entry.agent === agent);
    return event ? event.message : AGENT_BLURBS[agent];
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
          <Link className="nav-em" href="/about">About ▸</Link>
        </div>
      </nav>

      <div className="page-window shell">
        <div className="window-titlebar">
          <span className="window-app-icon">P</span>
          <span>Upload Session #{id}</span>
          <div className="window-controls">
            <i aria-hidden="true">_</i>
            <i aria-hidden="true">□</i>
            <button aria-label="Close and go back" className="close" onClick={() => router.push("/upload")} type="button">×</button>
          </div>
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
                      onClick={(event) => { event.stopPropagation(); setPickerOpen(true); }}
                      type="button"
                    >
                      I want to test it
                    </button>
                    <small>Pick from real prescriptions written by the doctor</small>
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

          {/* Crew pipeline (after upload) */}
          {phase !== "capture" ? (
            <section className="sub-window pipeline-window">
              <div className="sub-title">
                <span>Processing crew</span>
                <small>{running ? "crew is working" : "batch finished"}</small>
                <span className="spacer" />
                <small className="crew-track">Vultr Serverless Inference · VultronRetriever grounding</small>
              </div>
              <div className="pipeline-grid">
                {AGENT_ORDER.map((agent) => (
                  <article className="agent-card" data-state={agentState(agent)} key={agent}>
                    <div className="agent-head">
                      <span className="agent-led" />
                      <span>
                        <b>{AGENT_LABELS[agent]}</b>
                        <small className="agent-status">{agentStatusLabel(agent)}</small>
                      </span>
                    </div>
                    <p>{agentLastMessage(agent)}</p>
                    <span className="agent-model">{AGENT_MODELS[agent]}</span>
                  </article>
                ))}
              </div>
            </section>
          ) : null}

          {/* Batch summary (kept above the logs) */}
          {jobs.length > 0 ? (
            <section className="sub-window summary-window">
              <div className="sub-title">
                <span>Batch summary</span>
                <small>click a row for full detail and logs</small>
              </div>
              <div className="summary-table-viewport">
                <table className="summary-table">
                  <thead>
                    <tr>
                      <th style={{ width: 190 }}>Script photo</th>
                      <th style={{ width: 230 }}>Patient</th>
                      <th>Prescription</th>
                      <th style={{ width: 165 }}>Agent stage</th>
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

          {/* Agent logs (collapsed by default) */}
          {phase !== "capture" ? (
            <section className="sub-window feed-window" data-collapsed={!logsOpen}>
              <button
                aria-expanded={logsOpen}
                className="sub-title sub-title-toggle"
                onClick={() => setLogsOpen((open) => !open)}
                type="button"
              >
                <span>Agent logs</span>
                <small>{running ? "streaming live" : `${feed.length} events`}</small>
                <span className="spacer" />
                <span className="toggle-caret" aria-hidden="true">{logsOpen ? "▾ hide" : "▸ show"}</span>
              </button>
              {logsOpen ? (
                <div className="log-timeline" role="log" aria-live="polite">
                  {feed.length === 0 ? (
                    <p className="feed-idle">Agents are starting up...</p>
                  ) : (
                    feed.map((event, index) => (
                      <LogEvent event={event} isLast={index === feed.length - 1} key={event.id} />
                    ))
                  )}
                </div>
              ) : null}
            </section>
          ) : null}
        </div>

        <div className="window-statusbar">
          <span><i className="status-light" /> {running ? "Processing batch" : "Idle"}</span>
          <span>Session #{id} reopens anytime with its code</span>
          <span>Live crew on Vultr Serverless Inference</span>
        </div>
      </div>

      {pickerOpen ? (
        <div
          className="deck-modal-backdrop"
          onClick={(event) => { if (event.target === event.currentTarget) setPickerOpen(false); }}
          role="presentation"
        >
          <div aria-label="Pick real prescriptions" className="deck-modal picker-modal" role="dialog">
            <div className="window-titlebar">
              <span className="window-app-icon">P</span>
              <span>Real prescriptions from the clinic</span>
              <div className="window-controls">
                <i aria-hidden="true">_</i>
                <i aria-hidden="true">□</i>
                <button aria-label="Close picker" className="close" onClick={() => setPickerOpen(false)} type="button">×</button>
              </div>
            </div>
            <div className="picker-body">
              <p className="picker-hint">
                Handwritten by the doctor, photographed at the clinic. Pick one or select all -
                the crew reads them exactly like fresh camera photos.
              </p>
              <div className="picker-grid">
                {ORIGINAL_SCRIPTS.map((script) => {
                  const selected = picked.has(script.name);
                  const alreadyIn = photos.some((photo) => photo.name === script.name);
                  return (
                    <button
                      aria-pressed={selected}
                      className="picker-card"
                      data-selected={selected || undefined}
                      disabled={alreadyIn}
                      key={script.name}
                      onClick={() => togglePicked(script.name)}
                      type="button"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img alt={script.label} src={script.url} />
                      <span className="picker-card-foot">
                        <b>{script.label}</b>
                        <i className="picker-check" aria-hidden="true">{alreadyIn ? "IN TRAY" : selected ? "✓" : ""}</i>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="picker-foot">
              <button
                className="retro-button"
                onClick={() => {
                  const all = ORIGINAL_SCRIPTS
                    .filter((script) => !photos.some((photo) => photo.name === script.name))
                    .map((script) => script.name);
                  setPicked(new Set(all));
                }}
                type="button"
              >
                Select all
              </button>
              <span className="spacer" />
              <button className="retro-button" onClick={() => setPickerOpen(false)} type="button">Cancel</button>
              <button
                className="retro-button primary-button"
                disabled={picked.size === 0}
                onClick={addPicked}
                type="button"
              >
                Add {picked.size > 0 ? `${picked.size} ` : ""}to tray
              </button>
            </div>
          </div>
        </div>
      ) : null}
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
            <span>
              <b>Script #{index + 1}</b>
              <small>{job.photo.name}</small>
            </span>
          </span>
        </td>
        <td>{job.patient ? `${job.patient.name} (${job.patient.regno})` : <span className="pending-dash">-</span>}</td>
        <td>{job.prescription || <span className="pending-dash">-</span>}</td>
        <td>
          <span className="stage-chip" data-tone={job.stageTone}><i />{job.stage}</span>
        </td>
        <td>
          {job.done
            ? (job.failed
              ? <span className="stage-chip" data-tone="warn"><i />FAILED</span>
              : job.outcome === "ready"
                ? <span className="stage-chip" data-tone="ok"><i />READY</span>
                : <span className="stage-chip" data-tone="warn"><i />REVIEW</span>)
            : started
              ? <span className="stage-chip" data-tone="run"><i />WORKING</span>
              : <span className="stage-chip" data-tone="wait"><i />QUEUED</span>}
        </td>
      </tr>
      {expanded ? (
        <tr className="expanded">
          <td colSpan={5}>
            <div className="job-detail">
              <div className="job-detail-grid">
                <div className="detail-card">
                  <h4>PATIENT (FROM LIVE PIS)</h4>
                  <ul>
                    <li><b>RegNo</b><span>{job.patient?.regno ?? "-"}</span></li>
                    <li><b>Name</b><span>{job.patient?.name ?? "-"}</span></li>
                    <li><b>Age / Gender</b><span>{job.patient ? `${job.patient.age} / ${job.patient.gender}` : "-"}</span></li>
                    <li><b>Prescription</b><span>{job.prescription || "-"}</span></li>
                  </ul>
                </div>
                <div className="detail-card">
                  <h4>MEDICINES (GROUNDED)</h4>
                  <ul>
                    {job.medicines.map((medicine, medicineIndex) => (
                      <li key={`${medicine.text}-${medicineIndex}`}>
                        <b>{medicine.text}</b>
                        <span>confidence {(medicine.confidence * 100).toFixed(0)}%</span>
                      </li>
                    ))}
                    {job.reviewReasons.map((reason) => (
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
