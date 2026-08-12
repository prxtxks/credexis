"use client";

/**
 * Settings → Branding (M17): the bank's identity on every exported
 * workbook. Admin-writable (RLS + adminProcedure agree); everyone can
 * view. Non-technical operators get color pickers and a LIVE preview of
 * the workbook header - what you see here is what the credit committee
 * sees on the file.
 *
 * Logo upload lands with the storage-bucket pass; the card says so
 * honestly instead of offering a dead control.
 */

import { useState } from "react";
import { Loader2, Palette } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc/client";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Pill } from "@/components/ui/pill";
import { SettingsCard } from "@/components/ui/settings-card";
import { Skeleton } from "@/components/ui/skeleton";

const HEX = /^#[0-9a-fA-F]{6}$/;

export default function SettingsBrandingPage() {
  const profile = trpc.profile.get.useQuery();
  const branding = trpc.branding.get.useQuery();
  const utils = trpc.useUtils();
  const save = trpc.branding.save.useMutation({
    onSuccess: () => {
      toast.success("Branding saved - new exports carry it immediately");
      void utils.branding.get.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  // Drafts overlay the stored values; undefined = show stored.
  const [name, setName] = useState<string | undefined>(undefined);
  const [primary, setPrimary] = useState<string | undefined>(undefined);
  const [accent, setAccent] = useState<string | undefined>(undefined);
  const [footer, setFooter] = useState<string | undefined>(undefined);

  const canEdit = profile.data?.role === "org_owner" || profile.data?.role === "admin";
  const d = branding.data;
  const vName = name ?? d?.displayName ?? "";
  const vPrimary = primary ?? d?.primaryColor ?? "#0D7A5F";
  const vAccent = accent ?? d?.accentColor ?? "#134E3A";
  const vFooter = footer ?? d?.footerText ?? "";
  const valid = HEX.test(vPrimary) && HEX.test(vAccent);
  const dirty =
    name !== undefined || primary !== undefined || accent !== undefined || footer !== undefined;

  return (
    <AppShell breadcrumb="Settings">
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-6">
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <Palette className="text-primary h-5 w-5" />
            Branding
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Your bank&apos;s identity on every exported workbook - name, colors, and footer travel
            with the file.
          </p>
        </div>

        {branding.isLoading ? (
          <div className="glass-card space-y-3 rounded-xl p-6">
            <Skeleton className="h-5 w-56" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-2/3" />
          </div>
        ) : (
          <div className="space-y-6">
            <SettingsCard
              title="Export identity"
              description="Applied to every workbook downloaded from a deal."
              footer={
                canEdit ? (
                  <>
                    <span className="text-muted-foreground text-[13px]">
                      Colors are #RRGGBB. Changes apply to the next download - nothing is
                      re-generated retroactively.
                    </span>
                    <Button
                      size="sm"
                      variant="brand"
                      disabled={!dirty || !valid || save.isPending}
                      onClick={() =>
                        save.mutate({
                          displayName: vName,
                          primaryColor: vPrimary,
                          accentColor: vAccent,
                          footerText: vFooter,
                        })
                      }
                    >
                      {save.isPending ? (
                        <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                      ) : null}
                      Save branding
                    </Button>
                  </>
                ) : (
                  <span className="text-muted-foreground text-[13px]">
                    Only admins can change branding.
                  </span>
                )
              }
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="brand-name">Institution name</Label>
                  <Input
                    id="brand-name"
                    value={vName}
                    disabled={!canEdit}
                    placeholder="First National Bank"
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
                <ColorField
                  id="brand-primary"
                  label="Primary color"
                  hint="Sheet headers"
                  value={vPrimary}
                  disabled={!canEdit}
                  onChange={setPrimary}
                />
                <ColorField
                  id="brand-accent"
                  label="Accent color"
                  hint="Title rows"
                  value={vAccent}
                  disabled={!canEdit}
                  onChange={setAccent}
                />
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="brand-footer">Footer text</Label>
                  <Input
                    id="brand-footer"
                    value={vFooter}
                    disabled={!canEdit}
                    placeholder="Confidential - prepared for internal credit review"
                    onChange={(e) => setFooter(e.target.value)}
                  />
                </div>
              </div>
            </SettingsCard>

            {/* ── Live preview: the workbook header, as Excel will show it ── */}
            <section>
              <h2 className="text-heading mb-3 flex items-center gap-2">
                Preview
                <Pill tone="accent">live</Pill>
              </h2>
              <div className="glass-card overflow-hidden rounded-xl">
                <div className="px-5 py-4" style={{ backgroundColor: vAccent }}>
                  <p className="text-[15px] font-semibold text-white">
                    {vName.trim() === "" ? "Your institution" : vName} - Credit spread
                  </p>
                  <p className="text-[11px] text-white/70">Travelodge Merrill acquisition</p>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr
                      className="text-left text-[13px] text-white"
                      style={{ backgroundColor: vPrimary }}
                    >
                      <th className="px-4 py-2 font-medium">Line item</th>
                      <th className="px-4 py-2 text-right font-medium">FY2023</th>
                      <th className="px-4 py-2 text-right font-medium">FY2024</th>
                    </tr>
                  </thead>
                  <tbody className="divide-border/70 divide-y">
                    <tr>
                      <td className="text-muted-foreground px-4 py-2">Total revenue</td>
                      <td className="px-4 py-2 text-right tabular-nums">346,865.00</td>
                      <td className="px-4 py-2 text-right tabular-nums">385,981.00</td>
                    </tr>
                    <tr>
                      <td className="text-muted-foreground px-4 py-2">Net operating income</td>
                      <td className="px-4 py-2 text-right tabular-nums">99,821.00</td>
                      <td className="px-4 py-2 text-right tabular-nums">112,304.00</td>
                    </tr>
                  </tbody>
                </table>
                {vFooter.trim() !== "" ? (
                  <p className="text-muted-foreground border-border/70 border-t px-4 py-2 text-[11px]">
                    {vFooter}
                  </p>
                ) : null}
              </div>
            </section>

            <SettingsCard
              title="Logo"
              description="Placed on the workbook's title block."
              footer={
                <span className="text-muted-foreground text-[13px]">
                  Logo upload arrives with the storage pass - the slot in the export is already
                  reserved.
                </span>
              }
            >
              <div className="border-border text-muted-foreground flex h-20 items-center justify-center rounded-lg border border-dashed text-[13px]">
                <span className="flex items-center gap-2">
                  Logo upload
                  <Pill tone="accent">Soon</Pill>
                </span>
              </div>
            </SettingsCard>
          </div>
        )}
      </main>
    </AppShell>
  );
}

function ColorField({
  id,
  label,
  hint,
  value,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  value: string;
  disabled: boolean;
  onChange: (v: string) => void;
}) {
  const valid = HEX.test(value);
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>
        {label} <span className="text-muted-foreground font-normal">- {hint}</span>
      </Label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} picker`}
          value={valid ? value : "#000000"}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className="border-border h-9 w-12 cursor-pointer rounded-md border bg-transparent p-1"
        />
        <Input
          id={id}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={!valid}
          className="w-32 font-mono text-[13px]"
        />
      </div>
    </div>
  );
}
