"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import { FileSearch, Layers, Shield, Zap } from "lucide-react";
import { createClient } from "@/lib/supabase/browser";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ThemeToggle } from "@/components/theme-toggle";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const nextPath = searchParams.get("next") ?? "/";

  async function signInWithEmail(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    if (err) {
      setError(err.message);
      setBusy(false);
      return;
    }
    router.replace(nextPath);
    router.refresh();
  }

  async function signInWithGoogle() {
    setError(null);
    const supabase = createClient();
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextPath)}`,
      },
    });
    if (err) setError(err.message);
  }

  return (
    <div className="min-h-screen flex">
      {/* Left panel - brand */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden">
        {/* Deep brand field + faint dot texture - no floating decor (ui-12). */}
        <div className="absolute inset-0 bg-gradient-to-br from-primary to-[oklch(0.32_0.09_168)]" />
        <div className="absolute inset-0 dot-pattern opacity-15" />

        <div className="relative z-10 flex flex-col justify-between w-full p-12">
          <div className="flex items-center gap-2.5">
            <img src="/logo-credexis.svg" alt="Credexis" className="h-8 w-8 brightness-0 invert" />
            <span className="font-bold text-xl text-white tracking-tight">Credexis</span>
          </div>

          <div className="max-w-md">
            <h2 className="text-4xl font-bold text-white leading-tight mb-5">
              SBA 7(a) underwriting - documents in, pro-forma out
            </h2>
            <p className="text-white/70 text-lg leading-relaxed mb-8">
              Upload a borrower&apos;s financial documents and get banker-grade analysis in minutes
              - every number traceable to its source page.
            </p>
            <div className="space-y-4">
              {[
                { icon: Zap, text: "Tax returns and statements read in minutes" },
                { icon: Shield, text: "Dual-reader consensus - no silent errors" },
                { icon: FileSearch, text: "Click any number to see its source" },
                { icon: Layers, text: "Blocking validation gates before sign-off" },
              ].map(({ icon: Icon, text }) => (
                <div key={text} className="flex items-center gap-3 text-white/80">
                  <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-white/10">
                    <Icon className="w-4 h-4 text-white" />
                  </div>
                  <span className="text-sm">{text}</span>
                </div>
              ))}
            </div>
          </div>

          <p className="text-white/40 text-sm">&copy; Credexis</p>
        </div>
      </div>

      {/* Right panel - sign-in */}
      <div className="w-full lg:w-1/2 flex items-center justify-center relative">
        <div className="absolute inset-0 gradient-mesh opacity-30" />

        <div className="absolute top-4 right-4 z-10">
          <ThemeToggle />
        </div>

        <div className="relative w-full max-w-md mx-auto px-6">
          {/* Mobile logo */}
          <div className="flex items-center justify-center gap-2.5 mb-8 lg:hidden">
            <img src="/logo-credexis.svg" alt="Credexis" className="h-9 w-9" />
            <span className="font-bold text-xl tracking-tight">Credexis</span>
          </div>

          <div className="glass-card rounded-[20px] p-8">
            <div className="mb-8">
              <h1 className="text-2xl font-semibold tracking-tight mb-1.5">Welcome back</h1>
              <p className="text-muted-foreground text-sm">Sign in to your Credexis workspace.</p>
            </div>

            <form onSubmit={signInWithEmail} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  required
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
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-11 rounded-xl bg-background/50"
                />
              </div>
              <Button type="submit" disabled={busy} className="w-full h-11 text-base">
                {busy ? "Signing in…" : "Sign in"}
              </Button>
            </form>

            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-border/60" />
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="px-2 text-muted-foreground">or</span>
              </div>
            </div>

            <Button
              type="button"
              onClick={signInWithGoogle}
              variant="outline"
              className="w-full h-11 text-sm font-medium gap-3 rounded-xl hover:bg-accent transition-all duration-200 hover:shadow-md"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden>
                <path
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                  fill="#4285F4"
                />
                <path
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  fill="#34A853"
                />
                <path
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  fill="#FBBC05"
                />
                <path
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  fill="#EA4335"
                />
              </svg>
              Continue with Google
            </Button>

            {error ? (
              <p role="alert" className="mt-4 text-center text-sm text-destructive">
                {error}
              </p>
            ) : null}

            <p className="mt-6 text-center text-sm text-muted-foreground">
              New to Credexis?{" "}
              <Link href="/signup" className="font-medium text-primary hover:underline">
                Create an account
              </Link>
            </p>

            <div className="mt-6 pt-5 border-t border-border/50">
              <p className="text-center text-xs text-muted-foreground flex items-center justify-center gap-1.5">
                <Shield className="w-3 h-3" />
                Secure authentication powered by Supabase
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
