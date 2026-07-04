import { CopyCommand } from "@/components/copy-command";

const CheckIcon = () => (
  <svg viewBox="0 0 20 20" aria-hidden="true">
    <path d="m4 10.5 3.5 3.5L16 5.5" />
  </svg>
);

const ArrowIcon = () => (
  <svg viewBox="0 0 20 20" aria-hidden="true">
    <path d="M4 10h12M11 5l5 5-5 5" />
  </svg>
);

const steps = [
  {
    number: "01",
    title: "Send an approved job",
    copy: "Your web app defines exactly which synthetic patient fields are allowed for the run.",
  },
  {
    number: "02",
    title: "Preview before action",
    copy: "Dry-run mode reads the screen and proposes the first action without clicking or typing.",
  },
  {
    number: "03",
    title: "Run with guardrails",
    copy: "Every action is checked against the approved job, logged, and protected by an emergency stop.",
  },
];

const safeguards = [
  "Approved fields only",
  "Synthetic demo data",
  "No delete actions",
  "Every action logged",
];

export default function Home() {
  return (
    <main>
      <nav className="nav shell" aria-label="Main navigation">
        <a className="brand" href="#top" aria-label="Patient Information Software AI home">
          <span className="brand-mark" aria-hidden="true">
            <span />
            <span />
          </span>
          patient-information-software-ai
        </a>
        <div className="nav-links">
          <a href="#how-it-works">How it works</a>
          <a href="#safety">Safety</a>
          <a className="nav-cta" href="#demo">
            View demo <ArrowIcon />
          </a>
        </div>
      </nav>

      <section className="hero shell" id="top">
        <div className="hero-copy">
          <h1>
            Patient admin, automated.
            <em>Care stays human.</em>
          </h1>
          <p className="hero-lede">
            Patient Information Software AI helps care teams complete repetitive patient information
            tasks with an AI assistant that previews, verifies, and logs every move.
          </p>
          <div className="hero-actions">
            <a className="button primary" href="#demo">
              See the workflow <ArrowIcon />
            </a>
            <a className="text-link" href="#safety">
              Explore safeguards <ArrowIcon />
            </a>
          </div>
        </div>

        <div className="hero-visual" aria-label="Patient Information Software AI workflow preview">
          <div className="visual-label"><span className="pulse" /> Live workflow preview</div>
          <div className="orb orb-one" />
          <div className="orb orb-two" />
          <div className="app-card">
            <div className="app-topbar">
              <div className="window-dots"><span /><span /><span /></div>
              <span className="secure-pill">● Secure demo</span>
            </div>
            <div className="app-body">
              <div className="app-heading">
                <div>
                  <span className="mini-label">CURRENT JOB</span>
                  <h2>Add patient information</h2>
                </div>
                <span className="status">Approved</span>
              </div>
              <div className="patient-card">
                <span className="patient-avatar">TP</span>
                <div><strong>TEST PATIENT</strong><small>Synthetic demo record</small></div>
                <span className="verified"><CheckIcon /></span>
              </div>
              <div className="field-grid">
                <div><span>First name</span><strong>TEST</strong></div>
                <div><span>Last name</span><strong>PATIENT</strong></div>
                <div className="field-wide"><span>Action policy</span><strong>Approved fields only</strong></div>
              </div>
              <div className="activity">
                <div className="activity-line"><span className="activity-icon"><CheckIcon /></span><p><strong>Screen verified</strong><small>Target window matches approved job</small></p><time>Now</time></div>
                <div className="activity-line muted"><span className="activity-icon">2</span><p><strong>Ready to enter data</strong><small>Waiting for operator start</small></p></div>
              </div>
              <button className="run-button" type="button">Run approved demo <ArrowIcon /></button>
            </div>
          </div>
          <div className="floating-note note-top"><span><CheckIcon /></span><strong>Safety check passed</strong><small>0 unapproved fields</small></div>
          <div className="floating-note note-bottom"><span className="log-icon">↗</span><strong>Actions logged</strong><small>Clear, reviewable history</small></div>
        </div>
      </section>

      <section className="proof-strip">
        <div className="shell proof-grid">
          <p>Designed around trust, not shortcuts.</p>
          {safeguards.map((item) => <div key={item}><CheckIcon />{item}</div>)}
        </div>
      </section>

      <section className="section shell" id="how-it-works">
        <div className="section-heading">
          <div><span className="kicker">HOW IT WORKS</span><h2>A calmer way to handle repetitive work.</h2></div>
          <p>Patient Information Software AI keeps the operator in control while the assistant handles the precise, repetitive interactions.</p>
        </div>
        <div className="steps">
          {steps.map((step) => (
            <article className="step" key={step.number}>
              <span className="step-number">{step.number}</span>
              <div className="step-rule" />
              <h3>{step.title}</h3>
              <p>{step.copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="safety" id="safety">
        <div className="shell safety-grid">
          <div>
            <span className="kicker light">SAFETY BY DESIGN</span>
            <h2>Automation that knows its boundaries.</h2>
            <p>Patient Information Software AI is deliberately narrow. It accepts approved demo jobs, checks each typed value, and stops when an action falls outside the policy.</p>
            <a className="button light-button" href="#demo">Review the demo <ArrowIcon /></a>
          </div>
          <div className="safety-panel">
            {[
              ["Dry run first", "Preview the assistant’s proposed action without touching the screen."],
              ["Allowlist enforcement", "Only data present in the approved job can be entered."],
              ["Operator override", "A mouse-corner failsafe and keyboard interrupt stop the run immediately."],
            ].map(([title, copy], index) => (
              <div className="safety-item" key={title}><span>0{index + 1}</span><div><h3>{title}</h3><p>{copy}</p></div></div>
            ))}
          </div>
        </div>
      </section>

      <section className="demo section shell" id="demo">
        <span className="kicker">START WITH A PREVIEW</span>
        <h2>See what the assistant would do before it does anything.</h2>
        <p>Run the included dry-run test with a clean, synthetic PIS screen.</p>
        <CopyCommand />
      </section>

      <footer className="footer shell">
        <a className="brand" href="#top"><span className="brand-mark"><span /><span /></span>patient-information-software-ai</a>
        <p>Human-approved automation for patient information workflows.</p>
        <span>© 2026 patient-information-software-ai</span>
      </footer>
    </main>
  );
}
