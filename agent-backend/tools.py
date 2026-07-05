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


OCR_PROMPT = """You are reading a photographed handwritten homeopathy doctor's script from an Indian clinic. The doctor writes fast, abbreviated shorthand in blue or red pen on small chits. Read it like the clinic's own compounder would.

LAYOUT (almost always the same):
- Top, underlined: the patient registration number (RegNo, 3-6 digits). Sometimes the name is above the number.
- Below (or above), underlined: the patient's name (often a single Telugu first name like Sunitha, Bharathi, Shilaja, sometimes with an initial like "Rama Rao. T").
- Middle: medicine lines, sometimes split into circled sections (1), (2) meaning packet/bottle 1, packet/bottle 2. Keep the section number with its medicines.
- Bottom: a duration for the course ("one month", "15 days") and the amount to pay, a plain underlined/circled number like 300, 650, 280 (sometimes "Rs = 280"). The amount is money, NOT a medicine.

STRUCK-THROUGH TEXT: anything crossed out with a line THROUGH the letters or scribbled over was CANCELLED by the doctor. Do not include it in medicines; mention it in cancelled_text only. A line UNDER the text is an underline (emphasis), NOT a cancellation - underlined medicines are valid. A curly brace or "(Mix)" next to two lines means those remedies are mixed together - both are valid medicines. IMPORTANT: when only the FIRST word of a line is struck through and different writing continues right after it on the same line, the doctor corrected himself mid-line - the continuation IS a valid medicine (e.g. a crossed-out "Aes" followed by "CF 30 HS" means the medicine is CF 30 HS). Only drop the crossed-out part, never the replacement.

SHORTHAND DICTIONARY (this clinic's habits):
- "SL" (often looks like "8L", "S.L.", or a fancy S) = Sac Lac placebo pills. Extremely common, appears in most scripts.
- Biochemic salts written as letters + X potency: "CF 6X" = Calc Fluor, "KP 6X" = Kali Phos, "MP 6X" = Mag Phos, "CP" = Calc Phos, "NP" = Nat Phos. "comp"/"compo" after one means compound tablets. "(TB)" or "TAB" = tablets.
- "B-" plus a number ("B-16", "B-28") = Bio-Combination tablet number.
- Proprietary items: "Y-lax" (laxative tablets, may look like "ylox"/"Yhox"), "Thyr 3X"/"Thy 3X" (Thyroidinum), "Phyto Berry"/"Phytolacca Berry" (weight tablets), "Allerex 2-2" (anti-allergy tablets, may look like "Allope"/"Allere").
- Combined shorthand: "MPCF 6X" is ONE token meaning Mag Phos + Calc Fluor compound tablets; "Ruta Hyp 30" pairs Ruta with Hypericum. Keep such combos as written and expand both names.
- Remedy + potency: "Ruta 30", "Bry 30", "Rat 200", "Caust 30", "Aesc 30", "Coloc 200"/"CC 200" (Colocynth), "Bell 30", "Bellis Per 30" (Bellis Perennis, NOT Belladonna), "Sars Q"/"Sarsaparilla Q" (renal stone cases, cursive can look like "Scorasapari"/"Sarcsapari"). Potencies: 6, 30, 200, 1M, 6X, 12X, 3X, Q.
- "(HS)" = at bedtime, "(TD)"/"TDS" = three times a day, "BD" = twice a day, "2-2-2" = pills morning-noon-night, "4-6" = pill counts, "1/2 oz" or dram marks = liquid quantity, "drops"/"dous" = drops, "1 fl" = one fluid (bottle).
- "c/o" = complains of (a symptom note, not a medicine). Notes like "in water", "apply" (external use), "ear sound", "acidity" are instructions/complaints - put them in dosage or other_text, not as medicines.
- A number like "15 in course" = quantity for the course.

READ CAREFULLY:
- Curly capital S at a line start is usually "SL". A line that is just squiggles repeated (like SL written twice) is two SL doses for different packets.
- Digits are sloppy: 2/3, 2/9, 4/9, 7/9, 0/6, 4/6, 3/5, 6/8, 0/8, 5/7, 1/7 confusions are common. IMPORTANT: this doctor's "2" has a long curled tail and is constantly mistaken for "9" - whenever you read a 9 in the RegNo (especially as the first digit), ALWAYS include the same number with 2 in that position as an alternate, and vice versa. His final "7" often has a hooked tail that looks like an "F", "f" or "5" - if the RegNo seems to end in a letter-like glyph or a 5, add the 7-ending as an alternate. Give alternates for every ambiguous digit in the RegNo - the RegNo is the single most important field.
- Names are Indian (Telugu/Urdu): prefer readings like Sunitha, Bharathi, Shilaja, Krishnamurthy, Rama Rao, Varalakshmi, Ramesh, Vijaya, Arhaan, Saleem Ahemad over non-Indian words. Cursive names are hard - give 1-2 alternates for the name whenever letters are ambiguous.
- Do not turn stray marks, underlines or the amount into medicines. If a line is illegible, still include it with your best guess, low confidence, and note it.

Return STRICT JSON only, no markdown fences:
{
  "patient_id": {"value": "27531", "confidence": 0.0-1.0, "alternates": ["27581"]},
  "patient_name": {"value": "...", "confidence": 0.0-1.0, "alternates": []},
  "medicines": [
    {"raw_text": "as written, e.g. CF 6X comp", "expanded": "your best expansion, e.g. Calcarea Fluorica 6X compound tablets", "section": 1, "dosage": "2-2-2 / one month / as written", "confidence": 0.0-1.0}
  ],
  "duration": {"value": "one month or null", "confidence": 0.0-1.0},
  "amount": {"value": 150, "confidence": 0.0-1.0},
  "date": {"value": "2026-07-04 or null", "confidence": 0.0-1.0},
  "complaints": ["c/o notes, symptom words like 'ear sound', 'acidity'"],
  "cancelled_text": "anything struck through",
  "other_text": "anything else legible",
  "legibility_notes": "short note on what was hard to read"
}"""


