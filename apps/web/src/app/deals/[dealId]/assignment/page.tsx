"use client";

/**
 * Document assignment (M6.5): confirm/fix the split & entity suggestions
 * Stage-S made. Every save is one audited mutation; the client renders
 * server truth and edits labels — it never computes (Iron Law #3).
 */

import { useState } from "react";
import { useParams } from "next/navigation";
import { trpc } from "@/lib/trpc/client";
import { ASSIGNABLE_FAMILIES } from "@/lib/form-families";

export default function AssignmentPage() {
  const params = useParams<{ dealId: string }>();
  const dealId = params.dealId;
  const utils = trpc.useUtils();
  const list = trpc.assignment.list.useQuery({ dealId });
  const entities = trpc.assignment.entities.useQuery({ dealId });
  const assign = trpc.assignment.assign.useMutation({
    onSuccess: () => void utils.assignment.list.invalidate({ dealId }),
  });

  // Draft edits keyed by logical document id; unsaved fields only.
  const [drafts, setDrafts] = useState<
    Record<string, { formFamily?: string; taxYear?: string; entityId?: string }>
  >({});

  function setDraft(id: string, patch: Record<string, string>) {
    setDrafts((d) => ({ ...d, [id]: { ...d[id], ...patch } }));
  }

  function save(row: NonNullable<typeof list.data>[number]) {
    const draft = drafts[row.id] ?? {};
    const input: {
      logicalDocumentId: string;
      formFamily?: string;
      taxYear?: number | null;
      entityId?: string | null;
    } = { logicalDocumentId: row.id };

    if (draft.formFamily !== undefined && draft.formFamily !== row.formFamily) {
      input.formFamily = draft.formFamily;
    }
    if (draft.taxYear !== undefined && draft.taxYear !== String(row.taxYear ?? "")) {
      input.taxYear = draft.taxYear === "" ? null : Number(draft.taxYear);
    }
    if (draft.entityId !== undefined && draft.entityId !== (row.entityId ?? "")) {
      input.entityId = draft.entityId === "" ? null : draft.entityId;
    } else if (draft.entityId === undefined && row.entityId && !row.entityConfirmed) {
      // Explicit "Confirm" of the suggested entity with no other edits.
      input.entityId = row.entityId;
    }

    assign.mutate(input, {
      onSuccess: () =>
        setDrafts((d) => {
          const next = { ...d };
          delete next[row.id];
          return next;
        }),
    });
  }

  if (list.isLoading) return <main style={{ padding: 24 }}>Loading…</main>;

  const rows = list.data ?? [];

  return (
    <main style={{ maxWidth: 980, margin: "0 auto", padding: 24, fontFamily: "system-ui" }}>
      <h1 style={{ fontSize: 20 }}>Document assignment</h1>
      <p style={{ fontSize: 13, color: "#6b7280" }}>
        Confirm or fix what the splitter suggested. Every change is audited.
      </p>
      {assign.error && (
        <p style={{ color: "#dc2626", fontSize: 13 }} role="alert">
          {assign.error.message}
        </p>
      )}

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "1px solid #e5e7eb" }}>
            <th style={{ padding: 8 }}>File</th>
            <th style={{ padding: 8 }}>Pages</th>
            <th style={{ padding: 8 }}>Form</th>
            <th style={{ padding: 8 }}>Tax year</th>
            <th style={{ padding: 8 }}>Entity</th>
            <th style={{ padding: 8 }} />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const draft = drafts[row.id] ?? {};
            const family = draft.formFamily ?? row.formFamily;
            const year = draft.taxYear ?? String(row.taxYear ?? "");
            const entityId = draft.entityId ?? row.entityId ?? "";
            const dirty = Object.keys(draft).length > 0;
            return (
              <tr key={row.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                <td style={{ padding: 8 }}>{row.fileName}</td>
                <td style={{ padding: 8, whiteSpace: "nowrap" }}>
                  {row.pageStart}–{row.pageEnd}
                </td>
                <td style={{ padding: 8 }}>
                  <select
                    value={family}
                    onChange={(e) => setDraft(row.id, { formFamily: e.target.value })}
                    style={family === "UNKNOWN" ? { color: "#d97706" } : undefined}
                  >
                    {ASSIGNABLE_FAMILIES.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>
                </td>
                <td style={{ padding: 8 }}>
                  <input
                    value={year}
                    onChange={(e) => setDraft(row.id, { taxYear: e.target.value })}
                    placeholder="—"
                    inputMode="numeric"
                    style={{ width: 64 }}
                  />
                </td>
                <td style={{ padding: 8 }}>
                  <select
                    value={entityId}
                    onChange={(e) => setDraft(row.id, { entityId: e.target.value })}
                  >
                    <option value="">— unassigned —</option>
                    {(entities.data ?? []).map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name} ({e.kind})
                      </option>
                    ))}
                  </select>{" "}
                  {row.entityConfirmed && !dirty && (
                    <span style={{ color: "#059669", fontSize: 12 }}>✓ confirmed</span>
                  )}
                </td>
                <td style={{ padding: 8 }}>
                  <button
                    onClick={() => save(row)}
                    disabled={
                      assign.isPending || (!dirty && (row.entityConfirmed || !row.entityId))
                    }
                  >
                    {dirty ? "Save" : "Confirm"}
                  </button>
                </td>
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={6} style={{ padding: 16, color: "#6b7280" }}>
                No logical documents yet — they appear after uploads finish processing.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </main>
  );
}
