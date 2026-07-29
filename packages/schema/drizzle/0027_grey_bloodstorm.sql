CREATE TABLE "borrowers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"full_name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "borrower_invites_live_uq";--> statement-breakpoint
ALTER TABLE "borrower_invites" ADD COLUMN "borrower_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "borrowers" ADD CONSTRAINT "borrowers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "borrowers_tenant_email_uq" ON "borrowers" USING btree ("tenant_id",lower("email"));--> statement-breakpoint
CREATE INDEX "borrowers_tenant_idx" ON "borrowers" USING btree ("tenant_id");--> statement-breakpoint
ALTER TABLE "borrower_invites" ADD CONSTRAINT "borrower_invites_borrower_id_borrowers_id_fk" FOREIGN KEY ("borrower_id") REFERENCES "public"."borrowers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "borrower_invites_borrower_idx" ON "borrower_invites" USING btree ("borrower_id");--> statement-breakpoint
CREATE UNIQUE INDEX "borrower_invites_live_uq" ON "borrower_invites" USING btree ("deal_id","borrower_id") WHERE "borrower_invites"."status" in ('pending','active');