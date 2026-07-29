import { describe, expect, it } from "vitest";
import { digestEmail, escapeHtml, identityReviewEmail, inviteEmail } from "./templates.js";
import { createEmailSender } from "./transport.js";

describe("email transport", () => {
  it("no key → visible no-op, never a throw", async () => {
    const sender = createEmailSender({ apiKey: undefined, from: "Credexis <n@credexis.co>" });
    expect(sender.enabled).toBe(false);
    const res = await sender.send({ to: "a@b.co", subject: "s", html: "<p/>", text: "t" });
    expect(res.sent).toBe(false);
    expect(res.reason).toContain("RESEND_API_KEY");
  });

  it("empty/whitespace key is disabled too", () => {
    expect(createEmailSender({ apiKey: "  ", from: "x <y@z.co>" }).enabled).toBe(false);
  });
});

describe("email templates", () => {
  it("escapes untrusted document names (extracted text is attacker-controlled)", () => {
    const email = identityReviewEmail({
      title: "Name matches 78% — approve?",
      extractedName: `<script>alert(1)</script> "Smith"`,
      dealName: "Main St & Co <Deal>",
      reviewUrl: "https://app.credexis.co/deals/d1/assignment",
    });
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&lt;script&gt;");
    expect(email.html).toContain("Main St &amp; Co &lt;Deal&gt;");
    // Text part carries the raw name — it's plain text, no HTML context.
    expect(email.text).toContain(`"Smith"`);
    expect(email.text).toContain("https://app.credexis.co/deals/d1/assignment");
  });

  it("invite email carries the accept link in both parts and brand button in html", () => {
    const email = inviteEmail({
      orgName: "Acme Lending",
      role: "underwriter",
      acceptUrl: "https://app.credexis.co/invite/accept?token=abc",
      expiresAtLabel: "in 7 days",
    });
    expect(email.subject).toContain("Acme Lending");
    expect(email.html).toContain("https://app.credexis.co/invite/accept?token=abc");
    expect(email.text).toContain("https://app.credexis.co/invite/accept?token=abc");
    expect(email.html).toContain("linear-gradient(135deg");
  });

  it("escapeHtml covers the five metacharacters", () => {
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
  });

  it("digest lists every item in both parts and escapes untrusted names", () => {
    const email = digestEmail({
      items: [
        { title: "Document processed — 42 facts", dealName: "Acme <Holdings> & Co" },
        { title: "Jane joined the workspace", body: "Role: underwriter", dealName: null },
      ],
      appUrl: "https://app.credexis.co",
    });
    expect(email.subject).toContain("2 updates");
    expect(email.html).toContain("Acme &lt;Holdings&gt; &amp; Co");
    expect(email.html).not.toContain("<Holdings>");
    expect(email.text).toContain("Jane joined the workspace");
    expect(email.text).toContain("Role: underwriter");
  });

  it("digest singularizes a single update", () => {
    const email = digestEmail({ items: [{ title: "One thing" }], appUrl: "https://x.co" });
    expect(email.subject).toContain("1 update");
    expect(email.subject).not.toContain("1 updates");
  });
});
