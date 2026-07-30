/**
 * Audit log reads (m12-3-audit-viewer, plan 01 §5 step 4).
 *
 * Two queries and no mutation, by construction: `audit_log` is append-only
 * at the database - 0004_audit-writer.sql revokes insert/update/delete from
 * `authenticated`, and rows are born only inside the `audit_record()`
 * trigger - so there is nothing for a write procedure here to do.
 *
 * Both are `adminProcedure`, matching migration 0032: audit_log_select now
 * requires admin tier, because the audit log was previously READABLE BY
 * VIEWERS while the invites table it records requires tier 3 - invitee
 * emails, granted roles and token hashes leaked through audit rows. RLS is
 * still the boundary; the procedure tier exists so a viewer gets an honest
 * FORBIDDEN instead of an empty table that looks like "no activity".
 *
 * Scoping belongs to the
 * policy, not to this file: `audit_log_select` (0001_rls-v1.sql:285-286)
 * already restricts every row to the caller's tenant, and
 * `verify_audit_chain()` is SECURITY INVOKER, so it can only verify rows the
 * caller could already read. A role gate here would be a second, silently
 * drifting copy of a policy that already exists. Narrowing WHO may read
 * (Pratik decision D4) is a policy change - plan §5 step 17.
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, router } from "../init";

/**
 * `before::text` / `after::text` ask Postgres for the payload as JSON TEXT
 * instead of letting supabase-js `JSON.parse` it. A parsed payload turns
 * every `value_cents` bigint inside an audited row into a JS number (Iron
 * Law #2), and re-serializing it would rewrite the record the log exists to
 * preserve. `id::text` is the same defence for the bigserial cursor.
 */
const AUDIT_COLUMNS =
  "id::text, created_at, actor_id, action, table_name, row_id, before::text, after::text, prev_hash, row_hash";

interface AuditRow {
  id: string;
  created_at: string;
  actor_id: string | null;
  action: string;
  table_name: string;
  row_id: string;
  before: string | null;
  after: string | null;
  prev_hash: string | null;
  row_hash: string | null;
}

export const auditRouter = router({
  /**
   * Newest-first page of the caller's tenant audit trail.
   *
   * Keyset, never offset. `id` is bigserial and strictly increasing, so
   * `id < cursor` walks a stable window backwards. Offset paging would
   * reshuffle every page each time a new row lands mid-scroll - and on an
   * append-only table that a live pipeline writes to, that is constantly.
   */
  list: adminProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(100).default(50),
        /** The `id` of the last row of the previous page (bigserial as text). */
        cursor: z.string().regex(/^\d+$/).nullish(),
        action: z.string().trim().min(1).max(64).optional(),
        tableName: z.string().trim().min(1).max(64).optional(),
        actorId: z.string().uuid().optional(),
        /** Inclusive lower bound on `created_at`; date-only is read as UTC midnight. */
        since: z
          .union([z.string().datetime({ offset: true }), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)])
          .optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      let query = ctx.supabase
        .from("audit_log")
        .select(AUDIT_COLUMNS)
        .order("id", { ascending: false })
        // One extra row is the cheapest "is there a next page?" - a count
        // would make every page a second full scan of a growing table.
        .limit(input.limit + 1);

      if (input.action !== undefined) query = query.eq("action", input.action);
      if (input.tableName !== undefined) query = query.eq("table_name", input.tableName);
      if (input.actorId !== undefined) query = query.eq("actor_id", input.actorId);
      if (input.since !== undefined) query = query.gte("created_at", input.since);
      if (input.cursor !== undefined && input.cursor !== null) {
        query = query.lt("id", input.cursor);
      }

      const { data, error } = await query;
      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });

      const rows = (data ?? []) as unknown as AuditRow[];
      const hasMore = rows.length > input.limit;
      const page = hasMore ? rows.slice(0, input.limit) : rows;
      const last = page[page.length - 1];

      return {
        entries: page.map((r) => ({
          id: r.id,
          createdAt: r.created_at,
          actorId: r.actor_id,
          action: r.action,
          tableName: r.table_name,
          rowId: r.row_id,
          /** Raw JSON text exactly as Postgres stored it - see AUDIT_COLUMNS. */
          before: r.before,
          after: r.after,
          prevHash: r.prev_hash,
          rowHash: r.row_hash,
        })),
        nextCursor: hasMore && last ? last.id : null,
      };
    }),

  /**
   * Walk the tenant's sha256 chain and report the first broken link.
   *
   * An empty result set means intact. `verifiedFromInstallOnly` is not a
   * flag the caller may ignore: rows predating 0024 were backfilled, and a
   * backfilled hash attests to the row as it exists NOW, not to what was
   * written then (0024_audit-hash-chain.sql:10-15).
   */
  verifyChain: adminProcedure.query(async ({ ctx }) => {
    const { data, error } = await ctx.supabase.rpc("verify_audit_chain", {
      p_tenant: ctx.profile.tenantId,
    });
    if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });

    const breaks = (data ?? []) as { broken_at: string | number | null; reason: string | null }[];
    const first = breaks[0];
    return {
      intact: first === undefined,
      brokenAt: first === undefined ? null : String(first.broken_at),
      reason: first === undefined ? null : (first.reason ?? "unspecified"),
      /** True until the pre-0024 backfill is provable, which it never will be. */
      verifiedFromInstallOnly: true,
    };
  }),
});
