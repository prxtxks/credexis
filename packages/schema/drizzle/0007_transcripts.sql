CREATE TABLE "transcript_consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"deal_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"external_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "transcripts_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "transcript_consents" ADD CONSTRAINT "transcript_consents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcript_consents" ADD CONSTRAINT "transcript_consents_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcript_consents" ADD CONSTRAINT "transcript_consents_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transcript_consents_tenant_idx" ON "transcript_consents" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "transcript_consents_deal_idx" ON "transcript_consents" USING btree ("deal_id");--> statement-breakpoint
-- RLS: standard tenant pattern (select all members; write underwriter+).
alter table public.transcript_consents enable row level security;
--> statement-breakpoint
create policy transcript_consents_select on public.transcript_consents
  for select to authenticated using (tenant_id = public.current_tenant_id());
--> statement-breakpoint
create policy transcript_consents_insert on public.transcript_consents
  for insert to authenticated with check (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() in ('admin', 'underwriter'));
--> statement-breakpoint
create policy transcript_consents_update on public.transcript_consents
  for update to authenticated using (
    tenant_id = public.current_tenant_id()
    and public.current_user_role() in ('admin', 'underwriter'));
