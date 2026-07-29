CREATE TYPE "public"."org_kind" AS ENUM('lender', 'broker_firm', 'solo_broker');--> statement-breakpoint
CREATE TYPE "public"."profile_status" AS ENUM('active', 'deactivated');--> statement-breakpoint
ALTER TYPE "public"."user_role" ADD VALUE 'org_owner';--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "status" "profile_status" DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "kind" "org_kind" DEFAULT 'lender' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "parent_tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "settings" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_parent_tenant_id_tenants_id_fk" FOREIGN KEY ("parent_tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;