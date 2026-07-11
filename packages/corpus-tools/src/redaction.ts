/**
 * Deterministic PII scan for corpus intake (M1.2). Finds SSN/EIN-shaped
 * strings in extracted PDF text so un-redacted documents cannot enter the
 * corpus silently. This is a *detector with a manual confirm step* — it flags;
 * a human verifies. It never rewrites the PDF.
 */

export type PiiKind = "ssn" | "ein" | "nine_digits";

export interface PiiFinding {
  kind: PiiKind;
  /** 1-based page number. */
  page: number;
  /** The matched text, partially masked for safe display (e.g. "***-**-1234"). */
  masked: string;
  /** definite = formatted SSN/EIN; possible = bare 9-digit run. */
  severity: "definite" | "possible";
}

const PATTERNS: ReadonlyArray<{ kind: PiiKind; re: RegExp; severity: "definite" | "possible" }> = [
  // 123-45-6789 — SSN with separators.
  { kind: "ssn", re: /\b\d{3}-\d{2}-\d{4}\b/g, severity: "definite" },
  // 12-3456789 — EIN with separator.
  { kind: "ein", re: /\b\d{2}-\d{7}\b/g, severity: "definite" },
  // Bare 9-digit run — could be an unformatted SSN/EIN (or a routing number);
  // flagged as "possible" for the human confirm step.
  { kind: "nine_digits", re: /\b\d{9}\b/g, severity: "possible" },
];

/** Mask all but the last 4 characters of a match for safe display. */
export function maskPii(match: string): string {
  const tail = match.slice(-4);
  return `${match.slice(0, -4).replace(/\d/g, "*")}${tail}`;
}

/**
 * Scan per-page text for PII-shaped strings. `pages[i]` is the text of page
 * i+1. Formatted matches also consume their bare-digit form, so a definite
 * SSN/EIN is not double-reported as a possible nine-digit run.
 */
export function scanPii(pages: readonly string[]): PiiFinding[] {
  const findings: PiiFinding[] = [];
  pages.forEach((text, i) => {
    const claimed: Array<{ start: number; end: number }> = [];
    for (const { kind, re, severity } of PATTERNS) {
      re.lastIndex = 0;
      for (const m of text.matchAll(re)) {
        const start = m.index;
        const end = start + m[0].length;
        // Skip bare-digit matches inside an already-claimed formatted match.
        if (claimed.some((c) => start >= c.start && end <= c.end)) continue;
        if (severity === "definite") claimed.push({ start, end });
        findings.push({ kind, page: i + 1, masked: maskPii(m[0]), severity });
      }
    }
  });
  return findings;
}
