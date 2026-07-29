/**
 * Email templates (M11.7) — pure string builders, rendered SERVER-SIDE from
 * event data only (B1 discipline: nothing client-supplied reaches a template
 * unescaped, and templates never fetch). Brand: Geist-first font stack and
 * the credexis.co emerald gradient button. Every template returns subject +
 * html + text so plain-text clients lose nothing.
 *
 * All URLs must arrive ABSOLUTE (caller prefixes the configured app base
 * URL) — emails cannot use the app-relative action_url convention.
 */

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/** Untrusted strings (names printed on documents, org names) must pass here. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const FONT_STACK =
  "'Geist','Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/** The credexis.co button: emerald 135° gradient, 10px radius, semibold. */
const BUTTON_STYLE = [
  "display:inline-block",
  "padding:10px 22px",
  "border-radius:10px",
  "background:linear-gradient(135deg,#059669 0%,#047857 100%)",
  "color:#ffffff",
  "font-size:14px",
  "font-weight:600",
  "text-decoration:none",
].join(";");

function layout(opts: {
  heading: string;
  /** Pre-escaped HTML body paragraphs. */
  bodyHtml: string;
  cta?: { label: string; url: string };
}): string {
  const cta = opts.cta
    ? `<tr><td style="padding:20px 0 4px 0;">
         <a href="${opts.cta.url}" style="${BUTTON_STYLE}">${escapeHtml(opts.cta.label)}</a>
       </td></tr>`
    : "";
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f6f8f7;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f8f7;padding:32px 16px;">
      <tr><td align="center">
        <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;background:#ffffff;border:1px solid #e5eae8;border-radius:14px;padding:32px;font-family:${FONT_STACK};">
          <tr><td style="font-size:15px;font-weight:700;letter-spacing:-0.02em;color:#065f46;padding-bottom:20px;">Credexis</td></tr>
          <tr><td style="font-size:18px;font-weight:600;color:#111827;padding-bottom:12px;">${opts.heading}</td></tr>
          <tr><td style="font-size:14px;line-height:1.6;color:#374151;">${opts.bodyHtml}</td></tr>
          ${cta}
          <tr><td style="padding-top:28px;font-size:12px;color:#9ca3af;">You can turn email notifications off in Settings. In-app notifications always remain available.</td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

/** Member invite: the one-time accept link IS the claim — treat like a password. */
export function inviteEmail(opts: {
  orgName: string;
  role: string;
  acceptUrl: string;
  expiresAtLabel: string;
}): RenderedEmail {
  const org = escapeHtml(opts.orgName);
  const role = escapeHtml(opts.role);
  const subject = `You're invited to ${opts.orgName} on Credexis`;
  return {
    subject,
    html: layout({
      heading: `Join ${org} on Credexis`,
      bodyHtml: `You've been invited to join <strong>${org}</strong> as <strong>${role}</strong>. This link is single-use and expires ${escapeHtml(opts.expiresAtLabel)}.`,
      cta: { label: "Accept invitation", url: opts.acceptUrl },
    }),
    text: `You've been invited to join ${opts.orgName} on Credexis as ${opts.role}.\n\nAccept (single-use, expires ${opts.expiresAtLabel}):\n${opts.acceptUrl}\n\nYou can turn email notifications off in Settings.`,
  };
}

/** Identity review (approval-class → sent immediately): mirrors the in-app card. */
export function identityReviewEmail(opts: {
  title: string;
  extractedName: string;
  dealName: string;
  reviewUrl: string;
}): RenderedEmail {
  const name = escapeHtml(opts.extractedName);
  const deal = escapeHtml(opts.dealName);
  return {
    subject: `${opts.title} — ${opts.dealName}`,
    html: layout({
      heading: escapeHtml(opts.title),
      bodyHtml: `A document on <strong>${deal}</strong> is printed with the name <strong>&ldquo;${name}&rdquo;</strong>, which doesn't fully match the deal's entities. Please approve or reject the match — extraction stays advisory until a human decides.`,
      cta: { label: "Review the match", url: opts.reviewUrl },
    }),
    text: `${opts.title}\n\nA document on ${opts.dealName} is printed with the name "${opts.extractedName}", which doesn't fully match the deal's entities. Approve or reject the match:\n${opts.reviewUrl}\n\nYou can turn email notifications off in Settings.`,
  };
}
