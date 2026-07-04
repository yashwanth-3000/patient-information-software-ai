"""ClinicClick script-processing crew.

Four CrewAI agents turn a photographed handwritten doctor's script into a
verified, ready-to-import PIS entry:

  Script Intake Agent   -> normalizes the OCR reading into structured fields
  Patient Records Agent -> verifies identity against the LIVE legacy PIS,
                           requesting extra lookups for ambiguous digits
  Homeopathy Pharmacist -> grounds every medicine line in the remedy corpus
                           via VultronRetriever rerank (documents as evidence)
  Entry Composer Agent  -> final form JSON with confidences and citations

The pipeline emits voices-style agent_activity events so the UI can stream
every step in real time. All reasoning runs on Vultr Serverless Inference.
"""

from __future__ import annotations

import json
import os
import re
import time
from typing import Any, Callable, Dict, List, Optional

os.environ.setdefault("CREWAI_DISABLE_TELEMETRY", "true")
os.environ.setdefault("CREWAI_DISABLE_TRACING", "true")
os.environ.setdefault("OTEL_SDK_DISABLED", "true")

from crewai import Agent, Crew, Process, Task

import tools
from vultr_llm import VultrInferenceLLM

Emit = Callable[[str, str, str, Dict[str, Any]], None]

AGENTS = {
    "ocr_reader": {"label": "Script OCR Reader", "tool": "openai.vision_ocr"},
    "script_intake": {"label": "Script Intake Agent", "tool": "crewai.script_intake"},
    "patient_records": {"label": "Patient Records Agent", "tool": "crewai.patient_records"},
    "pharmacist": {"label": "Homeopathy Pharmacist Agent", "tool": "crewai.pharmacist"},
    "entry_composer": {"label": "Entry Composer Agent", "tool": "crewai.entry_composer"},
}


def build_llm() -> VultrInferenceLLM:
    return VultrInferenceLLM()


