"use client";

/**
 * Org bootstrap (M11.2, design 01 §4.1): the page a signed-in,
 * profile-less account lands on — replacing the previous dead end where
 * new signups had no path into the product. One choice (org type), one
 * name, one click; the caller becomes org_owner via create_organization()
 * (SECURITY DEFINER — the only way a tenants/profiles pair is born).
 * A solo broker is an org of one; hiring later = inviting a member.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Briefcase, Building2, Landmark } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const KINDS = [
  {
    key: "lender" as const,
    icon: Landmark,
    title: "SBA Lender",
    blurb: "Bank or credit union underwriting 7(a) loans",
  },
  {
    key: "broker_firm" as const,
    icon: Building2,
    title: "Broker Firm",
    blurb: "Loan brokerage or packaging firm with a team",
  },
  {
    key: "solo_broker" as const,
    icon: Briefcase,
    title: "Independent Broker",
    blurb: "Solo broker — invite teammates anytime later",
  },
];

export default function WelcomePage() {
  const router = useRouter();
  const bootstrap = trpc.org.bootstrap.useQuery();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<(typeof KINDS)[number]["key"]>("lender");
  const [touched, setTouched] = useState(false);

  // Already has a workspace → nothing to bootstrap.
  useEffect(() => {
    if (bootstrap.data?.hasProfile) router.replace("/");
  }, [bootstrap.data?.hasProfile, router]);

  // Solo brokers usually operate under an LLC named after themselves —
  // prefill from the account name until the user edits.
  useEffect(() => {
    if (!touched && bootstrap.data?.suggestedName && name === "") {
      setName(bootstrap.data.suggestedName);
    }
  }, [bootstrap.data?.suggestedName, touched, name]);

  const create = trpc.org.create.useMutation({
    onSuccess: () => {
      toast.success("Workspace created — welcome to Credexis");
      router.replace("/");
      router.refresh();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="gradient-mesh flex min-h-screen items-center justify-center">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-lg px-6"
      >
        <div className="mb-8 flex items-center justify-center gap-2.5">
          <img src="/logo-credexis.svg" alt="Credexis" className="h-9 w-9" />
          <span className="text-xl font-bold tracking-tight">Credexis</span>
        </div>

        <div className="glass-card rounded-[20px] p-8">
          <h1 className="mb-1 text-2xl font-semibold tracking-tight">Set up your workspace</h1>
          <p className="mb-6 text-sm text-muted-foreground">
            One workspace per organization — you&apos;ll be its owner and can invite your team.
          </p>

          <div className="mb-5 grid gap-2">
            {KINDS.map(({ key, icon: Icon, title, blurb }) => (
              <button
                key={key}
                type="button"
                onClick={() => setKind(key)}
                aria-pressed={kind === key}
                className={cn(
                  "flex items-center gap-3 rounded-xl border p-3 text-left transition-colors duration-200",
                  kind === key
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/40",
                )}
              >
                <div
                  className={cn(
                    "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
                    kind === key
                      ? "bg-primary text-primary-foreground"
                      : "bg-primary/10 text-primary",
                  )}
                >
                  <Icon className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm font-semibold">{title}</p>
                  <p className="text-xs text-muted-foreground">{blurb}</p>
                </div>
              </button>
            ))}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="orgName">Organization name</Label>
            <Input
              id="orgName"
              value={name}
              onChange={(e) => {
                setTouched(true);
                setName(e.target.value);
              }}
              placeholder={kind === "solo_broker" ? "Your name or LLC" : "Organization name"}
              className="h-11 rounded-xl bg-background/50"
            />
          </div>

          <Button
            className="mt-5 h-11 w-full text-base"
            disabled={name.trim().length < 2 || create.isPending}
            onClick={() => create.mutate({ name: name.trim(), kind })}
          >
            {create.isPending ? "Creating workspace…" : "Create workspace"}
          </Button>
        </div>
      </motion.div>
    </div>
  );
}
