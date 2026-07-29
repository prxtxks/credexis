"use client";

/**
 * Signup (M11.2): email/password account creation. On success, the session
 * exists but no profile does — /welcome owns org bootstrap (design 01
 * §4.1). Supabase may require email confirmation depending on project
 * settings; both paths are handled.
 */

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { MailCheck, Sparkles } from "lucide-react";
import { createClient } from "@/lib/supabase/browser";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ThemeToggle } from "@/components/theme-toggle";

export default function SignupPage() {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmSent, setConfirmSent] = useState(false);

  async function signUp(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { data, error: err } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } },
    });
    if (err) {
      setError(err.message);
      setBusy(false);
      return;
    }
    if (data.session) {
      router.replace("/welcome");
      router.refresh();
      return;
    }
    setConfirmSent(true); // email confirmation required by project settings
    setBusy(false);
  }

  return (
    <div className="gradient-mesh relative flex min-h-screen items-center justify-center">
      <div className="absolute top-4 right-4 z-10">
        <ThemeToggle />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-md px-6"
      >
        <div className="mb-8 flex items-center justify-center gap-2.5">
          <img src="/logo-credexis.svg" alt="Credexis" className="h-9 w-9" />
          <span className="text-xl font-bold tracking-tight">Credexis</span>
        </div>

        <div className="glass-card glow-sm rounded-2xl border border-border/50 p-8">
          {confirmSent ? (
            <div className="flex flex-col items-center gap-3 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <MailCheck className="h-6 w-6" />
              </div>
              <h1 className="text-xl font-bold">Check your email</h1>
              <p className="text-sm text-muted-foreground">
                We sent a confirmation link to <span className="font-medium">{email}</span>. After
                confirming, sign in and we&apos;ll set up your workspace.
              </p>
              <Button asChild variant="outline" className="mt-2">
                <Link href="/login">Back to sign in</Link>
              </Button>
            </div>
          ) : (
            <>
              <div className="mb-8 text-center">
                <div className="mb-4 inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                  <Sparkles className="h-3 w-3" />
                  AI-Powered Underwriting
                </div>
                <h1 className="mb-2 text-2xl font-bold">Create your account</h1>
                <p className="text-sm text-muted-foreground">
                  Lenders, broker firms, and independent brokers — your workspace is next.
                </p>
              </div>

              <form onSubmit={signUp} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="fullName">Full name</Label>
                  <Input
                    id="fullName"
                    required
                    autoComplete="name"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="h-11 rounded-xl bg-background/50"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="email">Work email</Label>
                  <Input
                    id="email"
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="h-11 rounded-xl bg-background/50"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    required
                    minLength={8}
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="h-11 rounded-xl bg-background/50"
                  />
                </div>
                <Button type="submit" disabled={busy} className="h-11 w-full text-base">
                  {busy ? "Creating account…" : "Create account"}
                </Button>
              </form>

              {error ? (
                <p role="alert" className="mt-4 text-center text-sm text-destructive">
                  {error}
                </p>
              ) : null}

              <p className="mt-6 text-center text-sm text-muted-foreground">
                Already have an account?{" "}
                <Link href="/login" className="font-medium text-primary hover:underline">
                  Sign in
                </Link>
              </p>
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
}
