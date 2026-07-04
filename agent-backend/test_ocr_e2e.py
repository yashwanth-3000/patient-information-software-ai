"""End-to-end: OpenAI vision OCR on a dummy script photo, then the full crew."""

import json
import sys
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

import crew_runner
import tools


def emit(agent, status, message, payload):
    print(f"[{agent}] {status}: {message}")


def main() -> None:
    image_path = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(
        "../dad-handwriten-notes/IMG_0207.png"
    )
    if not image_path.exists():
        raise SystemExit(f"Image not found: {image_path}")

    image_bytes = image_path.read_bytes()
    mime = "image/png" if image_path.suffix.lower() == ".png" else "image/jpeg"

    print(f"=== OCR: {image_path.name} ===")
    ocr = tools.run_ocr(image_bytes, mime)
    print(json.dumps(ocr, indent=2))

    print("\n=== CREW PIPELINE ===")
    form = crew_runner.run_script_pipeline(ocr, emit)
    print("\n=== FINAL FORM ===")
    print(json.dumps({k: v for k, v in form.items() if k != "evidence"}, indent=2))


if __name__ == "__main__":
    main()
