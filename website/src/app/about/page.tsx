import Link from "next/link";

import styles from "./page.module.css";

/* ------------------------------------------------------------------ */
/* About: long-form article on the problem, the solution, and how the  */
/* project answers the RAISE 2026 Vultr track brief point by point.    */
/* ------------------------------------------------------------------ */

const STATS = [
  { n: "Minutes", l: "To file a day's backlog (was days)" },
  { n: "0", l: "New apps for the clinic" },
  { n: "20+ yrs", l: "Patient history retained" },
  { n: "100%", l: "Entries human-approved" },
];

const TRACK_BRIEF = [
  {
    n: "01",
    ask: "\u201CThe keyword is agent\u201D - a single retrieve-then-answer call is not enough",
    how: "Five CrewAI agents run a genuine multi-step workflow per script: an OCR reader extracts the handwriting, an intake agent normalizes it, a records agent verifies identity, a pharmacist grounds every medicine, and a composer assembles the final entry. Each stage reasons over the previous stage's evidence and can change the plan.",
  },
  {
    n: "02",
    ask: "Plans, and retrieves more than once when it needs to",
    how: "The Patient Records Agent looks up every plausible RegNo reading against the live clinic database. If no record carries the patient's name, it plans a second retrieval round - digit-confusion variants of the handwriting (this doctor's 2 reads as 9, his 8 as 6) - until a name-consistent record is found, or it honestly reports not-found.",
  },
  {
    n: "03",
    ask: "Grounds its decisions in documents",
    how: "Every handwritten medicine line is scored against a homeopathy remedy corpus using VultronRetriever rerank on Vultr. The pharmacist may only canonicalize a remedy the corpus evidence supports - each accepted line carries its corpus citation, and unsupported lines are flagged for a human instead of guessed.",
  },
  {
    n: "04",
    ask: "Calls tools and makes decisions",
    how: "The agents call real tools: vision OCR, live PIS patient lookup through the Vultr relay, VultronRetriever rerank, and the clinic submission queue. The composer then decides - ready for entry, or needs review with explicit reasons - and never invents a value that is not in the evidence.",
  },
  {
    n: "05",
    ask: "An outcome a real enterprise team could actually use",
    how: "The output is not a chat answer. It is a completed entry inside the clinic's actual 20-year-old Patient Information System - the same Access database and WinForms software the assistants already use, with every past patient record intact. Healthcare is one of the track's named industries.",
  },
  {
    n: "06",
    ask: "All LLM workloads on Vultr Serverless Inference",
    how: "Agent reasoning runs on DeepSeek-V4-Flash and document grounding on VultronRetrieverPrime-Qwen3.5-8B, both on Vultr Serverless Inference. The agent backend and the clinic relay API are deployed on a Vultr compute instance. Only perception (reading the photo) uses a vision model - every agentic decision is made on Vultr.",
  },
];

const CREW = [
  {
    tag: "Perception",
    name: "Script OCR Reader",
    desc: "Reads the handwritten chit: RegNo, patient name, shorthand medicine lines, duration, and amount - with alternates for every ambiguous digit, because the RegNo is the one field the clinic cannot afford to get wrong.",
    model: "GPT-4o Vision",
    vultr: false,
    wide: false,
  },
  {
    tag: "Normalization",
    name: "Script Intake Agent",
    desc: "Turns the raw reading into structured fields, drops cancelled text the doctor struck through, and never fills a blank with a guess - missing data stays null and gets flagged.",
    model: "DeepSeek-V4-Flash · Vultr Serverless Inference",
    vultr: true,
    wide: false,
  },
  {
    tag: "Identity · live retrieval",
    name: "Patient Records Agent",
    desc: "Verifies the patient against the live clinic database in real time. When no record matches the name, it retries digit-confusion RegNo variants until the identity is name-consistent - or reports not-found for human attention.",
    model: "DeepSeek-V4-Flash · Vultr Serverless Inference",
    vultr: true,
    wide: false,
  },
  {
    tag: "Document grounding",
    name: "Homeopathy Pharmacist",
    desc: "Grounds every medicine line in the remedy corpus via rerank. Accepts only what the evidence supports, cites the corpus line it used, and flags the rest for review.",
    model: "VultronRetrieverPrime-Qwen3.5-8B · Vultr rerank",
    vultr: true,
    wide: false,
  },
  {
    tag: "Decision",
    name: "Entry Composer Agent",
    desc: "Assembles the final PIS entry with confidences and citations from every stage, then makes the call: ready for entry, or needs human review - with the exact reasons listed.",
    model: "DeepSeek-V4-Flash · Vultr Serverless Inference",
    vultr: true,
    wide: true,
  },
];

