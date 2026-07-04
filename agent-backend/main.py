"""ClinicClick agent backend.

FastAPI service that accepts photographed doctor scripts, runs the CrewAI
processing crew (OCR -> intake -> live PIS verification -> remedy grounding ->
entry composition), streams every agent step over SSE, and submits confirmed
entries to the clinic queue on the Vultr API.
"""

from __future__ import annotations

import asyncio
import json
import threading
import time
import uuid
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

import crew_runner
import tools

app = FastAPI(title="ClinicClick Agent Backend")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

JOBS: Dict[str, Dict[str, Any]] = {}
SUBSCRIBERS: Dict[str, List[asyncio.Queue]] = {}
JOBS_LOCK = threading.Lock()
MAIN_LOOP: Optional[asyncio.AbstractEventLoop] = None


@app.on_event("startup")
async def capture_loop() -> None:
    global MAIN_LOOP
    MAIN_LOOP = asyncio.get_running_loop()


def publish(job_id: str, event: Dict[str, Any]) -> None:
    """Append an event to the job log and fan out to live SSE subscribers."""
    event = {**event, "ts": int(time.time() * 1000)}
    with JOBS_LOCK:
        job = JOBS.get(job_id)
        if job is None:
            return
        job["events"].append(event)
        queues = list(SUBSCRIBERS.get(job_id, []))
    if MAIN_LOOP is not None:
        for queue in queues:
            MAIN_LOOP.call_soon_threadsafe(queue.put_nowait, event)


def emit_activity(job_id: str, agent: str, status: str, message: str,
                  payload: Dict[str, Any]) -> None:
    meta = crew_runner.AGENTS.get(agent, {"label": agent, "tool": agent})
    publish(job_id, {
        "type": "agent_activity",
        "agent": agent,
        "agentLabel": meta["label"],
        "tool": meta["tool"],
        "status": status,
        "message": message,
        "payload": payload,
    })


def process_script(job_id: str, image_bytes: bytes, mime_type: str) -> None:
    """Worker thread: OCR then the CrewAI pipeline."""
    try:
        emit_activity(job_id, "ocr_reader", "started",
                      "Reading the handwritten script with OpenAI vision...", {})
        ocr_result = tools.run_ocr(image_bytes, mime_type)
        emit_activity(job_id, "ocr_reader", "completed",
                      "Script text extracted from the photo.",
                      {"output": ocr_result})

        form = crew_runner.run_script_pipeline(
            ocr_result,
            lambda agent, status, message, payload: emit_activity(
                job_id, agent, status, message, payload),
        )

        with JOBS_LOCK:
            JOBS[job_id]["status"] = "awaiting_review"
            JOBS[job_id]["form"] = form
        publish(job_id, {"type": "result", "form": form})
    except Exception as error:  # surface everything to the UI
        with JOBS_LOCK:
            if job_id in JOBS:
                JOBS[job_id]["status"] = "failed"
                JOBS[job_id]["error"] = str(error)
        publish(job_id, {"type": "error", "message": str(error)})


@app.get("/health")
async def health() -> Dict[str, Any]:
    return {"ok": True, "service": "clinicclick-agent-backend"}


@app.post("/api/scripts")
async def upload_script(file: UploadFile = File(...)) -> Dict[str, Any]:
    if not (file.content_type or "").startswith("image/"):
        raise HTTPException(status_code=400, detail="Upload an image of the script")
    image_bytes = await file.read()
    if len(image_bytes) > 15 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Image is too large")

    job_id = uuid.uuid4().hex[:12]
    with JOBS_LOCK:
        JOBS[job_id] = {
            "id": job_id,
            "status": "processing",
            "created_at": int(time.time() * 1000),
            "file_name": file.filename,
            "events": [],
            "form": None,
        }
    worker = threading.Thread(
        target=process_script,
        args=(job_id, image_bytes, file.content_type or "image/jpeg"),
        daemon=True,
    )
    worker.start()
    return {"job_id": job_id}


@app.get("/api/jobs")
async def list_jobs() -> Dict[str, Any]:
    with JOBS_LOCK:
        jobs = [
            {
                "id": job["id"],
                "status": job["status"],
                "created_at": job["created_at"],
                "file_name": job.get("file_name"),
                "summary": (job.get("form") or {}).get("summary"),
                "ready_for_entry": (job.get("form") or {}).get("ready_for_entry"),
            }
            for job in sorted(JOBS.values(), key=lambda item: item["created_at"], reverse=True)
        ]
    return {"jobs": jobs}


@app.get("/api/jobs/{job_id}")
async def get_job(job_id: str) -> Dict[str, Any]:
    with JOBS_LOCK:
        job = JOBS.get(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="Job not found")
        return {key: value for key, value in job.items() if key != "events"}


@app.get("/api/jobs/{job_id}/stream")
async def stream_job(job_id: str) -> StreamingResponse:
    with JOBS_LOCK:
        job = JOBS.get(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="Job not found")
        history = list(job["events"])
        queue: asyncio.Queue = asyncio.Queue()
        SUBSCRIBERS.setdefault(job_id, []).append(queue)

    async def generator():
        try:
            yield ": connected\n\n"
            for event in history:
                yield f"data: {json.dumps(event)}\n\n"
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=15)
                    yield f"data: {json.dumps(event)}\n\n"
                    if event.get("type") in {"result", "error"}:
                        # keep the stream open briefly for trailing consumers
                        continue
                except asyncio.TimeoutError:
                    yield ": ping\n\n"
                    with JOBS_LOCK:
                        status = JOBS.get(job_id, {}).get("status")
                    if status in {"awaiting_review", "submitted", "failed"}:
                        break
        finally:
            with JOBS_LOCK:
                if queue in SUBSCRIBERS.get(job_id, []):
                    SUBSCRIBERS[job_id].remove(queue)

    return StreamingResponse(generator(), media_type="text/event-stream", headers={
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
    })


@app.post("/api/jobs/{job_id}/submit")
async def submit_job(job_id: str, body: Dict[str, Any]) -> Dict[str, Any]:
    """Send the reviewed (possibly edited) form to the clinic PIS queue."""
    with JOBS_LOCK:
        job = JOBS.get(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="Job not found")
        form = body.get("form") or job.get("form")
        if not form:
            raise HTTPException(status_code=400, detail="No form to submit")

    prescriptions = [
        {
            "text": str(item.get("text", "")).strip(),
            "date": form.get("date") or time.strftime("%Y-%m-%d"),
        }
        for item in form.get("prescriptions", [])
        if str(item.get("text", "")).strip()
    ]
    submission = {
        "type": "prescription",
        "source": "clinicclick-agent",
        "job_id": job_id,
        "regno": form.get("regno"),
        "patient_name": form.get("patient_name"),
        "prescriptions": prescriptions,
        "amount": form.get("amount"),
    }
    result = tools.submit_to_pis_queue(submission)
    ok = result.get("status_code") == 200 and result.get("ok")
    with JOBS_LOCK:
        JOBS[job_id]["status"] = "submitted" if ok else "awaiting_review"
        JOBS[job_id]["form"] = form
        JOBS[job_id]["submission_result"] = result
    publish(job_id, {
        "type": "agent_activity",
        "agent": "entry_composer",
        "agentLabel": "Entry Composer Agent",
        "tool": "pis.submit",
        "status": "completed" if ok else "failed",
        "message": "Entry queued for the clinic PIS." if ok
                   else f"PIS queue rejected the entry: {result}",
        "payload": {"submission": submission, "result": result},
    })
    if not ok:
        raise HTTPException(status_code=502, detail=result)
    return {"ok": True, "queued": result}