def run_script_pipeline(ocr_result: Dict[str, Any], emit: Emit) -> Dict[str, Any]:
    """Run the full crew over one OCR result and return the final entry form."""
    llm = build_llm()

    # ---- Stage 1: Script Intake -------------------------------------------
    emit("script_intake", "started",
         "Normalizing the OCR reading into structured script fields.", {})
    intake = run_single_task(
        llm,
        role="Script Intake Agent",
        goal="Turn raw OCR output from a handwritten homeopathy script into "
             "clean structured fields with explicit uncertainty.",
        backstory="You are the front-desk specialist of a homeopathy clinic. "
                  "You know doctors abbreviate remedies and scrawl digits. You never "
                  "invent data: anything illegible is flagged, not guessed silently.",
        description=(
            "Normalize this OCR reading of a handwritten doctor's script. "
            "List every plausible patient ID candidate (primary first, then "
            "alternates from ambiguous digits). For each medicine keep the raw "
            "text AND the OCR's expanded reading when present. If the OCR found "
            "a course duration (like 'one month' or 'for 15 days'), copy it into "
            "each medicine's dosage that has no more specific duration. Drop "
            "cancelled/struck-through text - the doctor rejected it. Do NOT turn "
            "complaints (c/o notes) or the amount into medicines. "
            "NEVER invent values that are not in the OCR: missing fields stay null "
            "or empty. Return STRICT JSON only:\n"
            '{"patient_id_candidates":["<id>", "<alternate id>"],'
            '"patient_name":"<name or null>",'
            '"medicines":[{"raw_text":"<as written>","expanded":"<OCR expansion or null>",'
            '"dosage":"<as written or empty>"}],'
            '"duration":"<course duration or null>","complaints":["..."],'
            '"amount":<number or null>,"date":"YYYY-MM-DD or null","concerns":["..."]}\n\n'
            f"OCR reading:\n{json.dumps(ocr_result, ensure_ascii=True)}"
        ),
        expected_output="Strict JSON with patient_id_candidates, patient_name, "
                        "medicines, duration, complaints, amount, date, concerns.",
    )
    intake_data = parse_json(intake) or fallback_intake(ocr_result)
    emit("script_intake", "completed",
         f"Script normalized: {len(intake_data.get('medicines', []))} medicine line(s), "
         f"{len(intake_data.get('patient_id_candidates', []))} patient ID candidate(s).",
         {"output": intake_data})

    # ---- Stage 2: Patient Records (live PIS retrievals) --------------------
    candidates = [str(c) for c in intake_data.get("patient_id_candidates", []) if str(c).strip()][:4]
    lookups: List[Dict[str, Any]] = []
    emit("patient_records", "started",
         f"Verifying patient identity against the live clinic PIS. Candidates: {', '.join(candidates) or 'none'}.",
         {"candidates": candidates})

    for index, candidate in enumerate(candidates):
        emit("patient_records", "progress",
             f"Retrieval {index + 1}: asking the legacy PIS for RegNo {candidate}...",
             {"regno": candidate})
        record = tools.lookup_patient(candidate)
        lookups.append({"regno": candidate, "result": record})
        emit("patient_records", "progress",
             f"PIS answered for RegNo {candidate}: "
             + ("record found" if record.get("found") else record.get("error", "not found")),
             {"regno": candidate, "found": bool(record.get("found"))})
        # Stop early only when the found record's name actually fits the script.
        # A found record with the WRONG name means the digits were misread, so
        # the remaining alternate candidates must still be tried.
        if record.get("found") and name_similarity(
            str(intake_data.get("patient_name", "")), patient_full_name(record)
        ) >= 0.75:
            break

    # Digit-confusion rescue: handwriting swaps like 9/2 or 8/6 mean the real
    # RegNo is often one digit away. If nothing looked up so far carries the
    # script's name, probe single-digit variants of the primary candidate.
    script_name = str(intake_data.get("patient_name") or "")

    def name_fits(entry: Dict[str, Any]) -> bool:
        result = entry.get("result", {})
        if not result.get("found"):
            return False
        if not script_name.strip():
            return True
        return name_similarity(script_name, patient_full_name(result)) >= 0.75

    if candidates and not any(name_fits(entry) for entry in lookups):
        tried = {entry["regno"] for entry in lookups}
        variants = digit_confusion_variants(candidates[0], exclude=tried)
        if variants:
            emit("patient_records", "progress",
                 f"No name-consistent record yet. Probing digit-confusion variants: {', '.join(variants)}.",
                 {"variants": variants})
        for variant in variants:
            record = tools.lookup_patient(variant)
            lookups.append({"regno": variant, "result": record})
            if record.get("found"):
                emit("patient_records", "progress",
                     f"Variant RegNo {variant} found: {patient_full_name(record)}.",
                     {"regno": variant})
                if name_fits(lookups[-1]):
                    break

    records_decision_raw = run_single_task(
        llm,
        role="Patient Records Agent",
        goal="Decide which live PIS record, if any, matches the patient on the script.",
        backstory="You are the clinic's records verifier with direct read access to the "
                  "legacy Patient Information System. You compare names carefully, "
                  "tolerating spelling drift but never confirming a weak match.",
        description=(
            "The script names this patient:\n"
            f"  name: {intake_data.get('patient_name')}\n"
            f"  id candidates: {json.dumps(candidates)}\n\n"
            "Live PIS lookups already performed (real records from the clinic database):\n"
            f"{json.dumps(lookups, ensure_ascii=True)}\n\n"
            "Decide the identity match. Doctors write only the patient's FIRST name "
            "(often without surname, sometimes misspelled: Shilaj/Shilaja, "
            "Sunita/Sunitha, Rama Rew/Rama Rao). The PIS stores full names with "
            "surname and initials. If the script name clearly corresponds to the "
            "first name of the found PIS record (allowing 1-2 letter spelling drift "
            "and a missing surname), that IS a match - do not call it a mismatch "
            "just because the PIS name has extra parts. When the script has no "
            "patient name, a found PIS record for the primary candidate counts as "
            "matched (the RegNo is the identity). Use 'mismatch' ONLY when the "
            "PRIMARY candidate's record was found but its name genuinely disagrees "
            "with the script (e.g. Sunitha vs Krishnamurthy). If only an ALTERNATE "
            "candidate found a record and its name does not fit the script, that "
            "alternate is simply the wrong number - ignore it and report "
            "'not_found'. If no lookup matches but another candidate ID was NOT "
            "yet tried, you may request it via retry_regno. Return STRICT JSON:\n"
            '{"decision":"matched|mismatch|not_found","matched_regno":"<regno> or null",'
            '"pis_name":"name from PIS or null","name_match_score":0.0,'
            '"retry_regno":null,"reasoning":"one sentence"}'
        ),
        expected_output="Strict JSON with decision, matched_regno, pis_name, "
                        "name_match_score, retry_regno, reasoning.",
    )
    records_decision = parse_json(records_decision_raw) or {"decision": "not_found", "reasoning": "unparseable"}

    retry = str(records_decision.get("retry_regno") or "").strip()
    if retry and retry not in [entry["regno"] for entry in lookups]:
        emit("patient_records", "progress",
             f"Agent requested one more retrieval: RegNo {retry}.", {"regno": retry})
        record = tools.lookup_patient(retry)
        lookups.append({"regno": retry, "result": record})
        records_decision_raw = run_single_task(
            llm,
            role="Patient Records Agent",
            goal="Finalize the identity decision with the extra lookup included.",
            backstory="You verify patients against the live legacy PIS.",
            description=(
                f"Script name: {intake_data.get('patient_name')}\n"
                f"All PIS lookups: {json.dumps(lookups, ensure_ascii=True)}\n"
                "Return the same STRICT JSON schema as before, with retry_regno null."
            ),
            expected_output="Strict JSON identity decision.",
        )
        records_decision = parse_json(records_decision_raw) or records_decision

    matched = records_decision.get("decision") == "matched"
    emit("patient_records", "completed",
         "Identity " + ("verified: RegNo " + str(records_decision.get("matched_regno"))
                        if matched else f"NOT verified ({records_decision.get('decision')}). "
                        "The form will need front-desk attention."),
         {"output": records_decision, "lookups": lookups})

    # ---- Stage 3: Pharmacist (document-grounded remedy matching) -----------
    medicines = intake_data.get("medicines", []) or []
    emit("pharmacist", "started",
         f"Grounding {len(medicines)} medicine line(s) against the homeopathy remedy "
         "corpus with VultronRetriever rerank.", {})
    grounded: List[Dict[str, Any]] = []
    for index, medicine in enumerate(medicines):
        raw = str(medicine.get("raw_text", "")).strip()
        if not raw:
            continue
        expanded = str(medicine.get("expanded") or "").strip()
        query = f"{raw} ({expanded})" if expanded and expanded.lower() != raw.lower() else raw
        matches = tools.match_remedy(query)
        grounded.append({"raw_text": raw, "expanded": expanded or None,
                         "dosage": medicine.get("dosage"), "corpus_matches": matches})
        top = matches[0]["name"] if matches else "no match"
        emit("pharmacist", "progress",
             f"Line {index + 1} \"{raw}\": top corpus match {top}.",
             {"raw_text": raw, "matches": matches})

    pharmacist_raw = run_single_task(
        llm,
        role="Homeopathy Pharmacist Agent",
        goal="Canonicalize each handwritten medicine line using the remedy corpus "
             "evidence, validating potency and form.",
        backstory="You are the clinic pharmacist. You know every remedy abbreviation, "
                  "and you refuse to confirm a remedy the corpus evidence does not support.",
        description=(
            "For each medicine line, pick the canonical remedy from the corpus matches "
            "(or mark it unrecognized), extract the potency (like 30C, 200C, 1M, Q, 6X) "
            "from the raw text, validate the potency against the remedy's common "
            "potencies, and keep the dosage exactly as given (empty stays empty). "
            "The doctor writes heavy shorthand: use the 'expanded' reading and the "
            "corpus abbreviation lists to resolve it (e.g. 'CF 6X comp' -> Calcarea "
            "Fluorica, 'KP 6X' -> Kali Phosphoricum, 'B-16' -> Bio-Combination "
            "tablets, 'Thyr 3X' -> Thyroidinum, 'Y-lax' -> Y-Lax, 'Rat 200' -> "
            "Ratanhia Peruviana). A confident top corpus match whose abbreviations "
            "plausibly fit the handwriting IS a recognition - accept it instead of "
            "flagging. 'SL' / '8L' / 'S.L.' is Sac Lac placebo: canonical remedy "
            "'Sac Lac', no potency, not a flag-worthy problem. Only mark a line "
            "unrecognized when no corpus match is plausible at all. Include EVERY "
            "input line in items, in order. Return STRICT JSON only:\n"
            '{"items":[{"raw_text":"<as given>","remedy":"<canonical name or null>",'
            '"potency":"<potency or null>","potency_valid":true,'
            '"dosage":"<as given>","confidence":0.0,'
            '"citation":"corpus line used","flags":["..."]}]}\n\n'
            f"Medicine lines with corpus evidence:\n{json.dumps(grounded, ensure_ascii=True)}"
        ),
        expected_output="Strict JSON with items array.",
    )
    pharmacy = parse_json(pharmacist_raw) or {"items": []}
    flagged = sum(1 for item in pharmacy.get("items", []) if item.get("flags"))
    emit("pharmacist", "completed",
         f"{len(pharmacy.get('items', []))} medicine(s) canonicalized, {flagged} flagged.",
         {"output": pharmacy})

    # ---- Stage 4: Entry Composer -------------------------------------------
    emit("entry_composer", "started",
         "Composing the final PIS entry form with confidences and citations.", {})
    composer_raw = run_single_task(
        llm,
        role="Entry Composer Agent",
        goal="Produce the final, review-ready PIS entry form from all verified evidence.",
        backstory="You prepare the exact entry the compounder would have typed by hand. "
                  "Every field carries its evidence. You decide if the entry is ready "
                  "or needs human review, and why.",
        description=(
            "Compose the final entry form. ready_for_entry is true ONLY when identity "
            "is matched and no medicine is unrecognized. regno MUST be the matched_regno "
            "from the identity decision when matched, otherwise the first patient ID "
            "candidate from intake (never invent one).\n"
            "CRITICAL: copy every value from the evidence below. NEVER fabricate or "
            "'infer from common practice' a dosage, amount, date or any other value. "
            "If a value is missing in the evidence it must be null (and, if it "
            "matters, listed in review_reasons). Dosage must be the actual dosage "
            "text from the evidence or null - never a placeholder phrase like "
            "'as written'. All confidence values must be between 0.0 and 1.0 "
            "(corpus rerank scores are NOT confidences - judge confidence yourself "
            "from how well the evidence agrees). Include one prescriptions entry for "
            "EVERY pharmacy item, including Sac Lac placebo lines. Return STRICT JSON only:\n"
            '{"regno":"<regno>","patient_name":"from PIS if matched else from script",'
            '"identity":{"status":"matched|mismatch|not_found","pis_name":"<name or null>",'
            '"score":0.0},"prescriptions":[{"text":"<remedy potency - dosage, from evidence>",'
            '"remedy":"<canonical or null>","potency":"<or null>","dosage":"<or null>",'
            '"confidence":0.0,"citation":"<corpus citation>"}],'
            '"duration":"<course duration or null>","complaints":["..."],'
            '"amount":<number or null>,"date":"YYYY-MM-DD or null",'
            '"ready_for_entry":true,"review_reasons":["..."],"summary":"one sentence"}\n\n'
            f"Intake: {json.dumps(intake_data, ensure_ascii=True)}\n"
            f"Identity decision: {json.dumps(records_decision, ensure_ascii=True)}\n"
            f"PIS lookups: {json.dumps(lookups, ensure_ascii=True)}\n"
            f"Pharmacy result: {json.dumps(pharmacy, ensure_ascii=True)}"
        ),
        expected_output="Strict JSON entry form.",
    )
    form = parse_json(composer_raw) or {}
    form.setdefault("ready_for_entry", False)
    form.setdefault("review_reasons", [])
    if not form.get("regno"):
        form["regno"] = (records_decision.get("matched_regno") if matched else None) \
            or (candidates[0] if candidates else None)
    form["evidence"] = {
        "ocr": ocr_result,
        "pis_lookups": lookups,
        "identity_decision": records_decision,
        "pharmacy": pharmacy,
    }
    emit("entry_composer", "completed",
         form.get("summary") or "Entry form is ready for review.",
         {"output": {key: value for key, value in form.items() if key != "evidence"}})
    return form


