"use client";

/**
 * Settings → General (ui-17-settings, plan 01 step 11 in the reference's
 * card idiom). Self-scoped profile writes go through profile.update (the
 * update_own_profile definer). The organization card is UI-first per
 * Pratik's 2026-07-30 directive: the fields exist and say plainly that the
 * owner write path (update_org_settings, plan step 16) has not shipped —
 * they never pretend to save.
 */

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc/client";
import { AppShell } from "@/components/app-shell";
import { ROLE_LABEL } from "@/components/account-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SettingsCard } from "@/components/ui/settings-card";

export default function SettingsGeneralPage() {
  const utils = trpc.useUtils();
  const profile = trpc.profile.get.useQuery();
  const update = trpc.profile.update.useMutation({
    onSuccess: () => {
      void utils.profile.get.invalidate();
      toast.success("Settings saved");
    },
    onError: (err) => toast.error(err.message),
  });

  const [fullName, setFullName] = useState("");
  const [orgName, setOrgName] = useState("");
  useEffect(() => {
    if (profile.data) {
      setFullName(profile.data.fullName ?? "");
      setOrgName(profile.data.orgName ?? "");
    }
  }, [profile.data]);

  const nameDirty = profile.data !== undefined && fullName !== (profile.data.fullName ?? "");

  return (
    <AppShell breadcrumb="Settings · General">
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
        <h1 className="text-title">General</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Your profile and this organization&apos;s identity.
        </p>

        <div className="mt-6 space-y-6">
          <SettingsCard
            title="Display name"
            description="How you appear to teammates, in the audit trail, and on borrower-facing mail."
            footer="Shown wherever Credexis names you."
            footerAction={
              <Button
                size="sm"
                disabled={!nameDirty || fullName.trim().length === 0 || update.isPending}
                onClick={() => update.mutate({ fullName: fullName.trim() })}
              >
                <span className="flex items-center gap-1.5">
                  {update.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Save
                </span>
              </Button>
            }
          >
            <Input
              aria-label="Full name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Your name"
              disabled={profile.isLoading}
              className="max-w-sm"
            />
          </SettingsCard>

          <SettingsCard
            title="Identity"
            description="Assigned by your organization — role and workspace changes happen on the Members page."
          >
            <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground text-[13px]">Email</dt>
                <dd className="mt-0.5 font-medium">{profile.data?.email ?? "…"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-[13px]">Role</dt>
                <dd className="mt-0.5 font-medium">
                  {profile.data ? (ROLE_LABEL[profile.data.role] ?? profile.data.role) : "…"}
                </dd>
              </div>
            </dl>
          </SettingsCard>

          <SettingsCard
            title="Organization"
            description="The workspace name your team and borrowers see."
            footer="Editing ships with the owner write path (update_org_settings) — these fields are a preview, not a save."
            footerAction={
              <Button size="sm" disabled>
                Save
              </Button>
            }
          >
            <div className="grid max-w-lg gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="org-name">Organization name</Label>
                <Input
                  id="org-name"
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  disabled={profile.isLoading}
                />
              </div>
            </div>
          </SettingsCard>
        </div>
      </main>
    </AppShell>
  );
}