const PIPELINE = [
  {
    title: "Photograph the day's scripts",
    detail: "An assistant photographs the handwritten prescriptions - one photo per script, straight from the phone. One upload per batch.",
  },
  {
    title: "The crew processes each script",
    detail: "OCR, intake, live identity verification, remedy grounding, entry composition. Each script runs through the whole crew before the next begins, and every agent step streams to the screen over SSE.",
  },
  {
    title: "A human reviews every entry",
    detail: "A swipe deck shows each composed entry next to its original photo. Approve, edit, or skip - nothing moves forward without a person's decision.",
  },
  {
    title: "One button inside the old software",
    detail: "Approved entries wait in the Vultr queue. Inside PIS, the assistant clicks Get New Data from App and they import into the patient records - backup first, transaction-protected, duplicate-safe.",
  },
];

const ENTERPRISE = [
  {
    name: "Legacy software, untouched workflow",
    desc: "The clinic keeps its .NET 2.0 WinForms software and Access database. We patched one new button into the existing executable - no migration, no retraining, no new app to learn.",
  },
  {
    name: "A live two-way bridge on Vultr",
    desc: "A relay API on a Vultr compute instance lets the agents query the live patient database in real time and queue approved entries back - even though the clinic machine is a Windows 7 box that cannot speak modern TLS.",
  },
  {
    name: "Safety as a hard boundary",
    desc: "Database backup before every import, transaction rollback on failure, duplicate-safe job IDs, and one strict rule across all agents: missing data is never invented - it stays null and gets flagged.",
  },
];

