"use client";

/**
 * Profile settings (M11.7): name, email-notification preference, password
 * reset. Self-scoped only — writes go through profile.update, which is the
 * update_own_profile() definer (role/status/org are admin-managed on the
 * members page, deliberately absent here).
 */

import { useEffect, useState } from "react";
import { KeyRound, Loader2, Mail, UserRound } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc/client";
import { createClient } from "@/lib/supabase/browser";
import { AppShell } from "@/components/app-shell";
import { ROLE_LABEL } from "@/components/account-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";

export default function SettingsPage() {
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
  const [resetSending, setResetSending] = useState(false);
  useEffect(() => {
    if (profile.data) setFullName(profile.data.fullName ?? "");
  }, [profile.data]);

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

  const nameDirty = profile.data !== undefined && fullName !== (profile.data.fullName ?? "");

  return (
    <AppShell breadcrumb="Settings">
      <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-foreground">Settings</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Your profile and notification preferences.
          </p>
        </div>

        <div className="space-y-4">
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <UserRound className="h-4 w-4 text-primary" />
                Profile
              </CardTitle>
              <CardDescription>
                {profile.data
                  ? `${profile.data.email} · ${ROLE_LABEL[profile.data.role] ?? profile.data.role}${profile.data.orgName ? ` at ${profile.data.orgName}` : ""}`
                  : "…"}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="fullName">Full name</Label>
                <Input
                  id="fullName"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Your name"
                  disabled={profile.isLoading}
                />
              </div>
              <Button
                size="sm"
                disabled={!nameDirty || fullName.trim().length === 0 || update.isPending}
                onClick={() => update.mutate({ fullName: fullName.trim() })}
              >
                <span className="flex items-center gap-1.5">
                  {update.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Save name
                </span>
              </Button>
            </CardContent>
          </Card>

          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Mail className="h-4 w-4 text-primary" />
                Email notifications
              </CardTitle>
              <CardDescription>
                Approvals and document events by email. In-app notifications are always on — email
                is an extra channel, never the only record.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <label className="flex cursor-pointer items-center gap-3 text-sm text-foreground">
                <Switch
                  checked={profile.data?.emailNotifications ?? true}
                  disabled={profile.isLoading || update.isPending}
                  onCheckedChange={(checked) => update.mutate({ emailNotifications: checked })}
                  aria-label="Send me email notifications"
                />
                Send me email notifications
              </label>
            </CardContent>
          </Card>

          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <KeyRound className="h-4 w-4 text-primary" />
                Password
              </CardTitle>
              <CardDescription>
                We&apos;ll email you a secure link to set a new password.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                size="sm"
                variant="outline"
                disabled={resetSending || !profile.data}
                onClick={() => void sendReset()}
              >
                <span className="flex items-center gap-1.5">
                  {resetSending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Send password reset email
                </span>
              </Button>
            </CardContent>
          </Card>
        </div>
      </main>
    </AppShell>
  );
}
