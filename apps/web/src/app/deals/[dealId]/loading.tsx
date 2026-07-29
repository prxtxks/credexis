import { PageLoading } from "@/components/ui/page-loading";
export default function DealLoading() {
  return (
    <div className="flex h-screen items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-5">
        <PageLoading />
        <p className="text-sm text-muted-foreground">Loading workspace…</p>
      </div>
    </div>
  );
}
