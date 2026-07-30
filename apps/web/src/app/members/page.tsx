"use client";

/**
 * Members & invites (M11.3, rebuilt ui-17-feedback-pass-2 to the reference's
 * team-members layout Pratik supplied): invite card with footer strip,
 * underline tabs (Members | Pending), filter row, select-all list header,
 * per-row overflow menu.
 *
 * X4 e2e contracts preserved BYTE-FOR-BYTE: FieldSelect
 * ariaLabel="Invite role" and ariaLabel={`role for ${m.email}`}.
 * The DB tier lattice (0013) stays the enforcement; denied actions surface
 * as errors, never silent no-ops. Select-all + bulk actions are UI-first
 * (disabled, labeled) until a bulk backend exists.
 */

import { useMemo, useState } from "react";
import { Copy, MoreHorizontal, Plus, ShieldCheck, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc/client";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FieldSelect } from "@/components/ui/field-select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Pill } from "@/components/ui/pill";
import { SettingsCard } from "@/components/ui/settings-card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const ROLE_LABEL: Record<string, string> = {
  org_owner: "Owner",
  admin: "Admin",
  underwriter: "Underwriter",
  viewer: "Viewer",
};
const GRANTABLE = ["admin", "underwriter", "viewer"] as const;

function initialsOf(name: string | null, email: string): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2)
    return (parts[0]!.charAt(0) + parts[parts.length - 1]!.charAt(0)).toUpperCase();
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return email.slice(0, 1).toUpperCase();
}

