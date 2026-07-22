export default function DealLoading() {
  return (
    <div className="flex h-screen items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-5">
        <div className="grid-loader">
          <span />
          <span />
          <span />
          <span />
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>
        <p className="text-sm text-muted-foreground">Loading workspace…</p>
      </div>
    </div>
  );
}
