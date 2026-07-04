"use client";

import { useState } from "react";

const command =
  "python clinicclick_runner.py --screenshot test-data/pis-clean.png";

export function CopyCommand() {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(command);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div className="code-block">
      <span>$</span>
      <code>{command}</code>
      <button aria-label="Copy command" onClick={copy} type="button">
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
