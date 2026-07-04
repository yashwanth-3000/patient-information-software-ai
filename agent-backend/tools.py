"""Tools used by the ClinicClick script-processing crew.

- OCR: OpenAI vision reads the handwritten doctor script.
- PIS lookup: real-time patient fetch from the legacy Windows PIS through the
  Vultr relay (the PIS answers from its live Access database).
- Remedy grounding: VultronRetriever rerank on Vultr Serverless Inference
  scores each extracted medicine against the homeopathy remedy corpus.
"""

from __future__ import annotations

import base64
import json
import os
from pathlib import Path
from typing import Any, Dict, List

import requests

PIS_API_URL = os.environ.get("PIS_API_URL", "http://65.20.78.208").rstrip("/")
VULTR_RERANK_URL = "https://api.vultrinference.com/v1/rerank"
RERANK_MODEL = os.environ.get(
    "VULTR_RERANK_MODEL", "vultr/VultronRetrieverPrime-Qwen3.5-8B"
)
OCR_MODEL = os.environ.get("OPENAI_OCR_MODEL", "gpt-4o")

_REMEDIES: List[Dict[str, Any]] = json.loads(
    (Path(__file__).parent / "data" / "remedies.json").read_text()
)


def remedy_documents() -> List[str]:
    documents = []
    for remedy in _REMEDIES:
        documents.append(
            "{name} | abbreviations: {abbr} | potencies: {potencies} | forms: {forms} | {notes}".format(
                name=remedy["name"],
                abbr=", ".join(remedy["abbreviations"]),
                potencies=", ".join(remedy["common_potencies"]),
                forms=", ".join(remedy["forms"]),
                notes=remedy["notes"],
            )
        )
    return documents


OCR_PROMPT = """You are reading a photographed handwritten homeopathy doctor's script from an Indian clinic.

The script normally contains:
- A patient registration number (RegNo / ID number, usually 1-6 digits)
- The patient's name
- One or more homeopathic medicines, often abbreviated (e.g. "Ars Alb 30", "Nux Vom 200", "Rhus Tox 1M", "SBL drops"), sometimes with dosage instructions (e.g. "3-3-3", "BD", "TDS", "1 week")
- An amount of money to be paid (in rupees, e.g. "150/-", "Rs 200")
- Possibly a date

Extract everything you can read. For every field give your best reading AND alternates when handwriting is ambiguous (e.g. a digit that could be 3 or 5).

Return STRICT JSON only, no markdown fences:
{
  "patient_id": {"value": "27531", "confidence": 0.0-1.0, "alternates": ["27581"]},
  "patient_name": {"value": "...", "confidence": 0.0-1.0, "alternates": []},
  "medicines": [
    {"raw_text": "Ars Alb 30", "dosage": "3-3-3 x 1 week", "confidence": 0.0-1.0}
  ],
  "amount": {"value": 150, "confidence": 0.0-1.0},
  "date": {"value": "2026-07-04 or null", "confidence": 0.0-1.0},
  "other_text": "anything else legible",
  "legibility_notes": "short note on what was hard to read"
}"""


def run_ocr(image_bytes: bytes, mime_type: str) -> Dict[str, Any]:
    """Read the script image with OpenAI vision and return structured JSON."""
    from openai import OpenAI

    client = OpenAI()
    encoded = base64.b64encode(image_bytes).decode("ascii")
    response = client.chat.completions.create(
        model=OCR_MODEL,
        max_tokens=1500,
        response_format={"type": "json_object"},
        messages=[
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": OCR_PROMPT},
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:{mime_type};base64,{encoded}"},
                    },
                ],
            }
        ],
    )
    return json.loads(response.choices[0].message.content)


def lookup_patient(regno: str) -> Dict[str, Any]:
    """Fetch a patient from the live legacy PIS through the Vultr relay."""
    regno = "".join(ch for ch in str(regno) if ch.isdigit())
    if not regno:
        return {"found": False, "error": "invalid regno"}
    try:
        response = requests.get(f"{PIS_API_URL}/api/patients/{regno}", timeout=30)
    except requests.RequestException as error:
        return {"found": False, "error": str(error)}
    if response.status_code == 504:
        return {"found": False, "error": "PIS is not running in the clinic"}
    try:
        return response.json()
    except ValueError:
        return {"found": False, "error": f"invalid response {response.status_code}"}


def match_remedy(query: str, top_n: int = 3) -> List[Dict[str, Any]]:
    """Ground a handwritten medicine line against the remedy corpus using
    VultronRetriever rerank on Vultr Serverless Inference."""
    api_key = os.environ.get("VULTR_INFERENCE_API_KEY", "")
    documents = remedy_documents()
    response = requests.post(
        VULTR_RERANK_URL,
        timeout=30,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json={"model": RERANK_MODEL, "query": query, "documents": documents},
    )
    if response.status_code != 200:
        raise RuntimeError(f"Rerank failed: {response.status_code} {response.text[:300]}")
    results = response.json().get("results", [])
    ranked = sorted(results, key=lambda item: item["relevance_score"], reverse=True)
    matches = []
    for item in ranked[:top_n]:
        remedy = _REMEDIES[item["index"]]
        matches.append(
            {
                "name": remedy["name"],
                "abbreviations": remedy["abbreviations"],
                "common_potencies": remedy["common_potencies"],
                "forms": remedy["forms"],
                "score": round(float(item["relevance_score"]), 3),
                "reference": remedy["notes"],
            }
        )
    return matches


def submit_to_pis_queue(job: Dict[str, Any]) -> Dict[str, Any]:
    """Queue a confirmed entry so the clinic PIS imports it on next sync."""
    response = requests.post(
        f"{PIS_API_URL}/api/pis/submit", json=job, timeout=30
    )
    body: Dict[str, Any]
    try:
        body = response.json()
    except ValueError:
        body = {"raw": response.text[:300]}
    body["status_code"] = response.status_code
    return body
