CREATE TABLE "document_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"logical_document_id" uuid NOT NULL,
	"entity_id" uuid,
	"extracted_name" text NOT NULL,
	"source_page" integer,
	"method" text NOT NULL,
	"score_bps" integer NOT NULL,
	"band" text NOT NULL,
	"state" text DEFAULT 'suggested' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "logical_documents" ADD COLUMN "entity_hint" text;--> statement-breakpoint
ALTER TABLE "document_identities" ADD CONSTRAINT "document_identities_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_identities" ADD CONSTRAINT "document_identities_logical_document_id_logical_documents_id_fk" FOREIGN KEY ("logical_document_id") REFERENCES "public"."logical_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_identities" ADD CONSTRAINT "document_identities_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_identities_tenant_idx" ON "document_identities" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "document_identities_ld_idx" ON "document_identities" USING btree ("logical_document_id");