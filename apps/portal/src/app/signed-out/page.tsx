/**
 * The way out (design 05 §10.2, screen 4). Deliberately has no form and no
 * link back to /claim: without the invite token there is nothing to sign in
 * to, so any control here would be a dead end. The emailed link is the door.
 */
export default function SignedOutPage() {
  return (
    <main className="flex min-h-svh items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <p className="text-xl font-semibold tracking-tight">Credexis</p>
          <p className="text-muted-foreground mt-1 text-sm">Secure document portal</p>
        </div>

        <div className="bg-card text-card-foreground rounded-xl border p-6 text-center shadow-sm sm:p-8">
          <h1 className="text-xl font-semibold tracking-tight">You&apos;re signed out</h1>
          <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
            Open your emailed link again to continue.
          </p>
          <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
            If the link no longer works, ask your loan officer for a new one.
          </p>
        </div>
      </div>
    </main>
  );
}
