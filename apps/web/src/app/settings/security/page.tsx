"use client";

/**
 * Settings → Security (ui-17-settings; delivers the real half of plan 01
 * step 12 and maps the rest).
 *
 * REAL today: in-app password change (supabase.auth.updateUser), password
 * reset email, sign-out-everywhere (signOut scope:'others'), and the audit
 * CSV export (pages through audit.list — admin-gated by the same policy as
 * the viewer).
 *
 * UI-first (honest, disabled): TOTP enrollment (step 13) and org-wide 2FA
 * enforcement (Tier 3). A per-device session list is deliberately NOT
 * offered: it needs the auth admin API, which Iron Law #7 bars from a
 * request path — we say so rather than fake a device list.
 */

import { useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc/client";
import { createClient } from "@/lib/supabase/browser";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SettingsCard } from "@/components/ui/settings-card";
import { Switch } from "@/components/ui/switch";

export default function SettingsSecurityPage() {
  const profile = trpc.profile.get.useQuery();
  const utils = trpc.useUtils();

  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [pwSaving, setPwSaving] = useState(false);
  const [resetSending, setResetSending] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [exporting, setExporting] = useState(false);

  async function changePassword() {
    if (pw.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }
    if (pw !== pw2) {
      toast.error("Passwords do not match");
      return;
    }
    setPwSaving(true);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password: pw });
    setPwSaving(false);
    if (error) toast.error(error.message);
    else {
      setPw("");
      setPw2("");
      toast.success("Password changed");
    }
  }

  async function sendReset() {
    const email = profile.data?.email;
    if (!email) return;
    setResetSending(true);
    const supabase = createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/auth/reset-password`,
    });
    setResetSending(false);
    if (error) toast.error(error.message);
    else toast.success(`Password reset link sent to ${email}`);
  }

  async function signOutEverywhere() {
    setSigningOut(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signOut({ scope: "others" });
    setSigningOut(false);
    if (error) toast.error(error.message);
    else toast.success("Signed out on every other device");
  }

  /** Page through audit.list and download a CSV — client string work only. */
  async function exportAuditCsv() {
    setExporting(true);
    try {
      const rows: string[] = ["id,created_at,actor_id,action,table_name,row_id"];
      let cursor: string | null | undefined = undefined;
      for (let page = 0; page < 10; page++) {
        const res = await utils.audit.list.fetch({ limit: 100, cursor });
        for (const e of res.entries) {
          const cells = [e.id, e.createdAt, e.actorId ?? "", e.action, e.tableName, e.rowId ?? ""];
          rows.push(cells.map((c) => `"${String(c).replaceAll('"', '""')}"`).join(","));
        }
        if (!res.nextCursor) break;
        cursor = res.nextCursor;
      }
      const blob = new Blob([rows.join("\n")], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `credexis-audit-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`Exported ${rows.length - 1} audit rows`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed — audit access is admin-gated");
    } finally {
      setExporting(false);
    }
  }

  return (
    <AppShell breadcrumb="Settings · Security">
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
        <h1 className="text-title">Security</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Credentials, sessions, and the audit trail.
        </p>

        <div className="mt-6 space-y-6">
          <SettingsCard
            title="Password"
            description="Set a new password for your account, or have a secure link emailed instead."
            footer={
              <button
                type="button"
                onClick={() => void sendReset()}
                disabled={resetSending || !profile.data}
                className="hover:text-foreground underline underline-offset-2 transition-colors duration-150 disabled:opacity-50"
              >
                {resetSending ? "Sending…" : "Email me a reset link instead"}
              </button>
            }
            footerAction={
              <Button
                size="sm"
                disabled={pwSaving || pw.length === 0 || pw2.length === 0}
                onClick={() => void changePassword()}
              >
                <span className="flex items-center gap-1.5">
                  {pwSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Change password
                </span>
              </Button>
            }
          >
            <div className="grid max-w-lg gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="new-password">New password</Label>
                <Input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  value={pw}
                  onChange={(e) => setPw(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirm-password">Confirm</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  value={pw2}
                  onChange={(e) => setPw2(e.target.value)}
                />
              </div>
            </div>
          </SettingsCard>

          <SettingsCard
            title="Sessions"
            description="Signing out everywhere invalidates every session except this one on its next request. A per-device list is not offered — it would need the auth admin API in a request path, which our security rules forbid."
            footerAction={
              <Button
                size="sm"
                variant="outline"
                disabled={signingOut}
                onClick={() => void signOutEverywhere()}
              >
                <span className="flex items-center gap-1.5">
                  {signingOut && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Sign out everywhere else
                </span>
              </Button>
            }
          />

          <SettingsCard
            title="Two-factor authentication"
            description="Require a one-time code from an authenticator app at sign-in."
            footer="TOTP enrollment ships next (m12-3-mfa-enroll); org-wide enforcement follows it."
            footerAction={
              <Button size="sm" disabled>
                <span className="flex items-center gap-1.5">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Set up authenticator
                </span>
              </Button>
            }
          >
            <div className="flex items-center gap-3">
              <Switch
                checked={false}
                disabled
                aria-label="Two-factor authentication (not yet available)"
              />
              <span className="text-muted-foreground text-sm">Not enrolled</span>
            </div>
          </SettingsCard>

          <SettingsCard
            title="Export audit log"
            description="Download your organization's activity as CSV — every recorded change with actor, action, and row. Reading the audit trail is admin-gated."
            footer="Exports the most recent 1,000 rows; the full trail lives in the Audit log page."
            footerAction={
              <Button
                size="sm"
                variant="outline"
                disabled={exporting}
                onClick={() => void exportAuditCsv()}
              >
                <span className="flex items-center gap-1.5">
                  {exporting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Export CSV
                </span>
              </Button>
            }
          />

          <SettingsCard
            title="Data retention"
            description="How long completed deals keep their documents."
            footer="A contract term, not a config default — the retention window (decision D6) must be written down before this becomes editable, because it collides with the append-only audit log."
          >
            <div className="text-muted-foreground text-sm">
              Documents and facts are retained indefinitely today; nothing is auto-deleted.
            </div>
          </SettingsCard>
        </div>
      </main>
    </AppShell>
  );
}