export default function MembersPage() {
  const utils = trpc.useUtils();
  const me = trpc.me.useQuery();
  const members = trpc.members.list.useQuery();
  const invites = trpc.invites.list.useQuery(undefined, { retry: false });

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<(typeof GRANTABLE)[number]>("underwriter");
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [tab, setTab] = useState<"members" | "pending">("members");
  const [filter, setFilter] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");

  const refresh = () => {
    void utils.members.list.invalidate();
    void utils.invites.list.invalidate();
  };
  const createInvite = trpc.invites.create.useMutation({
    onSuccess: (r) => {
      setInviteLink(`${window.location.origin}/invite/accept?token=${r.token}`);
      setEmail("");
      refresh();
      toast.success(
        r.emailSent
          ? "Invite created and emailed — the link below also works"
          : "Invite created — copy the link below and send it",
      );
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

  const visibleMembers = useMemo(() => {
    const q = filter.trim().toLowerCase();
    let rows = members.data ?? [];
    if (q !== "")
      rows = rows.filter(
        (m) => (m.fullName ?? "").toLowerCase().includes(q) || m.email.toLowerCase().includes(q),
      );
    if (roleFilter !== "all") rows = rows.filter((m) => m.role === roleFilter);
    return rows;
  }, [members.data, filter, roleFilter]);

  return (
    <AppShell breadcrumb="Members">
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
        <h1 className="text-title">Members</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Manage this workspace&apos;s members and invitations — originators originate, underwriters
          decide.
        </p>

        <div className="mt-6 space-y-6">
          {canManage ? (
            <SettingsCard
              title="Invite members"
              description="Add teammates by email and assign a role from the lattice."
              footer="Invites expire after 7 days; revoked and accepted ones are kept for audit."
              footerAction={
                <Button
                  size="sm"
                  variant="brand"
                  onClick={() => createInvite.mutate({ email, role })}
                  disabled={createInvite.isPending || !email.includes("@")}
                >
                  <span className="flex items-center gap-1.5">
                    <UserPlus className="h-3.5 w-3.5" />
                    Create invite
                  </span>
                </Button>
              }
            >
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-56 flex-1 space-y-1.5">
                  <Label htmlFor="invite-email">Email address</Label>
                  <Input
                    id="invite-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="teammate@bank.com"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="invite-role">Role</Label>
                  <FieldSelect
                    ariaLabel="Invite role"
                    value={role}
                    onChange={(v) => setRole(v as (typeof GRANTABLE)[number])}
                    options={GRANTABLE.map((r) => ({ value: r, label: ROLE_LABEL[r] ?? r }))}
                    size="default"
                  />
                </div>
              </div>
              <button
                type="button"
                disabled
                className="text-muted-foreground mt-3 inline-flex cursor-not-allowed items-center gap-1.5 text-[13px] opacity-60"
              >
                <Plus className="size-3.5" />
                Add more
                <Pill tone="accent">Soon</Pill>
              </button>
              {inviteLink ? (
                <div className="bg-muted mt-3 flex items-center gap-2 rounded-lg p-2.5">
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
            </SettingsCard>
          ) : null}

          {/* ── Underline tabs (reference) ── */}
          <div>
            <div className="border-border flex gap-6 border-b">
              {(
                [
                  { key: "members", label: "Members" },
                  { key: "pending", label: "Pending invitations" },
                ] as const
              ).map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTab(t.key)}
                  className={cn(
                    "-mb-px border-b-2 pb-2.5 text-[15px] font-medium transition-colors duration-150",
                    tab === t.key
                      ? "border-foreground text-foreground"
                      : "text-muted-foreground hover:text-foreground border-transparent",
                  )}
                >
                  {t.label}
                  <span className="text-muted-foreground ml-1.5 text-[13px] tabular-nums">
                    {t.key === "members"
                      ? members.data
                        ? members.data.length
                        : "…"
                      : invites.isLoading
                        ? "…"
                        : pending.length}
                  </span>
                </button>
              ))}
            </div>

            {tab === "members" ? (
              <>
                {/* ── Filter row ── */}
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <Input
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    placeholder="Filter"
                    aria-label="Filter members"
                    className="h-9 max-w-xs flex-1"
                  />
                  <FieldSelect
                    ariaLabel="Filter by role"
                    value={roleFilter}
                    onChange={setRoleFilter}
                    options={[
                      { value: "all", label: "All roles" },
                      ...Object.entries(ROLE_LABEL).map(([value, label]) => ({ value, label })),
                    ]}
                    size="default"
                  />
                </div>

                {/* ── List: select-all header + rows ── */}
                <div className="glass-card mt-3 rounded-lg">
                  <div className="border-border/70 flex items-center gap-3 border-b px-4 py-2.5">
                    <input
                      type="checkbox"
                      disabled
                      aria-label="Select all (bulk actions coming soon)"
                      className="size-4 cursor-not-allowed rounded-[4px] opacity-50"
                    />
                    <span className="text-muted-foreground flex-1 text-[13px]">
                      Select all ({visibleMembers.length})
                    </span>
                    <MoreHorizontal
                      aria-hidden="true"
                      className="text-muted-foreground/50 size-4"
                    />
                  </div>
                  {members.isLoading ? (
                    <div className="space-y-3 p-4">
                      <Skeleton className="h-9" />
                      <Skeleton className="h-9 w-2/3" />
                    </div>
                  ) : visibleMembers.length === 0 ? (
                    <p className="text-muted-foreground px-4 py-8 text-center text-[13px]">
                      No members match that filter.
                    </p>
                  ) : (
                    <ul className="divide-border/70 divide-y">
                      {visibleMembers.map((m) => (
                        <li key={m.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                          <input
                            type="checkbox"
                            disabled
                            aria-label={`Select ${m.email} (bulk actions coming soon)`}
                            className="size-4 cursor-not-allowed rounded-[4px] opacity-50"
                          />
                          <span
                            aria-hidden="true"
                            className="border-border bg-muted flex size-8 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold"
                          >
                            {initialsOf(m.fullName, m.email)}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">
                              {m.fullName ?? m.email}
                              {m.id === me.data?.userId ? (
                                <span className="text-muted-foreground ml-2 text-xs">(you)</span>
                              ) : null}
                            </p>
                            <p className="text-muted-foreground truncate text-xs">{m.email}</p>
                          </div>
                          {m.status === "deactivated" ? (
                            <Badge variant="destructive">deactivated</Badge>
                          ) : null}
                          {m.role === "org_owner" ? (
                            <Badge
                              variant="outline"
                              className="border-primary/40 text-primary gap-1"
                            >
                              <ShieldCheck className="h-3 w-3" />
                              Owner
                            </Badge>
                          ) : canManage && m.id !== me.data?.userId ? (
                            <FieldSelect
                              ariaLabel={`role for ${m.email}`}
                              value={m.role}
                              onChange={(v) =>
                                setMemberRole.mutate({
                                  userId: m.id,
                                  role: v as (typeof GRANTABLE)[number],
                                })
                              }
                              options={GRANTABLE.map((r) => ({
                                value: r,
                                label: ROLE_LABEL[r] ?? r,
                              }))}
                            />
                          ) : (
                            <Badge variant="secondary">{ROLE_LABEL[m.role] ?? m.role}</Badge>
                          )}
                          {canManage && m.id !== me.data?.userId && m.role !== "org_owner" ? (
                            <DropdownMenu>
                              <DropdownMenuTrigger
                                aria-label={`actions for ${m.email}`}
                                className="hover:bg-accent data-[state=open]:bg-accent flex size-8 items-center justify-center rounded-lg transition-colors duration-150"
                              >
                                <MoreHorizontal
                                  aria-hidden="true"
                                  className="text-muted-foreground size-4"
                                />
                              </DropdownMenuTrigger>
                              <DropdownMenuContent
                                align="end"
                                sideOffset={6}
                                className="w-48 rounded-xl p-1.5"
                              >
                                <DropdownMenuItem
                                  className="rounded-lg text-[13px]"
                                  variant={m.status === "deactivated" ? "default" : "destructive"}
                                  onSelect={() =>
                                    setStatus.mutate({
                                      userId: m.id,
                                      status: m.status === "deactivated" ? "active" : "deactivated",
                                    })
                                  }
                                >
                                  {m.status === "deactivated" ? "Reactivate" : "Deactivate"}
                                </DropdownMenuItem>
                                <DropdownMenuItem disabled className="rounded-lg text-[13px]">
                                  <span className="flex-1">View activity</span>
                                  <Pill tone="accent">Soon</Pill>
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </>
            ) : (
              <div className="glass-card mt-4 rounded-lg">
                {pending.length === 0 ? (
                  <div className="flex flex-col items-center px-6 py-10 text-center">
                    <p className="text-[15px] font-semibold">No pending invites</p>
                    <p className="text-muted-foreground mt-1 max-w-sm text-[13px]">
                      Invites expire after 7 days; revoked and accepted ones are kept for audit.
                    </p>
                  </div>
                ) : (
                  <ul className="divide-border/70 divide-y">
                    {pending.map((i) => (
                      <li key={i.id} className="flex items-center gap-3 px-4 py-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm">{i.email}</p>
                          <p className="text-muted-foreground text-xs">
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
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </div>
      </main>
    </AppShell>
  );
}
