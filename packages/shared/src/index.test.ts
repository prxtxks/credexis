import { describe, expect, it } from "vitest";
import { SHARED_PACKAGE } from "./index.js";

describe("@credexis/shared", () => {
  it("exposes its package identifier", () => {
    expect(SHARED_PACKAGE).toBe("@credexis/shared");
  });
});
