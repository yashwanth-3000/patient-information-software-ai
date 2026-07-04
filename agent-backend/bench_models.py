"""Quick latency/quality benchmark of Vultr models on an agent-sized prompt."""

import json
import os
import time

import requests
from dotenv import load_dotenv

load_dotenv()

KEY = os.environ["VULTR_INFERENCE_API_KEY"]
URL = "https://api.vultrinference.com/v1/chat/completions"

PROMPT = """You are the Script Intake Agent in a homeopathy clinic automation crew.
Normalize the OCR result below. Respond with STRICT JSON only (no markdown fences):
{"patient_id_candidates": [..strings..], "patient_name": str, "medicines": [{"raw_text": str, "dosage": str}], "amount": number, "date": "YYYY-MM-DD", "notes": str}

OCR result:
{"patient_id": {"value": "27536", "confidence": 0.8, "alternates": ["27586"]},
 "patient_name": {"value": "APPDEMOONE PATIENT", "confidence": 0.9},
 "medicines": [{"raw_text": "Ars Alb 30", "dosage": "3-3-3 x 1 week", "confidence": 0.85},
               {"raw_text": "Nux Vom 200", "dosage": "BD x 3 days", "confidence": 0.8}],
 "amount": {"value": 150, "confidence": 0.9},
 "date": {"value": "2026-07-04", "confidence": 0.9},
 "legibility_notes": "patient id last digit could be 3 or 8"}
"""

MODELS = [
    "zai-org/GLM-5.2-FP8",
    "deepseek-ai/DeepSeek-V4-Flash",
    "moonshotai/Kimi-K2.6",
]

for model in MODELS:
    start = time.time()
    try:
        r = requests.post(
            URL,
            timeout=150,
            headers={"Authorization": f"Bearer {KEY}"},
            json={
                "model": model,
                "messages": [{"role": "user", "content": PROMPT}],
                "max_tokens": 2500,
                "temperature": 0.2,
            },
        )
        elapsed = time.time() - start
        body = r.json()
        msg = body["choices"][0]["message"]
        content = (msg.get("content") or "").strip()
        ok = False
        try:
            cleaned = content
            if cleaned.startswith("```"):
                cleaned = cleaned.split("```")[1].lstrip("json").strip()
            parsed = json.loads(cleaned)
            ok = "patient_id_candidates" in parsed
        except Exception:
            pass
        print(f"{model}: {elapsed:.1f}s, tokens={body['usage']['completion_tokens']}, "
              f"json_ok={ok}, head={content[:80]!r}")
    except Exception as exc:
        print(f"{model}: FAILED after {time.time()-start:.1f}s -> {exc}")
