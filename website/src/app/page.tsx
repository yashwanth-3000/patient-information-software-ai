import Link from "next/link";

const ArrowIcon = () => (
  <svg viewBox="0 0 20 20" aria-hidden="true">
    <path d="M4 10h12M11 5l5 5-5 5" />
  </svg>
);

const patients = [
  ["1001", "APPDEMOONE", "PATIENT", "31", "M", "VULTR DEMO 1", "04/07/2026"],
  ["1002", "APPDEMOTWO", "PATIENT", "42", "F", "VULTR DEMO 2", "04/07/2026"],
  ["1003", "DEMO", "USER", "50", "F", "QA ENVIRONMENT", "04/07/2026"],
  ["1004", "CHECK", "ONLY", "19", "M", "SYNTHETIC DATA", "04/07/2026"],
  ["1005", "ALPHA", "ENTRY", "42", "F", "TEST FACILITY", "04/07/2026"],
  ["1006", "BETA", "ENTRY", "31", "M", "TEST FACILITY", "04/07/2026"],
];

const steps = [
  ["01", "Perception", "Vision OCR reads the doctor's handwriting, with alternates for every ambiguous digit - because his 2s look like 9s."],
  ["02", "Live retrieval", "The records agent queries the clinic's live patient database in real time, retrying variants until the identity checks out."],
  ["03", "Grounded decisions", "Every medicine is cited against a homeopathy remedy corpus via VultronRetriever rerank - no citation, no entry."],
  ["04", "Human-approved outcome", "An assistant swipes to approve, and one click inside PIS files the whole batch into the patient records."],
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
          <Link href="/upload">Upload</Link>
          <a href="https://github.com/yashwanth-3000/patient-information-software-ai" target="_blank" rel="noreferrer">GitHub</a>
          <Link className="nav-em" href="/about">About ▸</Link>
        </div>
      </nav>

      <section className="hero shell" id="top">
        <div className="hero-copy">
          <h1>An agent crew for<strong>my dad&apos;s real clinic.</strong></h1>
          <p>
            My dad is a doctor. His handwritten prescriptions used to wait weeks to be
            typed into his 20-year-old patient software. Now five agents plan, retrieve,
            call tools, and decide - every LLM workload on Vultr Serverless Inference.
          </p>
          <div className="hero-actions">
            <Link className="retro-button primary-button" href="/upload">Run the pipeline <ArrowIcon /></Link>
            <Link className="retro-button" href="/about">How it works</Link>
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
            <button type="button" role="tab" aria-selected="false">Get New Data from App</button>
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
            <span><i className="status-light" /> Vultr connected</span>
            <span>Demo data only</span>
            <span>Approved jobs only</span>
          </div>
        </div>
      </section>

      <section className="system-strip">
        <div className="shell strip-inner">
          <span className="strip-title">GUARDRAILS</span>
          {['Approved cloud jobs', 'Automatic backup', 'Transaction protected', 'Duplicate safe'].map((item) => <span key={item}><i>✓</i>{item}</span>)}
        </div>
      </section>

      <section className="section shell" id="how-it-works">
        <div className="section-window">
          <div className="panel-title"><span>Workflow Manager</span><small>4 steps</small></div>
          <div className="section-intro">
            <div><span className="system-label">HOW IT WORKS</span><h2>A multi-step workflow, not a single call.</h2></div>
            <p>Every script runs through the full crew - perception, live retrieval, document grounding, and a final decision - through an API bridge we patched into the clinic&apos;s real 20-year-old PIS.</p>
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
          <h2>Evidence in, entries out.</h2>
          <p>No value is ever invented - every field traces to OCR evidence, a live database record, or a corpus citation, and a human signs off before anything touches twenty years of patient history.</p>
          <Link className="retro-button primary-button" href="/upload">Try it on a script</Link>
        </div>
        <fieldset className="security-panel">
          <legend>Protection status</legend>
          {[
            ["Backup before import", "Create a timestamped copy of Homeopathy.mdb."],
            ["Approved demo allowlist", "Reject non-APPDEMO patients and non-DEMO prescriptions."],
            ["Idempotent jobs", "Remember imported job IDs to prevent duplicates."],
          ].map(([title, copy]) => (
            <label key={title}><input type="checkbox" checked readOnly /><span><b>{title}</b><small>{copy}</small></span></label>
          ))}
          <div className="security-footer"><span className="status-light" /> All protections active</div>
        </fieldset>
      </section>

      <footer className="footer">
        <div className="shell footer-inner">
          <a className="start-button" href="#top"><span>●</span> patient-information-software-ai</a>
          <span>Human-approved cloud import</span>
          <time>© 2026</time>
        </div>
      </footer>
    </main>
  );
}
