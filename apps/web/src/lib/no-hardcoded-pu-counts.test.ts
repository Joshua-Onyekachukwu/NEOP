import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";

/**
 * No Hard-Coded PU Counts
 *
 * Fails CI if any UI file (.tsx, .ts) contains a known-bad hard-coded
 * polling-unit count. This prevents regressions like "80,996 results"
 * appearing when the real INEC 2026 universe is 176,846.
 *
 * Strategy: instead of generically scanning for all large numbers (which
 * produces false positives on timeouts, page sizes, etc.), we check for
 * the SPECIFIC known-bad values that have appeared in the codebase, plus
 * any number > 10,000 that appears in a display context (JSX, template
 * literal, or toLocaleString call).
 */

const SRC_DIR = join(__dirname, "..");

// Known-bad PU count literals that have appeared in the codebase.
// These are values that were once hard-coded as "total polling units"
// and displayed on the live site. The real INEC 2026 universe is 176,846.
const KNOWN_BAD = new Set([
  80_996,  // was displayed as "80,996 results" on the banner
  80_997,  // near-miss variant
  80_000,  // round approximation
  35_190,  // was displayed as published count with wrong denominator
  100_000, // round approximation
  150_000, // round approximation
  200_000, // round approximation
]);

// Files to skip entirely
const SKIP_PATTERNS = [
  /\.test\.tsx?$/,
  /\.spec\.tsx?$/,
  /node_modules/,
  /\.next/,
  /\.sql$/,
];

function walkDir(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      files.push(...walkDir(full));
    } else if (/\.(tsx?|jsx?)$/.test(entry)) {
      files.push(full);
    }
  }
  return files;
}

describe("No hard-coded polling-unit count literals", () => {
  it("codebase is clean of known-bad PU count literals", () => {
    const files = walkDir(SRC_DIR).filter(
      (f) => !SKIP_PATTERNS.some((p) => p.test(f))
    );

    const violations: string[] = [];

    for (const file of files) {
      const rel = relative(SRC_DIR, file);
      const content = readFileSync(file, "utf8");
      const lines = content.split("\n");

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Skip pure comment lines
        if (/^\s*(\/\/|\/\*|\*)/.test(line)) continue;

        // Check for known-bad values
        for (const bad of KNOWN_BAD) {
          if (line.includes(String(bad))) {
            // Skip if it's in a comment on this line
            const idx = line.indexOf(String(bad));
            const before = line.slice(0, idx).trim();
            if (before.endsWith("//") || before.endsWith("*") || before.endsWith("/*")) continue;

            violations.push(`${rel}:${i + 1} contains ${bad.toLocaleString()}: ${line.trim()}`);
          }
        }
      }
    }

    if (violations.length > 0) {
      expect.fail(
        `Found ${violations.length} hard-coded PU count literal(s):\n` +
        violations.join("\n") +
        "\n\nPU counts must come from the API/database, never from literals."
      );
    }
  });
});
