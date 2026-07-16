import { describe, expect, it } from "vitest";
import { formatCents, parseDollarsInput } from "./money-display";

describe("formatCents — string ops only (the client never computes)", () => {
  it.each<[string, string]>([
    ["123456", "$1,234.56"],
    ["-123456", "-$1,234.56"],
    ["5", "$0.05"],
    ["0", "$0.00"],
    ["100000000000", "$1,000,000,000.00"],
    ["9007199254740993", "$90,071,992,547,409.93"], // beyond MAX_SAFE_INTEGER, exact
  ])("%s¢ → %s", (cents, want) => {
    expect(formatCents(cents)).toBe(want);
  });
});

describe("parseDollarsInput — human input → integer-cent string", () => {
  it.each<[string, string | null]>([
    ["36,500.00", "3650000"],
    ["$36,500", "3650000"],
    ["36500.5", "3650050"],
    ["-1,234.56", "-123456"],
    ["0", "0"],
    ["1.234", null], // 3 decimals — reject
    ["abc", null],
    ["", null],
  ])("%j → %j", (input, want) => {
    expect(parseDollarsInput(input)).toBe(want);
  });
});