def _shrink_for_ocr(image_bytes: bytes, mime_type: str) -> tuple:
    """Downscale huge phone photos to a fast, OCR-friendly JPEG.

    A 4000px 6MB PNG becomes ~8.7MB of base64; that slows upload and adds
    nothing for handwriting recognition. ~2000px JPEG is plenty.
    """
    try:
        import io

        from PIL import Image, ImageOps

        image = Image.open(io.BytesIO(image_bytes))
        image = ImageOps.exif_transpose(image)
        image.thumbnail((2000, 2000))
        if image.mode not in ("RGB", "L"):
            image = image.convert("RGB")
        buffer = io.BytesIO()
        image.save(buffer, format="JPEG", quality=88)
        return buffer.getvalue(), "image/jpeg"
    except Exception:
        return image_bytes, mime_type


def run_ocr(image_bytes: bytes, mime_type: str) -> Dict[str, Any]:
    """Read the script image with OpenAI vision and return structured JSON."""
    from openai import OpenAI

    client = OpenAI(timeout=120.0)
    image_bytes, mime_type = _shrink_for_ocr(image_bytes, mime_type)
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
    VultronRetriever rerank on Vultr Serverless Inference.

    Vultr occasionally answers a transient 5xx; retry with backoff instead of
    failing the whole script."""
    import time

    api_key = os.environ.get("VULTR_INFERENCE_API_KEY", "")
    documents = remedy_documents()
    response = None
    last_error = ""
    for attempt in range(4):
        if attempt:
            time.sleep(2 * attempt)
        try:
            response = requests.post(
                VULTR_RERANK_URL,
                timeout=45,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={"model": RERANK_MODEL, "query": query, "documents": documents},
            )
        except requests.RequestException as error:
            last_error = str(error)
            response = None
            continue
        if response.status_code == 200:
            break
        last_error = f"{response.status_code} {response.text[:300]}"
        if response.status_code < 500 and response.status_code != 429:
            break
    if response is None or response.status_code != 200:
        raise RuntimeError(f"Rerank failed after retries: {last_error}")
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
