# patient-information-software-ai

**An enterprise agent crew that reads a doctor's handwritten prescriptions and files them into his real 20-year-old clinic software - built for the Vultr Enterprise Agent track at RAISE Summit Hackathon 2026.**

- **Live app:** <https://pis-ai.vercel.app>
- **Track:** Vultr - Enterprise Agent for a real-world workflow, grounded in documents
- **Every LLM workload runs on Vultr Serverless Inference** (agent reasoning + VultronRetriever grounding), and the entire backend is hosted on **Vultr Compute**.

---

## The story

My dad is a homeopathy doctor. He has two assistants: one packs medicines, and the other spends her **entire working day manually typing his handwritten prescriptions** into the clinic's Patient Information System (PIS) - a Windows desktop app the clinic has trusted for **20 years**. As patients keep coming, scripts pile up into a backlog that takes days, sometimes weeks, to clear. Her whole potential is spent on data entry.

The clinic would never accept a replacement app - two decades of patient records live inside that software, and the staff know it by heart. So instead of building something new, **we gave the old software new powers**: a small API bridge patched directly into the legacy executable, and a crew of five AI agents that do the reading, verifying, and composing.

Now the workflow is: **take a photo → agents process it → a human approves with a swipe → one click inside the same old PIS files everything into the patient records.** Days of backlog become minutes.

## Why this is an *agent*, not a single LLM call

The Vultr track asks for a multi-step workflow where the system **plans, retrieves more than once, calls tools, makes decisions, and produces an outcome a real enterprise team could use**. That is exactly what happens for every single script:

| # | Agent | What it does | Model (all via Vultr Serverless Inference unless noted) |
|---|-------|--------------|-------|
| 1 | **Script OCR Reader** | Reads the handwritten script and proposes **alternates for every ambiguous digit** (this doctor's 2s look like 9s, his trailing 7s look like Fs) | GPT-4o Vision (perception input) |
| 2 | **Script Intake Agent** | Normalizes the raw reading into structured fields: RegNo candidates, name, medicine lines, duration, complaints | DeepSeek-V4-Flash |
| 3 | **Patient Records Agent** | **Retrieves repeatedly**: queries the clinic's live patient database through the PIS API bridge, and if the name doesn't fit, probes digit-confusion variants of the RegNo until the identity actually checks out | DeepSeek-V4-Flash + live PIS lookup tool |
| 4 | **Homeopathy Pharmacist** | **Grounds every medicine line** against a homeopathy remedy corpus using **VultronRetriever rerank** - shorthand like "CF 30 HS" becomes "Calcarea Fluorica 30C - at bedtime", with a citation | vultr/VultronRetrieverPrime-Qwen3.5-8B |
| 5 | **Entry Composer Agent** | Composes the final PIS entry and **decides**: ready for entry, or flagged for human review with explicit reasons | DeepSeek-V4-Flash |

**The grounding rule is absolute: no value is ever invented.** Every field in the final entry traces to OCR evidence, a live database record, or a corpus citation. If a medicine can't be cited, it stays as raw text and the entry is flagged for review.

## How Vultr is used

1. **Agent reasoning** - all four reasoning agents run on **Vultr Serverless Inference** (`deepseek-ai/DeepSeek-V4-Flash`), with retry/backoff handling built in.
2. **Document grounding** - the pharmacist agent calls the **VultronRetriever rerank API** (`vultr/VultronRetrieverPrime-Qwen3.5-8B`) on Vultr Serverless Inference to match every handwritten medicine line against the remedy corpus.
3. **Infrastructure** - the FastAPI agent backend, the PIS relay/queue API, and the live patient-lookup bridge all run as systemd services on a **Vultr Compute instance** (Mumbai). Plain HTTP is used deliberately: the clinic's Windows 7-era .NET stack cannot negotiate TLS 1.2, and the Vercel frontend bridges HTTPS→HTTP through a server-side proxy.

## End-to-end architecture

```text
 Phone camera photo of a handwritten script
        │  (browser downscales/re-encodes to JPEG)
        ▼
 Next.js web app (Vercel) ── /upload/[session]
        │  server-side proxy (HTTPS → HTTP)
        ▼
 FastAPI agent backend ─────────────── Vultr Compute
        │  CrewAI pipeline, SSE progress stream
        ├── GPT-4o Vision ............ perception (OCR + digit alternates)
        ├── DeepSeek-V4-Flash ........ reasoning  (Vultr Serverless Inference)
        ├── VultronRetriever rerank .. grounding  (Vultr Serverless Inference)
        │
        ├── live patient lookup ──► relay API ──► patched Windows PIS
        │                          (Vultr Compute)  answers from the live
        │                                           Access database in real time
        ▼
 /review/[session] - swipe right to approve, left to reject, tap to edit
        │  approved entries
        ▼
 Clinic queue (Vultr Compute) ──► "Get New Data" button inside the PIS
        │  one Access transaction per entry
        ▼
 Homeopathy.mdb - the same database the clinic has used for 20 years
```

### The legacy PIS bridge

The original PIS source code is long gone. `pis-plugin/PatchPis.cs` uses **Mono.Cecil to patch the compiled .NET 2.0 executable**, injecting a call that installs our plugin when the legacy form loads. The plugin adds:

- a **"Get New Data from App"** tab that downloads approved entries, shows them for review, and imports each one in an atomic Access transaction (with automatic database backup and idempotent job tracking), and
- a **live lookup responder**: the web agents ask "who is RegNo 11192?", the relay holds the query, the PIS answers from its local Access database within seconds - real-time retrieval from a 20-year-old desktop app.

## Tested on real prescriptions

The `original` scripts in the demo picker are **my dad's actual handwritten prescriptions**, photographed at the clinic. Every one of them runs the full pipeline against his **live patient database**: identity verified by RegNo + fuzzy Telugu name matching, digit-confusion rescue when the handwriting tricks the OCR (2↔9, 7↔F), and remedy grounding for clinic shorthand like `SL`, `MPCF 6X`, `Ruta Hyp 30`, and `Sars Q`.

Try it yourself on the live site: open **Upload → "I want to test it"**, pick any script, and watch each agent's decisions stream in real time.

## Repository layout

| Path | What it is |
|------|-----------|
| `agent-backend/` | Python FastAPI + CrewAI agent pipeline. `crew_runner.py` is the five-agent workflow, `tools.py` holds the OCR prompt, PIS lookup and VultronRetriever grounding tools, `vultr_llm.py` is the Vultr Serverless Inference adapter, `data/remedies.json` is the homeopathy remedy corpus. |
| `website/` | Next.js app (Vercel): retro Win7-styled UI, upload sessions, live agent activity stream, Tinder-style review deck, and the HTTPS→HTTP proxy route. |
| `vultr-api/` | Dependency-free Node.js relay on Vultr Compute: clinic import queue + real-time patient lookup relay between the web agents and the Windows PIS. |
| `pis-plugin/` | C# plugin + Mono.Cecil patcher that gives the legacy PIS its API bridge and import tab. |

## Running it

**Agent backend** (needs `OPENAI_API_KEY`, `VULTR_INFERENCE_API_KEY`):

```bash
cd agent-backend
python -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn main:app --port 8000
```

**Website:**

```bash
cd website
npm install && npm run build && npm start
```

**Patched PIS** (needs Mono for the build; runs on the clinic's Windows machine):

```bash
./pis-plugin/build.sh /path/to/PIS-x86.exe
# copy pis-plugin/bin/* beside Homeopathy.mdb and launch PIS-ClinicClick.exe
```

**End-to-end test on a real script:**

```bash
cd agent-backend
.venv/bin/python test_ocr_e2e.py path/to/script-photo.jpg
```

## Safety boundaries

- **A human approves every entry** - nothing touches the patient database without a swipe-approval in review and a click inside the PIS itself.
- **Evidence-only composition** - agents must copy values from OCR evidence, live lookups, or corpus citations; missing values stay null and flag the entry for review.
- **Atomic imports** - each entry is one Access transaction; the first import of a session creates a timestamped database backup; a local import table makes jobs idempotent, so clicking twice never duplicates.
- **Parameterized SQL** throughout the PIS plugin (OLE DB parameters).
- The demo queue serves only entries approved in the review UI; no real patient data should be placed on the unencrypted demo relay.

---

Built solo during RAISE Summit Hackathon 2026 (July 4-5) for the Vultr Enterprise Agent track - for my dad's clinic, and for every clinic still running the software it trusts.
