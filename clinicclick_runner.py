#!/usr/bin/env python3
"""Gemini Computer Use runner for approved clinic data-entry jobs.

The default mode sends one screenshot to Gemini and only prints the proposed
action. Pass --approved-job with a synthetic approved job to execute it directly.
"""

import argparse
import base64
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path


API_URL = "https://generativelanguage.googleapis.com/v1beta/interactions"
DEFAULT_MODEL = "gemini-3.5-flash"
DEFAULT_GOAL = (
    "This is a supervised test of a patient information desktop application. "
    "Use only the synthetic test patient named TEST PATIENT. Do not open, edit, "
    "or reveal any real patient record. Stop before Save, Submit, Update, Delete, "
    "Prescription, or any other action that changes a medical record. "
    "Identify the next safe UI action needed to search for TEST PATIENT."
)

# These actions are never executed by this prototype, even after a normal
# per-step approval. The operator must complete them manually in the clinic app.
CONSEQUENTIAL_WORDS = {
    "save",
    "submit",
    "update",
    "delete",
    "remove",
    "prescription",
    "confirm",
    "approve",
    "create patient",
    "add patient",
    "medical record",
}
DESTRUCTIVE_WORDS = {"delete", "remove"}
FORBIDDEN_DEMO_PHRASES = {
    "delete patient",
    "delete record",
    "remove patient",
    "remove record",
    "edit patient",
    "edit record",
    "prescription",
    "search patient",
    "search for patient",
}


def load_dotenv(path):
    """Load simple KEY=VALUE entries without adding another dependency."""
    dotenv = Path(path)
    if not dotenv.exists():
        return
    for raw_line in dotenv.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


def parse_region(value):
    if value is None:
        return None
    try:
        region = tuple(int(part.strip()) for part in value.split(","))
    except ValueError as exc:
        raise argparse.ArgumentTypeError("region must contain integers") from exc
    if len(region) != 4 or any(item < 0 for item in region):
        raise argparse.ArgumentTypeError("region must be left,top,width,height")
    if region[2] == 0 or region[3] == 0:
        raise argparse.ArgumentTypeError("region width and height must be positive")
    return region


def denormalize(value, extent):
    """Map Gemini's 0..999 coordinate space to a local pixel dimension."""
    bounded = max(0, min(999, int(value)))
    return round(bounded / 1000 * extent)


def screen_point(arguments, region):
    left, top, width, height = region
    return (
        left + denormalize(arguments["x"], width),
        top + denormalize(arguments["y"], height),
    )


def encode_png(path):
    return base64.b64encode(Path(path).read_bytes()).decode("ascii")