export default function AboutPage() {
  return (
    <div className={styles.page}>
      <header className={styles.navShell}>
        <nav className="nav shell" aria-label="Main navigation">
          <Link className="brand" href="/">
            <span className="brand-icon" aria-hidden="true">P</span>
            <span>patient-information-software-ai</span>
          </Link>
          <div className="nav-links">
            <Link href="/upload">Upload</Link>
            <a href="https://github.com/yashwanth-3000/patient-information-software-ai" target="_blank" rel="noreferrer">GitHub</a>
            <Link className="nav-em" href="/about">About ▸</Link>
          </div>
        </nav>
      </header>

      <article className={styles.article}>
        {/* ── OPENING ─────────────────────────────────────────── */}
        <span className={styles.openKicker}>
          RAISE Summit Hackathon 2026 · Vultr Track · Enterprise Agents
        </span>

        <h1 className={styles.mainTitle}>
          Handwritten prescriptions, filed by agents.
        </h1>

        <p className={styles.lead}>
          My dad is a doctor. When a patient arrives, he checks their previous prescriptions
          and writes a new one by hand. After every consultation, one assistant packs the
          medicines while the other manually types the handwritten prescription into an
          old-school patient software. As the day goes on the chits pile up - and that backlog
          can take <b>days or even weeks</b> to clear. So we built the fix: <b>take a photo of
          the prescription, and AI enters it into the patient software the clinic already
          uses.</b> No new app, no switching software, and every past patient record stays
          exactly where it has always been.
        </p>

        <div className={styles.statStrip}>
          {STATS.map((s) => (
            <div key={s.l} className={styles.statCell}>
              <p className={styles.statNumber}>{s.n}</p>
              <p className={styles.statLabel}>{s.l}</p>
            </div>
          ))}
        </div>

        <hr className={styles.divider} />

        {/* ── THE TRACK ───────────────────────────────────────── */}
        <p className={styles.chapterKicker}>The hackathon track · main aim</p>

        <h2 className={styles.chapterTitle}>
          Build a web-based Enterprise Agent that grounds its decisions in documents.
        </h2>

        <div className={styles.prose}>
          <p>
            That is the Vultr track brief, and it is explicit about what does <i>not</i> count:
            <b> a single retrieve-then-answer call is not enough.</b> The track asks for a
            multi-step workflow where the system <b>plans</b>, <b>retrieves more than once</b> when
            it needs to, <b>calls tools</b>, <b>makes decisions</b>, and produces <b>an outcome a
            real enterprise team could actually use</b> - transforming agentic operations in
            industries like Healthcare, Telecommunications, Finance, and Hospitality. One hard
            constraint sits underneath all of it: <b>every LLM workload must run on Vultr
            Serverless Inference</b>.
          </p>
          <p>
            <b>patient-information-software-ai</b> is our answer: a healthcare enterprise agent
            that reads real handwritten prescriptions and files them into a real, 20-year-old
            clinic system. Here is the brief, requirement by requirement, against what the
            project actually does:
          </p>
        </div>

        <div className={styles.reqList}>
          {TRACK_BRIEF.map((r) => (
            <div key={r.n} className={styles.reqRow}>
              <p className={styles.reqNum}>{r.n}</p>
              <div>
                <p className={styles.reqAsk}>{r.ask}</p>
                <p className={styles.reqHow}>{r.how}</p>
              </div>
            </div>
          ))}
        </div>

        <hr className={styles.divider} />

        {/* ── THE CREW ────────────────────────────────────────── */}
        <p className={styles.chapterKicker}>The agent crew · CrewAI on Vultr</p>

        <h2 className={styles.chapterTitle}>
          Five agents, one script at a time.
        </h2>

        <div className={styles.prose}>
          <p>
            Each photographed script runs through the whole crew before the next one starts.
            Every agent hands structured evidence to the next - OCR alternates, live database
            records, corpus citations - and the composer can only use what the evidence
            contains. Perception reads the photo; <b>every agentic decision runs on Vultr
            Serverless Inference</b>.
          </p>
        </div>

        <div className={styles.crewGrid}>
          {CREW.map((c) => (
            <div key={c.name} className={`${styles.crewCard}${c.wide ? ` ${styles.crewCardWide}` : ""}`}>
              <p className={styles.crewTag}>{c.tag}</p>
              <p className={styles.crewName}>{c.name}</p>
              <p className={styles.crewDesc}>{c.desc}</p>
              <p className={`${styles.crewModel}${c.vultr ? ` ${styles.crewModelVultr}` : ""}`}>{c.model}</p>
            </div>
          ))}
        </div>

        <hr className={styles.divider} />

        {/* ── PIPELINE ────────────────────────────────────────── */}
        <p className={styles.chapterKicker}>From paper to patient record</p>

        <h2 className={styles.chapterTitle}>
          The full pipeline, end to end.
        </h2>

        <div className={styles.logCard}>
          <div className={styles.logCardHeader}>
            <p className={styles.logCardTitle}>Run-of-show</p>
            <p className={styles.logCardMeta}>photo → agents → human review → one-button import</p>
          </div>
          <div className={styles.logPanel}>
            {PIPELINE.map((step, i) => (
              <div key={step.title} className={styles.logStep}>
                <div className={styles.logBulletCol}>
                  <span className={styles.logBullet} />
                  {i < PIPELINE.length - 1 && <span className={styles.logLine} />}
                </div>
                <div className={styles.logStepContent}>
                  <p className={styles.logStepTitle}>{step.title}</p>
                  <p className={styles.logStepDetail}>{step.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <hr className={styles.divider} />

        {/* ── ENTERPRISE INTEGRATION ──────────────────────────── */}
        <p className={styles.chapterKicker}>Why this is an enterprise agent</p>

        <h2 className={styles.chapterTitle}>
          Not a demo against a fake API.
        </h2>

        <div className={styles.prose}>
          <p>
            Most hackathon agents talk to a mock backend. This project integrates with the
            clinic&apos;s actual Patient Information System - a two-decade-old Access database
            behind a .NET 2.0 WinForms app on Windows 7 - and treats it as the system of record
            it really is.
          </p>
        </div>

        <div className={styles.entGrid}>
          {ENTERPRISE.map((e) => (
            <div key={e.name} className={styles.entCard}>
              <p className={styles.entName}>{e.name}</p>
              <p className={styles.entDesc}>{e.desc}</p>
            </div>
          ))}
        </div>

        <div className={styles.note}>
          <span className={styles.noteDot} aria-hidden="true" />
          <span>
            This is workflow automation, not medical advice. The doctor writes every
            prescription; the agents only transcribe, verify, and file it - and a human approves
            every entry before it touches the clinic database.
          </span>
        </div>

        <div className={styles.pullQuote}>
          <p className={styles.pullQuoteText}>
            The best enterprise agent is invisible: the clinic keeps its software, its data, and
            its habits - only the backlog disappears.
          </p>
        </div>

        {/* ── CTA ─────────────────────────────────────────────── */}
        <div className={styles.ctaBanner}>
          <p className={styles.ctaBannerKicker}>Try it yourself</p>
          <h2 className={styles.ctaBannerTitle}>Watch the crew read a real script.</h2>
          <p className={styles.ctaBannerBody}>
            Pick one of the doctor&apos;s real handwritten prescriptions - or upload your own
            photo - and watch every agent decision stream live: OCR alternates, live database
            lookups, corpus citations, and the final composed entry.
          </p>
          <div className={styles.ctaBannerActions}>
            <Link href="/upload" className={styles.ctaPrimary}>Open the demo</Link>
            <a
              href="https://youtu.be/dV-YGESVPkc"
              className={styles.ctaSecondary}
              target="_blank"
              rel="noreferrer"
            >
              Watch the 1-min video
            </a>
          </div>
        </div>
      </article>

      <footer className={styles.footer}>
        <p>© 2026 patient-information-software-ai · RAISE Summit Hackathon · Vultr Track</p>
        <div className={styles.footerLinks}>
          <Link href="/">Home</Link>
          <Link href="/upload">Upload</Link>
          <a href="https://github.com/yashwanth-3000/patient-information-software-ai" target="_blank" rel="noreferrer">GitHub</a>
        </div>
      </footer>
    </div>
  );
}