def run_single_task(llm: VultrInferenceLLM, role: str, goal: str, backstory: str,
                    description: str, expected_output: str) -> str:
    agent = Agent(role=role, goal=goal, backstory=backstory, llm=llm,
                  verbose=False, allow_delegation=False)
    task = Task(description=description, expected_output=expected_output, agent=agent)
    crew = Crew(agents=[agent], tasks=[task], process=Process.sequential,
                verbose=False, cache=False)
    result = crew.kickoff(inputs={})
    raw = getattr(result, "raw", None)
    return str(raw if raw is not None else result)


def parse_json(content: str) -> Optional[Dict[str, Any]]:
    if not content:
        return None
    stripped = re.sub(r"^```(?:json)?\s*|\s*```$", "", content.strip(), flags=re.IGNORECASE)
    match = re.search(r"\{[\s\S]*\}", stripped)
    if not match:
        return None
    try:
        value = json.loads(match.group(0))
    except json.JSONDecodeError:
        return None
    return value if isinstance(value, dict) else None


def fallback_intake(ocr_result: Dict[str, Any]) -> Dict[str, Any]:
    patient_id = obj(ocr_result.get("patient_id"))
    candidates = [str(patient_id.get("value") or "")]
    candidates += [str(alt) for alt in patient_id.get("alternates", [])]
    return {
        "patient_id_candidates": [c for c in candidates if c],
        "patient_name": str(obj(ocr_result.get("patient_name")).get("value") or ""),
        "medicines": [
            {"raw_text": str(m.get("raw_text") or ""), "expanded": m.get("expanded"),
             "dosage": m.get("dosage")}
            for m in ocr_result.get("medicines", []) or []
        ],
        "duration": obj(ocr_result.get("duration")).get("value"),
        "complaints": ocr_result.get("complaints", []) or [],
        "amount": obj(ocr_result.get("amount")).get("value"),
        "date": obj(ocr_result.get("date")).get("value"),
        "concerns": ["intake agent output was unparseable; used OCR passthrough"],
    }


