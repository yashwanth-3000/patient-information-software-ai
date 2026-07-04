#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 /path/to/PIS-x86.exe" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "$0")" && pwd)"
INPUT_EXE="$1"
OUTPUT="$ROOT/bin"

if [[ ! -f "$INPUT_EXE" ]]; then
  echo "PIS executable not found: $INPUT_EXE" >&2
  exit 1
fi

CECIL="$(find /opt/homebrew/Cellar/mono /usr/local/lib/mono /Library/Frameworks/Mono.framework \
  -path '*/Mono.Cecil/0.11.1.0__*/Mono.Cecil.dll' -print -quit 2>/dev/null)"

if [[ -z "$CECIL" ]]; then
  echo "Mono.Cecil 0.11.1 was not found. Install Mono first." >&2
  exit 1
fi

mkdir -p "$OUTPUT"

mcs -sdk:2 -warnaserror+ -optimize+ -target:library -platform:x86 \
  -r:System.dll \
  -r:System.Windows.Forms.dll \
  -r:System.Drawing.dll \
  -r:System.Data.dll \
  -r:System.Configuration.dll \
  -out:"$OUTPUT/ClinicClick.PisPlugin.dll" \
  "$ROOT/ClinicClickPisPlugin.cs"

mcs -sdk:4 -warnaserror+ -optimize+ -target:exe \
  -r:"$CECIL" \
  -r:System.Core.dll \
  -out:"$OUTPUT/PatchPis.exe" \
  "$ROOT/PatchPis.cs"

MONO_PATH="$(dirname "$CECIL")" mono "$OUTPUT/PatchPis.exe" \
  "$INPUT_EXE" \
  "$OUTPUT/ClinicClick.PisPlugin.dll" \
  "$OUTPUT/PIS-ClinicClick.exe"

SOURCE_CONFIG="$INPUT_EXE.config"
if [[ -f "$SOURCE_CONFIG" ]]; then
  python3 - "$SOURCE_CONFIG" "$OUTPUT/PIS-ClinicClick.exe.config" <<'PY'
import sys
import xml.etree.ElementTree as ET

source, destination = sys.argv[1:]
tree = ET.parse(source)
root = tree.getroot()

startup = root.find("startup")
if startup is not None:
    root.remove(startup)

settings = root.find("appSettings")
if settings is None:
    settings = ET.SubElement(root, "appSettings")
for child in list(settings):
    if child.tag == "add" and child.get("key") == "ClinicClickApiUrl":
        settings.remove(child)
ET.SubElement(settings, "add", {
    "key": "ClinicClickApiUrl",
    "value": "http://65.20.78.208",
})

tree.write(destination, encoding="utf-8", xml_declaration=True)
PY
else
  cp "$ROOT/PIS-ClinicClick.exe.config" "$OUTPUT/PIS-ClinicClick.exe.config"
fi

echo "Built PIS-ClinicClick.exe in $OUTPUT"
