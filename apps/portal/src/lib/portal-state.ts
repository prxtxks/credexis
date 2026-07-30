import { z } from "zod";

/**
 * The borrower's entire view of the world (design 05 §10.2/§10.3).
 *
 * Everything on the portal's one screen comes from a single
 * `borrower_portal_state()` call. This module parses that payload and nothing
 * else - the client renders, it never computes (Iron Law #3). There is no
 * metric, no money, no deal status here by construction: unknown keys are
 * stripped, so a future change to the definer cannot leak an internal field
 * into the UI just by adding it to the JSON.
 */

/** The curated vocabulary, exactly. NEVER deals.status. */
export const PORTAL_STATUSES = [
  "collecting",
  "action_needed",
  "received",
  "in_review",
  "complete",
] as const;

export type PortalStatus = (typeof PORTAL_STATUSES)[number];

// .catch() rather than a hard parse failure: if a value outside the curated
// vocabulary ever reaches the portal, the borrower must see a safe curated
// string, not the raw value and not a 500. This is the last gate that keeps
// an internal status string off a borrower's screen.
const statusSchema = z.enum(PORTAL_STATUSES).catch("in_review");

const itemSchema = z.object({
  key: z.string(),
  label: z.string(),
  satisfied: z.boolean().catch(false),
});

const uploadSchema = z.object({
  fileName: z.string(),
  uploadedAt: z.string().nullish(),
  // Two-valued by design: the borrower never learns whether extraction ran,
  // succeeded, or exists.
  state: z.enum(["received", "needs_replacement"]).catch("received"),
});

const requestSchema = z.object({
  id: z.string(),
  note: z.string(),
  createdAt: z.string().nullish(),
});

const portalStateSchema = z.object({
  inviteId: z.string(),
  label: z.string(),
  entityLabel: z.string().nullish(),
  expiresAt: z.string().nullish(),
  status: statusSchema,
  items: z.array(itemSchema).catch([]),
  uploads: z.array(uploadSchema).catch([]),
  requests: z.array(requestSchema).catch([]),
});

export type PortalState = z.infer<typeof portalStateSchema>;
export type PortalItem = z.infer<typeof itemSchema>;
export type PortalUpload = z.infer<typeof uploadSchema>;
export type PortalRequest = z.infer<typeof requestSchema>;

export interface ParsedPortalState {
  invites: PortalState[];
  /** Rows the definer returned that this app could not read - surfaced, not hidden. */
  malformed: number;
}

/**
 * Normalise the definer's jsonb. A borrower usually holds exactly one invite,
 * but nothing in the data model forbids two (two deals, same email), so both
 * a bare object and an array are accepted rather than assumed away.
 */
export function parsePortalState(raw: unknown): ParsedPortalState {
  const rows = raw === null || raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
  const invites: PortalState[] = [];
  let malformed = 0;
  for (const row of rows) {
    const parsed = portalStateSchema.safeParse(row);
    if (parsed.success) invites.push(parsed.data);
    else malformed += 1;
  }
  return { invites, malformed };
}

export const STATUS_COPY: Record<PortalStatus, { label: string; hint: string }> = {
  collecting: {
    label: "Documents needed",
    hint: "Your loan officer is still waiting on the items below.",
  },
  action_needed: {
    label: "Action needed",
    hint: "Your loan officer has asked you for something specific - see the message below.",
  },
  received: {
    label: "Received",
    hint: "We have your documents and are checking them over.",
  },
  in_review: {
    label: "In review",
    hint: "Nothing is needed from you right now.",
  },
  complete: {
    label: "Complete",
    hint: "Everything your loan officer asked for has been received.",
  },
};

/**
 * Fixed locale and UTC: this renders on the server, and a timezone-dependent
 * string would differ from anything the lender sees on the same row.
 */
const DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeZone: "UTC",
});

/** Returns null for anything unparseable so a bad date renders as nothing, not "Invalid Date". */
export function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return DATE_FORMAT.format(new Date(ms));
}
