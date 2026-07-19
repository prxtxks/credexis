ALTER TABLE "computed_metrics" ADD COLUMN "period_label" text;--> statement-breakpoint
-- M7.7 recompute: engine output is DERIVED data — underwriters replace a
-- deal's metric rows wholesale on every recompute (delete + insert). The
-- 0001 posture (select-only for users) predates request-path recompute.
create policy computed_metrics_insert on public.computed_metrics
  for insert to authenticated with check (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() in ('admin', 'underwriter'));
--> statement-breakpoint
create policy computed_metrics_delete on public.computed_metrics
  for delete to authenticated using (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() in ('admin', 'underwriter'));
