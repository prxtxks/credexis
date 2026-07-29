CREATE TYPE "public"."borrower_invite_status" AS ENUM('pending', 'active', 'revoked', 'expired');--> statement-breakpoint
CREATE TYPE "public"."borrower_portal_status" AS ENUM('collecting', 'in_review', 'complete');--> statement-breakpoint
CREATE TYPE "public"."document_request_status" AS ENUM('open', 'fulfilled', 'withdrawn');--> statement-breakpoint
ALTER TYPE "public"."notification_kind" ADD VALUE 'borrower_upload';--> statement-breakpoint
CREATE TABLE "borrower_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"deal_id" uuid NOT NULL,
	"entity_id" uuid,
	"email" text NOT NULL,
	"token_hash" text NOT NULL,
	"auth_user_id" uuid,
	"status" "borrower_invite_status" DEFAULT 'pending' NOT NULL,
	"portal_status" "borrower_portal_status" DEFAULT 'collecting' NOT NULL,
	"display_label" text NOT NULL,
	"entity_label" text,
	"requested_items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"max_docs" integer,
	"max_bytes" bigint,
	"max_cost_micro_usd" bigint,
	"invited_by" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"claimed_at" timestamp with time zone,
	"last_reminded_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"deal_id" uuid NOT NULL,
	"invite_id" uuid NOT NULL,
	"note" text NOT NULL,
	"status" "document_request_status" DEFAULT 'open' NOT NULL,
	"requested_by" uuid NOT NULL,
	"fulfilled_by_document_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
DROP INDEX "documents_deal_sha256_unique";--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "uploaded_via_invite_id" uuid;--> statement-breakpoint
ALTER TABLE "borrower_invites" ADD CONSTRAINT "borrower_invites_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "borrower_invites" ADD CONSTRAINT "borrower_invites_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "borrower_invites" ADD CONSTRAINT "borrower_invites_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_requests" ADD CONSTRAINT "document_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_requests" ADD CONSTRAINT "document_requests_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_requests" ADD CONSTRAINT "document_requests_invite_id_borrower_invites_id_fk" FOREIGN KEY ("invite_id") REFERENCES "public"."borrower_invites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "borrower_invites_token_hash_uq" ON "borrower_invites" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "borrower_invites_live_uq" ON "borrower_invites" USING btree ("deal_id",lower("email")) WHERE "borrower_invites"."status" in ('pending','active');--> statement-breakpoint
CREATE INDEX "borrower_invites_auth_user_idx" ON "borrower_invites" USING btree ("auth_user_id") WHERE "borrower_invites"."auth_user_id" is not null;--> statement-breakpoint
CREATE INDEX "borrower_invites_tenant_idx" ON "borrower_invites" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "borrower_invites_deal_idx" ON "borrower_invites" USING btree ("deal_id");--> statement-breakpoint
CREATE INDEX "document_requests_invite_idx" ON "document_requests" USING btree ("invite_id");--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploaded_via_invite_id_borrower_invites_id_fk" FOREIGN KEY ("uploaded_via_invite_id") REFERENCES "public"."borrower_invites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "documents_deal_sha256_scope_uq" ON "documents" USING btree ("deal_id","sha256",coalesce("uploaded_via_invite_id", '00000000-0000-0000-0000-000000000000'::uuid));--> statement-breakpoint
CREATE INDEX "documents_invite_idx" ON "documents" USING btree ("uploaded_via_invite_id") WHERE "documents"."uploaded_via_invite_id" is not null;