def post_interaction(api_key, payload):
    request = urllib.request.Request(
        API_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "x-goog-api-key": api_key,
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError("Gemini API returned HTTP {}: {}".format(exc.code, detail))
    except urllib.error.URLError as exc:
        raise RuntimeError("Could not reach Gemini API: {}".format(exc.reason))


def computer_tool():
    return {
        "type": "computer_use",
        "environment": "desktop",
        "enable_prompt_injection_detection": True,
    }


def first_payload(goal, screenshot_b64, model, approved_job=None):
    if approved_job:
        system_instruction = (
            "You are the data-entry component of ClinicClick Agent. The web app "
            "has already approved the structured job. Enter exactly the supplied "
            "values into the Patient Information System and click the final Save "
            "or Add button. Do not infer, correct, diagnose, prescribe, or invent "
            "any value. Never open, edit, or delete an existing patient. If a "
            "duplicate, error, ambiguity, or unexpected dialog appears, stop. "
            "After saving, visually verify success and then finish."
            " Work quickly: prefer keyboard Tab navigation and Ctrl+A before "
            "typing into fields with default values. Do not repeat a click that "
            "already succeeded. When several actions do not require inspecting "
            "an intermediate screenshot, return those sequential function calls "
            "together in the correct order."
        )
    else:
        system_instruction = (
            "You operate under human supervision. Never access a real patient "
            "record. Never perform a consequential medical-data action. Stop "
            "before any save, submit, update, delete, prescription, or confirmation."
        )
    return {
        "model": model,
        "generation_config": {"thinking_level": "low"},
        "system_instruction": system_instruction,
        "input": [
            {"type": "text", "text": goal},
            {"type": "image", "data": screenshot_b64, "mime_type": "image/png"},
        ],
        "tools": [computer_tool()],
    }


def continuation_payload(interaction_id, results, screenshot_b64, model):
    function_results = []
    for item in results:
        result = {"status": item["status"]}
        if item.get("safety_acknowledgement"):
            result["safety_acknowledgement"] = True
        function_results.append(
            {
                "type": "function_result",
                "name": item["name"],
                "call_id": item["call_id"],
                "result": [
                    {"type": "text", "text": json.dumps(result)},
                    {"type": "image", "data": screenshot_b64, "mime_type": "image/png"},
                ],
            }
        )
    return {
        "model": model,
        "generation_config": {"thinking_level": "low"},
        "previous_interaction_id": interaction_id,
        "input": function_results,
        "tools": [computer_tool()],
    }


def function_calls(interaction):
    return [step for step in interaction.get("steps", []) if step.get("type") == "function_call"]


def output_text(interaction):
    chunks = []
    for step in interaction.get("steps", []):
        if step.get("type") != "model_output":
            continue
        for block in step.get("content", []):
            if block.get("type") == "text":
                chunks.append(block.get("text", ""))
    return " ".join(chunks).strip()


def action_summary(call, region):
    name = call.get("name", "unknown")
    args = call.get("arguments", {})
    intent = args.get("intent", "No intent supplied")
    location = ""
    if "x" in args and "y" in args:
        x, y = screen_point(args, region)
        location = " at screen ({}, {})".format(x, y)
    return "{}{} — {}".format(name, location, intent)


def is_consequential(call):
    args = call.get("arguments", {})
    searchable = "{} {}".format(call.get("name", ""), json.dumps(args)).lower()
    return any(word in searchable for word in CONSEQUENTIAL_WORDS)


def is_destructive(call):
    args = call.get("arguments", {})
    searchable = "{} {}".format(call.get("name", ""), json.dumps(args)).lower()
    return any(word in searchable for word in DESTRUCTIVE_WORDS)


def load_approved_job(path):
    job = json.loads(Path(path).read_text(encoding="utf-8"))
    if job.get("status") != "approved":
        raise RuntimeError("Job must have status=approved")
    if job.get("demo") is not True:
        raise RuntimeError("Automatic mode is currently restricted to demo=true jobs")
    if job.get("task") != "create_patients":
        raise RuntimeError("Demo runner currently supports only task=create_patients")
    patients = job.get("patients")
    if not isinstance(patients, list) or not 1 <= len(patients) <= 5:
        raise RuntimeError("Approved demo batch must contain between 1 and 5 patients")
    if any(not isinstance(patient, dict) or not patient for patient in patients):
        raise RuntimeError("Every approved patient must contain fields")
    values = [
        str(value)
        for patient in patients
        for value in patient.values()
        if value is not None
    ]
    identity = " ".join(values).upper()
    if "TEST" not in identity and "DEMO" not in identity:
        raise RuntimeError("Demo patient data must visibly contain TEST or DEMO")
    return job


def approved_job_goal(job):
    patient_count = len(job["patients"])
    return (
        "Create exactly {} new patients, in the listed order, using the Add "
        "New Patient screen. This structured batch is final and already approved "
        "by the web app. For each patient, enter only the supplied fields exactly, "
        "save, and then return to Add New Patient for the next one. Do not use "
        "Search, Edit, Delete, Clear, or Prescription. Do not open or inspect any "
        "existing patient row. After saving and visibly verifying the final "
        "patient, finish immediately.\n\n"
        "APPROVED JOB:\n{}"
    ).format(patient_count, json.dumps(job, indent=2, sort_keys=True))


def approved_text_values(job):
    values = set()
    for patient in job["patients"]:
        values.update(str(value) for value in patient.values() if value is not None)
        first = str(patient.get("first_name", "")).strip()
        last = str(patient.get("last_name", "")).strip()
        if first or last:
            values.add("{} {}".format(first, last).strip())
    return values


def auto_action_allowed(call, job):
    decision, explanation = safety_decision(call)
    if decision == "blocked":
        return False, "Gemini safety blocked the action: {}".format(explanation or "no explanation")
    searchable = "{} {}".format(call.get("name", ""), json.dumps(call.get("arguments", {}))).lower()
    forbidden = sorted(phrase for phrase in FORBIDDEN_DEMO_PHRASES if phrase in searchable)
    intent = str(call.get("arguments", {}).get("intent", "")).lower().strip()
    if "click clear" in intent or "clear button" in intent:
        forbidden.append("clear")
    if forbidden:
        return False, "Action is outside create-only demo scope: {}".format(", ".join(forbidden))
    if call.get("name") == "type":
        typed = str(call.get("arguments", {}).get("text", ""))
        if typed not in approved_text_values(job):
            return False, "Model tried to type a value absent from the approved job: {!r}".format(typed)
    return True, ""


def append_audit(path, job, call, status):
    record = {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "job_id": job.get("job_id"),
        "action": call.get("name"),
        "arguments": call.get("arguments", {}),
        "status": status,
    }
    audit_path = Path(path)
    audit_path.parent.mkdir(parents=True, exist_ok=True)
    with audit_path.open("a", encoding="utf-8") as stream:
        stream.write(json.dumps(record, sort_keys=True) + "\n")


def safety_decision(call):
    decision = call.get("arguments", {}).get("safety_decision", {})
    return str(decision.get("decision", "")).lower(), decision.get("explanation", "")


def require_approval(call, region):
    print("\nProposed action: {}".format(action_summary(call, region)))
    decision, explanation = safety_decision(call)
    if decision == "blocked":
        print("Blocked by Gemini safety: {}".format(explanation or "no explanation"))
        return False, False
    if is_consequential(call):
        print("Blocked locally: this may change a patient record. Perform it manually if appropriate.")
        return False, False
    if decision == "require_confirmation":
        print("Gemini requires confirmation: {}".format(explanation or "sensitive action"))
    answer = input("Execute this one action? Type YES: ").strip()
    return answer == "YES", decision == "require_confirmation"


def import_pyautogui():
    try:
        import pyautogui
    except ImportError as exc:
        raise RuntimeError("Live mode requires: python -m pip install -r requirements.txt") from exc
    pyautogui.FAILSAFE = True
    pyautogui.PAUSE = 0.25
    return pyautogui


def capture(pyautogui, path, region):
    image = pyautogui.screenshot(region=region)
    image.save(str(path), "PNG")
    return encode_png(path)


def key_name(value):
    aliases = {"control": "ctrl", "escape": "esc", "return": "enter", "delete": "delete"}
    return aliases.get(str(value).lower(), str(value).lower())


def execute_action(pyautogui, call, region):
    name = call["name"]
    args = call.get("arguments", {})
    point = screen_point(args, region) if "x" in args and "y" in args else None

    if name == "click":
        pyautogui.click(*point)
    elif name == "double_click":
        pyautogui.doubleClick(*point)
    elif name == "triple_click":
        pyautogui.click(*point, clicks=3, interval=0.12)
    elif name == "middle_click":
        pyautogui.click(*point, button="middle")
    elif name == "right_click":
        pyautogui.rightClick(*point)
    elif name == "move":
        pyautogui.moveTo(*point, duration=0.2)
    elif name == "mouse_down":
        pyautogui.moveTo(*point)
        pyautogui.mouseDown()
    elif name == "mouse_up":
        pyautogui.moveTo(*point)
        pyautogui.mouseUp()
    elif name == "type":
        pyautogui.write(args["text"], interval=0.03)
        if args.get("press_enter"):
            pyautogui.press("enter")
    elif name == "drag_and_drop":
        start = screen_point({"x": args["start_x"], "y": args["start_y"]}, region)
        end = screen_point({"x": args["end_x"], "y": args["end_y"]}, region)
        pyautogui.moveTo(*start)
        pyautogui.dragTo(*end, duration=0.5)
    elif name == "wait":
        time.sleep(min(int(args.get("seconds", 1)), 10))
    elif name == "press_key":
        pyautogui.press(key_name(args["key"]))
    elif name == "key_down":
        pyautogui.keyDown(key_name(args["key"]))
    elif name == "key_up":
        pyautogui.keyUp(key_name(args["key"]))
    elif name == "hotkey":
        pyautogui.hotkey(*(key_name(key) for key in args["keys"]))
    elif name == "scroll":
        if point:
            pyautogui.moveTo(*point)
        amount = max(1, int(args.get("magnitude_in_pixels", 300)) // 100)
        direction = args.get("direction", "down")
        if direction in ("up", "down"):
            pyautogui.scroll(amount if direction == "up" else -amount)
        else:
            pyautogui.hscroll(amount if direction == "right" else -amount)
    elif name == "take_screenshot":
        pass
    else:
        raise RuntimeError("Unsupported desktop action: {}".format(name))


def run(args):
    load_dotenv(args.env_file)
    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        raise RuntimeError("Set GEMINI_API_KEY in .env before running the test")

    approved_job = load_approved_job(args.approved_job) if args.approved_job else None
    if approved_job and not args.live:
        raise RuntimeError("An approved job executes directly and therefore requires --live")
    goal = approved_job_goal(approved_job) if approved_job else args.goal

    pyautogui = None
    screenshot_path = Path(args.screenshot) if args.screenshot else Path("artifacts/current-screen.png")
    screenshot_path.parent.mkdir(parents=True, exist_ok=True)

    if args.live:
        pyautogui = import_pyautogui()
        width, height = pyautogui.size()
        region = args.region or (0, 0, width, height)
        screenshot_b64 = capture(pyautogui, screenshot_path, region)
    else:
        if not args.screenshot:
            raise RuntimeError("Dry-run mode requires --screenshot PATH")
        from PIL import Image
        with Image.open(str(screenshot_path)) as image:
            width, height = image.size
        region = (0, 0, width, height)
        screenshot_b64 = encode_png(screenshot_path)

    interaction = post_interaction(
        api_key,
        first_payload(goal, screenshot_b64, args.model, approved_job=approved_job),
    )
    turns = 0
    while turns < args.max_turns:
        turns += 1
        calls = function_calls(interaction)
        if not calls:
            print("\nGemini finished: {}".format(output_text(interaction) or "No action returned"))
            return 0

        if not args.live:
            print("\nDRY RUN — nothing was clicked or typed.")
            for call in calls:
                print("Proposed action: {}".format(action_summary(call, region)))
            return 0

        results = []
        for call in calls:
            if approved_job:
                print("\nExecuting approved job action: {}".format(action_summary(call, region)))
                allowed, reason = auto_action_allowed(call, approved_job)
                if not allowed:
                    append_audit(args.audit_log, approved_job, call, "blocked")
                    raise RuntimeError(reason)
                decision, _ = safety_decision(call)
                safety_ack = decision == "require_confirmation"
            else:
                approved, safety_ack = require_approval(call, region)
                if not approved:
                    print("Stopped without executing the proposed action.")
                    return 0
            execute_action(pyautogui, call, region)
            if approved_job:
                append_audit(args.audit_log, approved_job, call, "executed")
            results.append(
                {
                    "name": call["name"],
                    "call_id": call["id"],
                    "status": "executed",
                    "safety_acknowledgement": safety_ack,
                }
            )

        time.sleep(0.75)
        screenshot_b64 = capture(pyautogui, screenshot_path, region)
        interaction = post_interaction(
            api_key,
            continuation_payload(interaction["id"], results, screenshot_b64, args.model),
        )

    print("Stopped at the configured turn limit ({}).".format(args.max_turns))
    return 0


def build_parser():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--screenshot", help="PNG to inspect in dry-run mode")
    parser.add_argument("--live", action="store_true", help="capture and control the desktop with approval")
    parser.add_argument(
        "--approved-job",
        help="execute an already-approved synthetic JSON job without per-action prompts",
    )
    parser.add_argument("--region", type=parse_region, help="live capture region: left,top,width,height")
    parser.add_argument("--goal", default=DEFAULT_GOAL, help="task for Gemini")
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--max-turns", type=int, default=80)
    parser.add_argument("--env-file", default=".env")
    parser.add_argument("--audit-log", default="artifacts/actions.jsonl")
    return parser


def main():
    try:
        return run(build_parser().parse_args())
    except KeyboardInterrupt:
        print("\nStopped by operator.")
        return 130
    except Exception as exc:
        print("Error: {}".format(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
