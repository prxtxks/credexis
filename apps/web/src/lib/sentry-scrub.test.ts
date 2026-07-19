import { describe, expect, it } from "vitest";
import { scrubEvent } from "./sentry-scrub";

describe("Sentry PII scrub (M10.3 verification)", () => {
  it("strips request payloads, cookies, headers, and user identity", () => {
    const event = scrubEvent({
      request: {
        url: "https://app/api/upload",
        data: { ssn: "123-45-6789" },
        cookies: { sb: "token" },
        headers: { authorization: "Bearer x" },
      },
      user: { email: "someone@bank.com" },
    });
    expect(event.request).toEqual({ url: "https://app/api/upload" });
    expect(event.user).toBeUndefined();
  });

  it("passes through events with no request block", () => {
    expect(scrubEvent({ message: "boom" } as never)).toEqual({ message: "boom" });
  });
});
