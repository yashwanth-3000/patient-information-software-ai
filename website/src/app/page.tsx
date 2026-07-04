import { CopyCommand } from "@/components/copy-command";

const ArrowIcon = () => (
  <svg viewBox="0 0 20 20" aria-hidden="true">
    <path d="M4 10h12M11 5l5 5-5 5" />
  </svg>
);

const patients = [
  ["1001", "TEST", "PATIENT", "29", "F", "DEMO CLINIC", "04/07/2026"],
  ["1002", "SAMPLE", "RECORD", "35", "M", "TRAINING WARD", "04/07/2026"],
  ["1003", "DEMO", "USER", "50", "F", "QA ENVIRONMENT", "04/07/2026"],
  ["1004", "CHECK", "ONLY", "19", "M", "SYNTHETIC DATA", "04/07/2026"],
  ["1005", "ALPHA", "ENTRY", "42", "F", "TEST FACILITY", "04/07/2026"],
  ["1006", "BETA", "ENTRY", "31", "M", "TEST FACILITY", "04/07/2026"],
];

const steps = [
  ["01", "Approve the job", "Choose the exact synthetic fields the assistant is allowed to enter."],
  ["02", "Preview the action", "Dry run reads the PIS window and proposes a move without touching it."],
  ["03", "Run with controls", "Every click and typed value is checked, logged, and interruptible."],
];

export default function Home() {
  return (
    <main className="desktop">
      <nav className="nav shell" aria-label="Main navigation">
        <a className="brand" href="#top" aria-label="Patient Information Software AI home">
          <span className="brand-icon" aria-hidden="true">P</span>
          <span>patient-information-software-ai</span>
        </a>
        <div className="nav-links">
          <a href="#how-it-works">Workflow</a>
          <a href="#safety">Safety</a>
          <a href="https://github.com/yashwanth-3000/patient-information-software-ai" target="_blank" rel="noreferrer">GitHub</a>
        </div>
      </nav>

      <section className="hero shell" id="top">
        <div className="hero-copy">
          <h1>Patient information,<strong>without the repetitive work.</strong></h1>
          <p>
            A careful AI operator for the patient information system you already use.
            It previews, verifies, and logs each action before the workflow moves on.
          </p>
          <div className="hero-actions">
            <a className="retro-button primary-button" href="#demo">Open demo <ArrowIcon /></a>
            <a className="retro-button" href="#safety">View safety controls</a>
          </div>
        </div>

        <div className="pis-window" aria-label="Synthetic Patient Information System preview">
          <div className="window-titlebar">
            <span className="window-app-icon">P</span>
            <span>Patient Information System</span>
            <div className="window-controls" aria-hidden="true"><i>_</i><i>□</i><i className="close">×</i></div>
          </div>
          <div className="window-tabs" role="tablist" aria-label="Patient Information System views">
            <button className="active-tab" type="button" role="tab" aria-selected="true">Search Patients</button>
            <button type="button" role="tab" aria-selected="false">Add New Patient</button>
          </div>
          <div className="window-workspace">
            <div className="search-row">
              <label htmlFor="patient-search">Patient :</label>
              <input id="patient-search" aria-label="Patient search" readOnly />
              <button type="button">Search</button>
            </div>
            <div className="table-viewport">
              <table>
                <thead><tr>{["RegNo", "FirstName", "LastName", "Age", "Gender", "Address", "FirstVisit"].map((heading) => <th key={heading}>{heading}</th>)}</tr></thead>
                <tbody>
                  {patients.map((patient, index) => (
                    <tr className={index === 0 ? "selected-row" : undefined} key={patient[0]}>
                      {patient.map((value, cell) => <td key={`${patient[0]}-${cell}`}>{value}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="window-actions">
              <div><button type="button" disabled>Delete</button><button type="button">Edit</button></div>
              <div><button type="button">Prescription</button><button type="button">Clear</button></div>
            </div>
          </div>
          <div className="window-statusbar">
            <span><i className="status-light" /> Connected</span>
            <span>Demo data only</span>
            <span>Operator approval required</span>
          </div>
        </div>
      </section>

      <section className="system-strip">
        <div className="shell strip-inner">
          <span className="strip-title">GUARDRAILS</span>
          {['Approved fields only', 'Synthetic records', 'Delete blocked', 'Actions logged'].map((item) => <span key={item}><i>✓</i>{item}</span>)}
        </div>
      </section>

      <section className="section shell" id="how-it-works">
        <div className="section-window">
          <div className="panel-title"><span>Workflow Manager</span><small>3 steps</small></div>
          <div className="section-intro">
            <div><span className="system-label">HOW IT WORKS</span><h2>A familiar workflow with a careful operator.</h2></div>
            <p>The interface stays recognizable. The assistant handles precise repetition while the human operator keeps authority.</p>
          </div>
          <div className="steps">
            {steps.map(([number, title, copy]) => (
              <article className="step" key={number}>
                <div className="step-header"><span>{number}</span><b>READY</b></div>
                <h3>{title}</h3><p>{copy}</p>
                <div className="progress-track"><i /></div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="safety shell" id="safety">
        <div className="safety-copy">
          <span className="system-label">SECURITY SETTINGS</span>
          <h2>Automation with hard boundaries.</h2>
          <p>The assistant is deliberately narrow. It can only use approved demo data, cannot delete records, and stops when an action falls outside policy.</p>
          <a className="retro-button primary-button" href="#demo">Review demo command</a>
        </div>
        <fieldset className="security-panel">
          <legend>Protection status</legend>
          {[
            ["Dry run first", "Preview actions without clicking or typing."],
            ["Allowlist enforcement", "Reject any value absent from the approved job."],
            ["Operator override", "Stop immediately with the failsafe or keyboard interrupt."],
          ].map(([title, copy]) => (
            <label key={title}><input type="checkbox" checked readOnly /><span><b>{title}</b><small>{copy}</small></span></label>
          ))}
          <div className="security-footer"><span className="status-light" /> All protections active</div>
        </fieldset>
      </section>

      <section className="demo shell" id="demo">
        <div className="dialog-titlebar">Command Prompt <span>_ □ ×</span></div>
        <div className="demo-content">
          <span className="system-label">DRY RUN</span>
          <h2>Preview before the first click.</h2>
          <p>Run the included test with a clean PIS screenshot containing synthetic data only.</p>
          <CopyCommand />
        </div>
      </section>

      <footer className="footer">
        <div className="shell footer-inner">
          <a className="start-button" href="#top"><span>●</span> patient-information-software-ai</a>
          <span>Human-approved automation</span>
          <time>© 2026</time>
        </div>
      </footer>
    </main>
  );
}
