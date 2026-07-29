/**
 * Email transport (M11.7) — a zero-dependency Resend REST client behind an
 * env gate. Email is an ADVISORY channel: `send` never throws, and with no
 * API key configured it degrades to a visible no-op so every caller can be
 * wired up (and tested) before the key exists. In-app notifications remain
 * the source of truth; a lost email must never lose information.
 *
 * Config is injected by the caller (web server / pipeline worker) — this
 * module reads no env itself, so it stays pure and testable.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface EmailSendResult {
  sent: boolean;
  /** Resend message id when sent. */
  id?: string;
  /** Why the message was not sent (disabled / API error). */
  reason?: string;
}

export interface EmailSender {
  /** True when a real API key is configured. */
  readonly enabled: boolean;
  send(msg: EmailMessage): Promise<EmailSendResult>;
}

// @credexis/shared is dependency-free (no @types/node, no DOM lib), so the
// Node 18+ global fetch is declared minimally here — just the surface used.
declare const fetch: (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
}>;

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export function createEmailSender(config: {
  /** RESEND_API_KEY — undefined/empty disables sending (no-op sender). */
  apiKey: string | undefined;
  /** RFC 5322 from, e.g. `Credexis <notifications@credexis.co>`. */
  from: string;
}): EmailSender {
  const apiKey = config.apiKey?.trim();
  if (!apiKey) {
    return {
      enabled: false,
      send: async () => ({ sent: false, reason: "email disabled: RESEND_API_KEY not set" }),
    };
  }
  return {
    enabled: true,
    send: async (msg) => {
      try {
        const res = await fetch(RESEND_ENDPOINT, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: config.from,
            to: [msg.to],
            subject: msg.subject,
            html: msg.html,
            text: msg.text,
          }),
        });
        if (!res.ok) {
          const body = (await res.text()).slice(0, 300);
          return { sent: false, reason: `resend ${res.status}: ${body}` };
        }
        const data = (await res.json()) as { id?: string };
        return data.id !== undefined ? { sent: true, id: data.id } : { sent: true };
      } catch (e) {
        return {
          sent: false,
          reason: `resend fetch failed: ${(e as Error).message.slice(0, 200)}`,
        };
      }
    },
  };
}
