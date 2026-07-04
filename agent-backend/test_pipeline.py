"""Smoke test: run the crew over a simulated OCR result (no OpenAI needed).

Exercises the Vultr LLM adapter, the live PIS lookup relay, VultronRetriever
rerank grounding, and the composer output.
"""

import json

from dotenv import load_dotenv

load_dotenv()

import crew_runner

FAKE_OCR = {
    "patient_id": {"value": "27536", "confidence": 0.8, "alternates": ["27586"]},
    "patient_name": {"value": "APPDEMOONE PATIENT", "confidence": 0.9, "alternates": []},
    "medicines": [
        {"raw_text": "Ars Alb 30", "dosage": "3-3-3 x 1 week", "confidence": 0.85},
        {"raw_text": "Nux Vom 200", "dosage": "BD x 3 days", "confidence": 0.8},
    ],
    "amount": {"value": 150, "confidence": 0.9},
    "date": {"value": "2026-07-04", "confidence": 0.9},
    "other_text": "",
    "legibility_notes": "patient id last digit could be 3 or 8",
}


def emit(agent, status, message, payload):
    print(f"[{agent}] {status}: {message}")


if __name__ == "__main__":
    form = crew_runner.run_script_pipeline(FAKE_OCR, emit)
    print("\n=== FINAL FORM ===")
    print(json.dumps({k: v for k, v in form.items() if k != "evidence"}, indent=2))
