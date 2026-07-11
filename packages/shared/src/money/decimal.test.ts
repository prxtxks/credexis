import { describe, expect, it } from "vitest";
import { cents } from "./cents.js";
import {
  compareDecimal,
  divideCentsToDecimal,
  formatDecimal,
  makeDecimal,
  rescaleDecimal,
} from "./decimal.js";

describe("makeDecimal / scale validation", () => {
  it("constructs a fixed-point decimal", () => {
    const d = makeDecimal(115n, 2);
    expect(d.mantissa).toBe(115n);
    expect(d.scale).toBe(2);
  });

  it("rejects a negative scale", () => {
    expect(() => makeDecimal(1n, -1)).toThrow(RangeError);
  });

  it("rejects a non-integer scale", () => {
    expect(() => makeDecimal(1n, 1.5)).toThrow(RangeError);
  });
});

describe("divideCentsToDecimal — DSCR / LTV workhorse", () => {
  it("computes a clean DSCR to 2dp", () => {
    // CFADS $1,150.00 / debt service $1,000.00 = 1.15.
    const dscr = divideCentsToDecimal(cents(115000n), cents(100000n), 2);
    expect(formatDecimal(dscr)).toBe("1.15");
  });

  it("rounds the last place with banker's rounding", () => {
    // 100 / 3 at scale 2 → 33.33.
    expect(formatDecimal(divideCentsToDecimal(cents(100n), cents(3n), 2))).toBe("33.33");
  });

  it("throws on a zero denominator", () => {
    expect(() => divideCentsToDecimal(cents(1n), cents(0n), 2)).toThrow(RangeError);
  });

  it("validates the scale argument", () => {
    expect(() => divideCentsToDecimal(cents(1n), cents(1n), -2)).toThrow(RangeError);
  });
});

describe("rescaleDecimal", () => {
  it("is identity at the same scale", () => {
    const d = makeDecimal(115n, 2);
    expect(rescaleDecimal(d, 2)).toBe(d);
  });

  it("scales up without loss", () => {
    expect(rescaleDecimal(makeDecimal(115n, 2), 4).mantissa).toBe(11500n);
  });

  it("scales down with banker's rounding", () => {
    // 1.155 → 1.16 (half up to even), 1.145 → 1.14 (half down to even).
    expect(rescaleDecimal(makeDecimal(1155n, 3), 2).mantissa).toBe(116n);
    expect(rescaleDecimal(makeDecimal(1145n, 3), 2).mantissa).toBe(114n);
  });

  it("validates the target scale", () => {
    expect(() => rescaleDecimal(makeDecimal(1n, 2), -1)).toThrow(RangeError);
  });
});

describe("compareDecimal", () => {
  it("compares across differing scales, in either scale order", () => {
    expect(compareDecimal(makeDecimal(115n, 2), makeDecimal(1150n, 3))).toBe(0);
    expect(compareDecimal(makeDecimal(114n, 2), makeDecimal(1150n, 3))).toBe(-1);
    expect(compareDecimal(makeDecimal(116n, 2), makeDecimal(1150n, 3))).toBe(1);
    // First operand carries the larger scale (covers the other common-scale branch).
    expect(compareDecimal(makeDecimal(1150n, 3), makeDecimal(115n, 2))).toBe(0);
    expect(compareDecimal(makeDecimal(1160n, 3), makeDecimal(115n, 2))).toBe(1);
  });
});

describe("formatDecimal", () => {
  it("formats scale-0 values without a point", () => {
    expect(formatDecimal(makeDecimal(42n, 0))).toBe("42");
  });

  it("pads a leading zero for values below one", () => {
    expect(formatDecimal(makeDecimal(7n, 2))).toBe("0.07");
  });

  it("formats negatives", () => {
    expect(formatDecimal(makeDecimal(-7n, 2))).toBe("-0.07");
    expect(formatDecimal(makeDecimal(-42n, 0))).toBe("-42");
  });
});
