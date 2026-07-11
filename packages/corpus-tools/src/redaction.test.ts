import { describe, expect, it } from "vitest";
import { maskPii, scanPii } from "./redaction.js";

describe("scanPii", () => {
  it("finds a formatted SSN with its page number", () => {
    const findings = scanPii(["no pii here", "Employee SSN: 123-45-6789 wages 50000"]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ kind: "ssn", page: 2, severity: "definite" });
  });

  it("finds a formatted EIN", () => {
    const findings = scanPii(["Employer ID: 12-3456789"]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ kind: "ein", page: 1, severity: "definite" });
  });

  it("flags a bare 9-digit run as possible", () => {
    const findings = scanPii(["account 123456789 balance"]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ kind: "nine_digits", severity: "possible" });
  });

  it("does not flag amounts, years, or shorter/longer digit runs", () => {
    const findings = scanPii(["Revenue 1250000 in FY2023, ZIP 94103, phone 4155551212"]);
    expect(findings).toHaveLength(0);
  });

  it("masks all but the last four characters in output", () => {
    const findings = scanPii(["123-45-6789"]);
    expect(findings[0]?.masked).toBe("***-**-6789");
    expect(findings[0]?.masked).not.toContain("123");
  });

  it("reports multiple findings across pages", () => {
    const findings = scanPii(["12-3456789", "", "123-45-6789 and 987654321"]);
    expect(findings.map((f) => [f.kind, f.page])).toEqual([
      ["ein", 1],
      ["ssn", 3],
      ["nine_digits", 3],
    ]);
  });

  it("returns empty for an empty document", () => {
    expect(scanPii([])).toEqual([]);
  });
});

describe("maskPii", () => {
  it("keeps only the trailing four characters", () => {
    expect(maskPii("12-3456789")).toBe("**-***6789");
  });
});
