/**
 * Support-case store (ui-19): cases persist in THIS BROWSER until a case
 * backend exists - the UI says so wherever cases render.
 */
export interface SupportCase {
  id: string;
  title: string;
  topic: string;
  severity: string;
  transcript: string[];
  status: "open" | "closed";
  createdAt: string;
}

export const CASES_KEY = "credexis-support-cases";

export function readCases(): SupportCase[] {
  try {
    return JSON.parse(localStorage.getItem(CASES_KEY) ?? "[]") as SupportCase[];
  } catch {
    return [];
  }
}