CONFUSABLE_DIGITS = {"9": "2", "2": "9", "8": "6", "6": "8", "0": "6", "4": "9", "7": "9", "3": "5", "5": "3"}


def digit_confusion_variants(regno: str, exclude: set, limit: int = 6) -> List[str]:
    """RegNos one confusable digit away from the OCR's primary reading,
    most-significant digit first (that is where misreads hurt the most)."""
    regno = "".join(ch for ch in str(regno) if ch.isdigit())
    variants: List[str] = []
    for position, digit in enumerate(regno):
        swap = CONFUSABLE_DIGITS.get(digit)
        if not swap:
            continue
        variant = regno[:position] + swap + regno[position + 1:]
        if variant not in exclude and variant not in variants:
            variants.append(variant)
        if len(variants) >= limit:
            break
    return variants


def patient_full_name(record: Dict[str, Any]) -> str:
    patient = obj(record.get("patient"))
    return f"{patient.get('first_name', '')} {patient.get('last_name', '')}".strip()


def name_similarity(left: str, right: str) -> float:
    """Token similarity tolerant of the clinic's habits: scripts carry only a
    (possibly misspelled) first name while the PIS stores the full name."""
    left_tokens = [t for t in normalize_name(left).split() if len(t) > 1]
    right_tokens = [t for t in normalize_name(right).split() if len(t) > 1]
    if not left_tokens or not right_tokens:
        return 0.0
    from difflib import SequenceMatcher

    matched = 0
    for token in left_tokens:
        best = max(
            (SequenceMatcher(None, token, other).ratio() for other in right_tokens),
            default=0.0,
        )
        if best >= 0.75:
            matched += 1
    # Score against the script side only: extra surname/initials in the PIS
    # record must not dilute a solid first-name match.
    return matched / len(left_tokens)


def normalize_name(value: str) -> str:
    return re.sub(r"[^a-z ]", "", value.lower()).strip()


def obj(value: Any) -> Dict[str, Any]:
    return value if isinstance(value, dict) else {}
