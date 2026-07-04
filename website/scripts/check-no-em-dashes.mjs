import { readFileSync, readdirSync } from "node:fs";
import { extname, join, relative } from "node:path";

const root = process.cwd();
const ignoredDirectories = new Set([".git", ".next", "node_modules", "out"]);
const checkedExtensions = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".ts",
  ".tsx",
]);
const bannedCharacter = "\u2014";
const violations = [];

function scan(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;

    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      scan(absolutePath);
      continue;
    }

    if (!checkedExtensions.has(extname(entry.name))) continue;

    const lines = readFileSync(absolutePath, "utf8").split("\n");
    lines.forEach((line, index) => {
      if (line.includes(bannedCharacter)) {
        violations.push(`${relative(root, absolutePath)}:${index + 1}`);
      }
    });
  }
}

scan(root);

if (violations.length > 0) {
  console.error("Em dashes are not allowed:");
  violations.forEach((violation) => console.error(`  ${violation}`));
  process.exit(1);
}

console.log("Em dash check passed.");
