"use client";

/**
 * Members & invites (M11.3, design 01 §4): the delegated-access surface.
 * The DB tier lattice (0013) is the enforcement; this page is honest UX
 * over it — denied actions surface as errors, never silent no-ops.
 * Invite delivery is copy-the-link pre-pilot: the raw token is shown once.
 */

import { useState } from "react";
import { Copy, ShieldCheck, UserPlus, UserX } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc/client";
import { AppHeader } from "@/components/app-header";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const ROLE_LABEL: Record<string, string> = {
  org_owner: "Owner",
  admin: "Admin",
  underwriter: "Underwriter",
  viewer: "Viewer",
};
const GRANTABLE = ["admin", "underwriter", "viewer"] as const;

export default function MembersPage() {
  const utils = trpc.useUtils();
  const me = trpc.me.useQuery();
  const members = trpc.members.list.useQuery();
  const invites = trpc.invites.list.useQuery(undefined, { retry: false });

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<(typeof GRANTABLE)[number]>("underwriter");
  const [inviteLink, setInviteLink] = useState<string | null>(null);

  const refresh = () => {
    void utils.members.list.invalidate();
    void utils.invites.list.invalidate();
  };
  const createInvite = trpc.invites.create.useMutation({
    onSuccess: (r) => {
      setInviteLink(`${window.location.origin}/invite/accept?token=${r.token}`);
      setEmail("");
      refresh();
      toast.success("Invite created — copy the link below and send it");
    },
    onError: (e) => toast.error(e.message),
  });
  const revoke = trpc.invites.revoke.useMutation({
    onSuccess: () => {
      refresh();
      toast.success("Invite revoked");
    },
    onError: (e) => toast.error(e.message),
  });
  const setMemberRole = trpc.members.setRole.useMutation({
    onSuccess: () => {
      refresh();
      toast.success("Role updated");
    },
    onError: (e) => toast.error(e.message),
  });
  const setStatus = trpc.members.setStatus.useMutation({
    onSuccess: (r) => {
      refresh();
      toast.success(r.status === "deactivated" ? "Member deactivated" : "Member reactivated");
    },
    onError: (e) => toast.error(e.message),
  });

  const canManage = me.data?.role === "admin" || me.data?.role === "org_owner";
  const pending = (invites.data ?? []).filter((i) => !i.acceptedAt && !i.revokedAt);

  return (
    <div className="gradient-mesh min-h-screen">
      <AppHeader backHref="/" backLabel="Back to deals" tagline="Organization" />
      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        <PageHeader
          title="Members & invites"
          description="Delegated access on the role lattice — originators originate, underwriters decide."
        />

        {canManage ? (
          <section className="glass-card mb-6 rounded-xl p-4">
            <h2 className="mb-3 text-sm font-semibold">Invite a member</h2>
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-56 flex-1 space-y-1.5">
                <Label htmlFor="invite-email">Email</Label>
                <Input
                  id="invite-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="teammate@bank.com"
                  className="bg-background/50"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="invite-role">Role</Label>
                <select
                  id="invite-role"
                  value={role}
                  onChange={(e) => setRole(e.target.value as (typeof GRANTABLE)[number])}
                  className="border-input h-9 rounded-lg border bg-background/50 px-3 text-sm"
                >
                  {GRANTABLE.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABEL[r]}
                    </option>
                  ))}
                </select>
              </div>
              <Button
                onClick={() => createInvite.mutate({ email, role })}
                disabled={createInvite.isPending || !email.includes("@")}
              >
                <UserPlus className="h-4 w-4" />
                Create invite
              </Button>
            </div>
            {inviteLink ? (
              <div className="mt-3 flex items-center gap-2 rounded-lg bg-muted p-2.5">
                <code className="min-w-0 flex-1 truncate font-mono text-xs">{inviteLink}</code>
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => {
                    void navigator.clipboard.writeText(inviteLink);
                    toast.success("Link copied");
                  }}
                >
                  <Copy className="h-3 w-3" />
                  Copy
                </Button>
              </div>
            ) : null}
          </section>
        ) : null}

        <section className="glass-card rounded-xl p-4">
          <h2 className="mb-3 text-sm font-semibold">Members ({(members.data ?? []).length})</h2>
          <div className="divide-y divide-border/60">
            {(members.data ?? []).map((m) => (
              <div key={m.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {m.fullName ?? m.email}
                    {m.id === me.data?.userId ? (
                      <span className="ml-2 text-xs text-muted-foreground">(you)</span>
                    ) : null}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{m.email}</p>
                </div>
                {m.role === "org_owner" ? (
                  <Badge variant="outline" className="gap-1 border-primary/40 text-primary">
                    <ShieldCheck className="h-3 w-3" />
                    Owner
                  </Badge>
                ) : canManage && m.id !== me.data?.userId ? (
                  <select
                    aria-label={`role for ${m.email}`}
                    value={m.role}
                    onChange={(e) =>
                      setMemberRole.mutate({
                        userId: m.id,
                        role: e.target.value as (typeof GRANTABLE)[number],
                      })
                    }
                    className="border-input h-8 rounded-lg border bg-background/50 px-2 text-xs"
                  >
                    {GRANTABLE.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABEL[r]}
                      </option>
                    ))}
                  </select>
                ) : (
                  <Badge variant="secondary">{ROLE_LABEL[m.role] ?? m.role}</Badge>
                )}
                {m.status === "deactivated" ? (
                  <Badge variant="destructive">deactivated</Badge>
                ) : null}
                {canManage && m.id !== me.data?.userId && m.role !== "org_owner" ? (
                  <Button
                    size="xs"
                    variant="ghost"
                    className="text-muted-foreground"
                    onClick={() =>
                      setStatus.mutate({
                        userId: m.id,
                        status: m.status === "deactivated" ? "active" : "deactivated",
                      })
                    }
                  >
                    <UserX className="h-3 w-3" />
                    {m.status === "deactivated" ? "Reactivate" : "Deactivate"}
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
        </section>

        {canManage ? (
          <section className="glass-card mt-6 rounded-xl p-4">
            <h2 className="mb-3 text-sm font-semibold">Pending invites ({pending.length})</h2>
            {pending.length === 0 ? (
              <EmptyState
                as="h3"
                title="No pending invites"
                description="Invites expire after 7 days; revoked and accepted ones are kept for audit."
              />
            ) : (
              <div className="divide-y divide-border/60">
                {pending.map((i) => (
                  <div key={i.id} className="flex items-center gap-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{i.email}</p>
                      <p className="text-xs text-muted-foreground">
                        {ROLE_LABEL[i.role] ?? i.role} · expires{" "}
                        {new Date(i.expiresAt).toLocaleDateString()}
                      </p>
                    </div>
                    <Button
                      size="xs"
                      variant="ghost"
                      className="text-muted-foreground"
                      onClick={() => revoke.mutate({ inviteId: i.id })}
                    >
                      Revoke
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </section>
        ) : null}
      </main>
    </div>
  );
}
