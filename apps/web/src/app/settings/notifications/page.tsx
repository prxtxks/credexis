"use client";

/**
 * Settings → Notifications (ui-17-settings, 02-VERCEL-DERIVATION §4): the
 * reference's channels-card + category-matrix layout.
 *
 * Honesty contract: the ONLY writable control today is the email master
 * switch (profile.emailNotifications — real). In-app notifications are
 * always on by design (M11.5: email is an extra channel, never the only
 * record). The per-category matrix is the UI map for plan 01 step 18
 * (m11-7-notification-granularity) — rendered from the real notification
 * kinds, disabled, and labeled as such. It never pretends to save.
 */

import { AtSign, Bell } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc/client";
import { AppShell } from "@/components/app-shell";
import { Switch } from "@/components/ui/switch";
import { SettingsCard } from "@/components/ui/settings-card";
import { cn } from "@/lib/utils";

/** The notification kinds the pipeline actually emits today (M11.5/M12.1). */
const MATRIX: { section: string; rows: string[] }[] = [
  { section: "Deals", rows: ["Deal status changes", "Export generated"] },
  { section: "Documents", rows: ["Upload processed", "Extraction failed"] },
  { section: "Review", rows: ["Fields awaiting decision", "Gate violations"] },
  { section: "Borrower portal", rows: ["Borrower uploaded", "Invite expiring"] },
];

export default function SettingsNotificationsPage() {
  const utils = trpc.useUtils();
  const profile = trpc.profile.get.useQuery();
  const update = trpc.profile.update.useMutation({
    onSuccess: () => {
      void utils.profile.get.invalidate();
      toast.success("Settings saved");
    },
    onError: (err) => toast.error(err.message),
  });

  const emailOn = profile.data?.emailNotifications ?? true;

  return (
    <AppShell breadcrumb="Settings · Notifications">
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
        <h1 className="text-title">Notifications</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          How Credexis reaches you about approvals, documents, and borrower activity.
        </p>

        <div className="mt-6 space-y-6">
          <SettingsCard title="Channels">
            <div className="divide-border/70 -mx-5 -mt-4 divide-y sm:-mx-6">
              <div className="flex items-center gap-3 px-5 py-3.5 sm:px-6">
                <span className="border-border bg-popover flex size-9 shrink-0 items-center justify-center rounded-full border">
                  <Bell aria-hidden="true" className="text-muted-foreground size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">In-app</p>
                  <p className="text-muted-foreground text-[13px]">
                    Always on — the bell is the record of what happened, never optional.
                  </p>
                </div>
                <Switch checked disabled aria-label="In-app notifications (always on)" />
              </div>
              <div className="flex items-center gap-3 px-5 py-3.5 sm:px-6">
                <span className="border-border bg-popover flex size-9 shrink-0 items-center justify-center rounded-full border">
                  <AtSign aria-hidden="true" className="text-muted-foreground size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">Email</p>
                  <p className="text-muted-foreground truncate text-[13px]">
                    {profile.data?.email ?? "…"}
                  </p>
                </div>
                <Switch
                  checked={emailOn}
                  disabled={profile.isLoading || update.isPending}
                  onCheckedChange={(checked) => update.mutate({ emailNotifications: checked })}
                  aria-label="Send me email notifications"
                />
              </div>
            </div>
          </SettingsCard>

          <SettingsCard
            title="By category"
            description="What each channel carries."
            footer="Per-category preferences ship with the notification-granularity work — today email is all-or-nothing via the switch above."
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-sm">
                <tbody>
                  {MATRIX.map((group) => (
                    <FragmentRows key={group.section} group={group} emailOn={emailOn} />
                  ))}
                </tbody>
              </table>
            </div>
          </SettingsCard>
        </div>
      </main>
    </AppShell>
  );
}

function FragmentRows({
  group,
  emailOn,
}: {
  group: { section: string; rows: string[] };
  emailOn: boolean;
}) {
  return (
    <>
      <tr>
        <th scope="col" className="pt-4 pb-2 text-left text-[15px] font-semibold">
          {group.section}
        </th>
        <th
          scope="col"
          className="text-muted-foreground w-16 pt-4 pb-2 text-right text-[13px] font-normal"
        >
          In-app
        </th>
        <th
          scope="col"
          className="text-muted-foreground w-16 pt-4 pb-2 text-right text-[13px] font-normal"
        >
          Email
        </th>
      </tr>
      {group.rows.map((row) => (
        <tr key={row} className="border-border/70 border-t">
          <td className="text-foreground/85 py-2.5 pr-4">{row}</td>
          <td className="py-2.5 text-right">
            <MatrixCheck on disabled />
          </td>
          <td className="py-2.5 text-right">
            <MatrixCheck on={emailOn} disabled />
          </td>
        </tr>
      ))}
    </>
  );
}

/** Read-only matrix cell — reflects today's real behavior, writable in step 18. */
function MatrixCheck({ on, disabled }: { on: boolean; disabled?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex size-4 items-center justify-center rounded-[4px] border",
        on ? "border-primary/50 bg-primary/80" : "border-border bg-transparent",
        disabled && "opacity-50",
      )}
    >
      {on ? (
        <svg
          viewBox="0 0 12 12"
          className="size-2.5 text-white"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M2.5 6.5 5 9l4.5-5.5" />
        </svg>
      ) : null}
    </span>
  );
}
