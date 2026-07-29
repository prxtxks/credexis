"use client";

/**
 * Document assignment (M6.5): confirm/fix the split & entity suggestions
 * Stage-S made. Every save is one audited mutation; the client renders
 * server truth and edits labels — it never computes (Iron Law #3).
 *
 * V1 restyle (ui-3): mounted under the frosted AppHeader (back → workspace,
 * breadcrumb = deal name) over the gradient mesh; the picker table lives in a
 * glass Card using the shadcn Table primitives. Native <select>s keep the
 * draft/save behavior byte-for-byte and avoid Radix-portal test flakiness.
 */

import { useState } from "react";
import { useParams } from "next/navigation";
import { AlertCircle, Check, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc/client";
import { ASSIGNABLE_FAMILIES } from "@/lib/form-families";
import { AppHeader } from "@/components/app-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

export default function AssignmentPage() {
  const params = useParams<{ dealId: string }>();
  const dealId = params.dealId;
  const utils = trpc.useUtils();
  const deal = trpc.deals.get.useQuery({ dealId });
  const list = trpc.assignment.list.useQuery({ dealId });
  const entities = trpc.assignment.entities.useQuery({ dealId });
  const assign = trpc.assignment.assign.useMutation({
    onSuccess: () => void utils.assignment.list.invalidate({ dealId }),
    onError: (err) => toast.error(err.message),
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

  const rows = list.data ?? [];

  return (
    <div className="gradient-mesh min-h-screen">
      <AppHeader
        backHref={`/deals/${dealId}/workspace`}
        backLabel="Back to workspace"
        breadcrumb={deal.data?.name ?? "Deal"}
        badges={["Assignment"]}
      />

      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-6">
          <h1 className="flex items-center gap-2 text-xl font-semibold text-foreground">
            <FileText className="h-5 w-5 text-primary" />
            Document assignment
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Confirm or fix what the splitter suggested. Every change is audited.
          </p>
        </div>

        {assign.error && (
          <div
            role="alert"
            className="mb-4 flex items-center gap-2 rounded-lg border border-severity-critical/30 bg-severity-critical/10 px-3 py-2 text-sm text-severity-critical"
          >
            <AlertCircle className="h-4 w-4 shrink-0" />
            {assign.error.message}
          </div>
        )}

        {list.isLoading ? (
          <div className="glass-card flex items-center justify-center rounded-xl py-16">
            <div className="grid-loader">
              <span />
              <span />
              <span />
              <span />
              <span />
              <span />
              <span />
              <span />
              <span />
            </div>
          </div>
        ) : (
          <div className="glass-card overflow-x-auto rounded-xl p-2">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>File</TableHead>
                  <TableHead>Pages</TableHead>
                  <TableHead>Form</TableHead>
                  <TableHead>Tax year</TableHead>
                  <TableHead>Entity</TableHead>
                  <TableHead className="text-right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const draft = drafts[row.id] ?? {};
                  const family = draft.formFamily ?? row.formFamily;
                  const year = draft.taxYear ?? String(row.taxYear ?? "");
                  const entityId = draft.entityId ?? row.entityId ?? "";
                  const dirty = Object.keys(draft).length > 0;
                  return (
                    <TableRow key={row.id}>
                      <TableCell className="font-medium">{row.fileName}</TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
                        {row.pageStart}–{row.pageEnd}
                      </TableCell>
                      <TableCell>
                        <select
                          value={family}
                          onChange={(e) => setDraft(row.id, { formFamily: e.target.value })}
                          className={cn(
                            "h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                            family === "UNKNOWN" &&
                              "text-severity-warning ring-1 ring-severity-warning",
                          )}
                        >
                          {ASSIGNABLE_FAMILIES.map((f) => (
                            <option key={f} value={f}>
                              {f}
                            </option>
                          ))}
                        </select>
                      </TableCell>
                      <TableCell>
                        <Input
                          value={year}
                          onChange={(e) => setDraft(row.id, { taxYear: e.target.value })}
                          placeholder="—"
                          inputMode="numeric"
                          className="w-16"
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <select
                            value={entityId}
                            onChange={(e) => setDraft(row.id, { entityId: e.target.value })}
                            className="h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <option value="">— unassigned —</option>
                            {(entities.data ?? []).map((e) => (
                              <option key={e.id} value={e.id}>
                                {e.name} ({e.kind})
                              </option>
                            ))}
                          </select>
                          {row.entityConfirmed && !dirty && (
                            <span className="flex items-center gap-1 whitespace-nowrap text-xs font-medium text-primary">
                              <Check className="h-3.5 w-3.5" />✓ confirmed
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant={dirty ? "default" : "outline"}
                          onClick={() => save(row)}
                          disabled={
                            assign.isPending || (!dirty && (row.entityConfirmed || !row.entityId))
                          }
                        >
                          {assign.isPending && (
                            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                          )}
                          {dirty ? "Save" : "Confirm"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                      No logical documents yet — they appear after uploads finish processing.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </main>
    </div>
  );
}
