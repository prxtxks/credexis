"use client";

/**
 * Invite claim (M11.3, design 01 §4.3): signed-in, profile-less account +
 * URL token → accept_invite() SECURITY DEFINER (hash match, unexpired,
 * unrevoked, JWT email == invite email) → membership. Unauthenticated
 * visitors are sent to sign in/up first by the middleware; accounts that
 * already belong to a workspace are told so honestly.
 */

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { MailQuestion } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";

function AcceptInner() {
  const router = useRouter();
  const token = useSearchParams().get("token") ?? "";
  const bootstrap = trpc.org.bootstrap.useQuery();
  const [failed, setFailed] = useState<string | null>(null);

  const accept = trpc.invites.accept.useMutation({
    onSuccess: () => {
      toast.success("Welcome aboard - workspace joined");
      router.replace("/");
      router.refresh();
    },
    onError: (e) => setFailed(e.message),
  });

  const alreadyMember = bootstrap.data?.hasProfile === true;

  return (
    <div className="gradient-mesh flex min-h-screen items-center justify-center">
      <div className="glass-card w-full max-w-md rounded-2xl border border-border/50 p-8 text-center">
        <div className="mb-4 flex justify-center">
          <img src="/logo-credexis.svg" alt="Credexis" className="h-10 w-10" />
        </div>
        {token.length < 32 ? (
          <>
            <h1 className="mb-2 text-xl font-bold">Invalid invite link</h1>
            <p className="text-sm text-muted-foreground">
              This link is missing its token. Ask your administrator to send a fresh invite.
            </p>
          </>
        ) : alreadyMember ? (
          <>
            <h1 className="mb-2 text-xl font-bold">Already in a workspace</h1>
            <p className="mb-4 text-sm text-muted-foreground">
              This account already belongs to an organization - invites can only be claimed by a new
              account.
            </p>
            <Button asChild variant="outline">
              <Link href="/">Go to your workspace</Link>
            </Button>
          </>
        ) : failed ? (
          <>
            <div className="mb-3 flex justify-center">
              <MailQuestion className="h-8 w-8 text-severity-warning" />
            </div>
            <h1 className="mb-2 text-xl font-bold">Couldn&apos;t accept this invite</h1>
            <p className="mb-4 text-sm text-muted-foreground">{failed}</p>
            <p className="text-xs text-muted-foreground">
              Invites are tied to the email they were sent to and expire after 7 days.
            </p>
          </>
        ) : (
          <>
            <h1 className="mb-2 text-xl font-bold">Join your team on Credexis</h1>
            <p className="mb-5 text-sm text-muted-foreground">
              You&apos;ve been invited to a workspace. Accepting links this account
              {bootstrap.data?.email ? (
                <>
                  {" "}
                  (<span className="font-medium">{bootstrap.data.email}</span>)
                </>
              ) : null}{" "}
              to the organization.
            </p>
            <Button
              className="h-11 w-full text-base"
              disabled={accept.isPending || bootstrap.isLoading}
              onClick={() => accept.mutate({ token })}
            >
              {accept.isPending ? "Joining…" : "Accept invite"}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

export default function InviteAcceptPage() {
  return (
    <Suspense>
      <AcceptInner />
    </Suspense>
  );
}
