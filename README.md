# Patient Information Software AI

ClinicClick is a safety-first AI assistant for patient-information workflows.
This repository contains the local automation runner, Windows bridge, tests,
approved synthetic demo jobs, and the React/Next.js product website.

## Computer Use runner

This folder contains a test runner for Google Gemini Computer Use against the
Windows patient-information application.

The runner defaults to **dry run**: it sends a screenshot to Gemini and prints
the first proposed action without clicking or typing anything. In the real flow,
the web app approves a structured job first. Passing that job with
`--approved-job` makes the local runner enter and save it directly, without a
second approval prompt.

## 1. Prepare a safe test screen

Do not use the screenshot shared in chat for the API test: it displays real
patient names and phone numbers. In the Windows VM, open a clean PIS screen and
use only a synthetic record named `TEST PATIENT`.

Take a PNG screenshot of that clean screen and place it at:

```text
test-data/pis-clean.png
```

## 2. Install

On the Mac host (the easiest way to test the existing VM window):

```bash
cd /Users/yashwanthkrishna/Desktop/pis-ai
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
cp .env.example .env
```

Create a Gemini API key in Google AI Studio, then put it in `.env`. Never paste
the key into source code or commit `.env`.

## 3. Run the no-click API test

```bash
python clinicclick_runner.py --screenshot test-data/pis-clean.png
```

Expected result:

```text
DRY RUN — nothing was clicked or typed.
Proposed action: click ... — Focus the patient search box
```

## 4. Run the approved demo job with Gemini Computer Use

First grant the terminal app **Screen Recording** and **Accessibility** access in
macOS System Settings. Keep the VM window in a fixed position and determine its
content rectangle as `left,top,width,height`.

The included [demo-job.json](demo-job.json) is already marked approved and uses
only synthetic data. Example VM rectangle (replace it with the actual rectangle):

```bash
python clinicclick_runner.py \
  --live \
  --approved-job demo-job.json \
  --region 47,50,1680,1050 \
  --max-turns 80
```

Move the mouse to a screen corner at any time to trigger PyAutoGUI's emergency
stop. Use `Ctrl+C` in Terminal as a second stop mechanism.

Every click, keypress, and typed value in this mode comes from Gemini Computer
Use. The runner uses low thinking latency, asks Gemini to batch independent
sequential actions, and prefers keyboard navigation to reduce API round trips.
It will create the five synthetic patients listed in `demo-job.json`, enter only
their approved fields, save each one, verify the fifth result, and stop. It logs
each executed action to
`artifacts/actions.jsonl`. Delete/remove actions remain impossible, and the run
stops if Gemini tries to type anything absent from the approved job.

## Important limitation

Gemini Computer Use is a preview feature. Production jobs should be accepted by
the runner only after verifying a signed approval token from the web app. The
current automatic mode deliberately accepts only `demo=true` jobs whose patient
data visibly contains `TEST` or `DEMO`.
