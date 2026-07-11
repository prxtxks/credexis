CREATE TYPE "public"."addback_category" AS ENUM('officer_comp', 'depreciation_amortization', 'interest', 'one_time', 'rent_adjustment', 'discretionary');--> statement-breakpoint
CREATE TYPE "public"."addback_state" AS ENUM('suggested', 'accepted', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."deal_status" AS ENUM('intake', 'parsing', 'review', 'complete');--> statement-breakpoint
CREATE TYPE "public"."deal_type" AS ENUM('business_acquisition', 'working_capital', 'real_estate', 'refinance');--> statement-breakpoint
CREATE TYPE "public"."document_status" AS ENUM('uploaded', 'processing', 'processed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."entity_kind" AS ENUM('applicant', 'target', 'guarantor', 'spouse', 'epc', 'oc');--> statement-breakpoint
CREATE TYPE "public"."extraction_run_status" AS ENUM('running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."fact_method" AS ENUM('vendor', 'llm', 'consensus', 'transcript', 'override', 'human');--> statement-breakpoint
CREATE TYPE "public"."fact_status" AS ENUM('suggested', 'accepted', 'overridden', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."issue_severity" AS ENUM('info', 'warning', 'error', 'critical');--> statement-breakpoint
CREATE TYPE "public"."issue_status" AS ENUM('open', 'resolved', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."metric_value_kind" AS ENUM('cents', 'ratio');--> statement-breakpoint
CREATE TYPE "public"."period_kind" AS ENUM('fiscal_year', 'interim', 'ttm', 'projection');--> statement-breakpoint
CREATE TYPE "public"."registry_dtype" AS ENUM('money', 'integer', 'percent', 'text', 'date');--> statement-breakpoint
CREATE TYPE "public"."statement_kind" AS ENUM('income_statement', 'balance_sheet', 'cash_flow', 'other');--> statement-breakpoint
CREATE TYPE "public"."tax_structure" AS ENUM('c_corp', 's_corp', 'partnership', 'sole_prop', 'individual');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'underwriter', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."validation_gate" AS ENUM('G1', 'G2', 'G3', 'G4', 'G5', 'G6');--> statement-breakpoint
CREATE TYPE "public"."virus_scan_status" AS ENUM('pending', 'clean', 'infected', 'failed');--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"email" text NOT NULL,
	"full_name" text,
	"role" "user_role" DEFAULT 'underwriter' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "form_registry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"form_family" text NOT NULL,
	"tax_year" integer NOT NULL,
	"field_id" text NOT NULL,
	"line_number" text,
	"label" text NOT NULL,
	"aliases" text[] DEFAULT '{}' NOT NULL,
	"page_hint" integer,
	"dtype" "registry_dtype" NOT NULL,
	"sign" smallint DEFAULT 1 NOT NULL,
	"taxonomy_node_key" text,
	"relations" jsonb,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learned_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"label_norm" text NOT NULL,
	"taxonomy_node_key" text NOT NULL,
	"usage_count" integer DEFAULT 1 NOT NULL,
	"confidence" real DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "policy_packs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" text NOT NULL,
	"effective_date" date NOT NULL,
	"rules" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "policy_packs_version_unique" UNIQUE("version")
);
--> statement-breakpoint
CREATE TABLE "taxonomy_nodes" (
	"key" text PRIMARY KEY NOT NULL,
	"parent_key" text,
	"label" text NOT NULL,
	"statement" "statement_kind" NOT NULL,
	"is_addback_relevant" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" "deal_type" NOT NULL,
	"status" "deal_status" DEFAULT 'intake' NOT NULL,
	"policy_pack_id" uuid NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"deal_id" uuid NOT NULL,
	"kind" "entity_kind" NOT NULL,
	"name" text NOT NULL,
	"tax_structure" "tax_structure",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"kind" "period_kind" NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"label" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"deal_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"storage_path" text NOT NULL,
	"sha256" text NOT NULL,
	"bytes" integer NOT NULL,
	"mime_type" text NOT NULL,
	"virus_scan" "virus_scan_status" DEFAULT 'pending' NOT NULL,
	"status" "document_status" DEFAULT 'uploaded' NOT NULL,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "logical_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"entity_id" uuid,
	"entity_confirmed" boolean DEFAULT false NOT NULL,
	"form_family" text NOT NULL,
	"tax_year" integer,
	"page_start" integer NOT NULL,
	"page_end" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"logical_document_id" uuid NOT NULL,
	"page_number" integer NOT NULL,
	"image_path" text,
	"ocr_text_path" text
);
--> statement-breakpoint
CREATE TABLE "addbacks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"deal_id" uuid NOT NULL,
	"fact_id" uuid,
	"category" "addback_category" NOT NULL,
	"state" "addback_state" DEFAULT 'suggested' NOT NULL,
	"amount_cents" bigint NOT NULL,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "extraction_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"deal_id" uuid NOT NULL,
	"document_id" uuid,
	"stage" text NOT NULL,
	"extractor_name" text NOT NULL,
	"extractor_version" text NOT NULL,
	"model" text,
	"page_count" integer,
	"status" "extraction_run_status" DEFAULT 'running' NOT NULL,
	"error" text,
	"cost_micro_usd" bigint DEFAULT 0 NOT NULL,
	"metadata" jsonb,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"deal_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"taxonomy_node_key" text NOT NULL,
	"registry_field_id" text,
	"value_cents" bigint NOT NULL,
	"source_logical_document_id" uuid,
	"source_page" integer,
	"source_bbox" jsonb,
	"source_transcript_line" text,
	"method" "fact_method" NOT NULL,
	"confidence" real,
	"status" "fact_status" DEFAULT 'suggested' NOT NULL,
	"original_value_cents" bigint,
	"superseded_by" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "computed_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"deal_id" uuid NOT NULL,
	"scenario_id" uuid,
	"engine_version" text NOT NULL,
	"metric" text NOT NULL,
	"entity_id" uuid,
	"period_id" uuid,
	"value_kind" "metric_value_kind" NOT NULL,
	"value_cents" bigint,
	"ratio_mantissa" bigint,
	"ratio_scale" integer,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"deal_id" uuid NOT NULL,
	"gate" "validation_gate" NOT NULL,
	"severity" "issue_severity" NOT NULL,
	"fact_ids" uuid[] DEFAULT '{}' NOT NULL,
	"message" text NOT NULL,
	"status" "issue_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "loan_scenarios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"deal_id" uuid NOT NULL,
	"name" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"rate_spec" jsonb NOT NULL,
	"term_months" integer NOT NULL,
	"structure" jsonb,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"table_name" text NOT NULL,
	"row_id" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_registry" ADD CONSTRAINT "form_registry_taxonomy_node_key_taxonomy_nodes_key_fk" FOREIGN KEY ("taxonomy_node_key") REFERENCES "public"."taxonomy_nodes"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learned_mappings" ADD CONSTRAINT "learned_mappings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learned_mappings" ADD CONSTRAINT "learned_mappings_taxonomy_node_key_taxonomy_nodes_key_fk" FOREIGN KEY ("taxonomy_node_key") REFERENCES "public"."taxonomy_nodes"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_policy_pack_id_policy_packs_id_fk" FOREIGN KEY ("policy_pack_id") REFERENCES "public"."policy_packs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "periods" ADD CONSTRAINT "periods_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "periods" ADD CONSTRAINT "periods_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logical_documents" ADD CONSTRAINT "logical_documents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logical_documents" ADD CONSTRAINT "logical_documents_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logical_documents" ADD CONSTRAINT "logical_documents_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_logical_document_id_logical_documents_id_fk" FOREIGN KEY ("logical_document_id") REFERENCES "public"."logical_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "addbacks" ADD CONSTRAINT "addbacks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "addbacks" ADD CONSTRAINT "addbacks_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "addbacks" ADD CONSTRAINT "addbacks_fact_id_facts_id_fk" FOREIGN KEY ("fact_id") REFERENCES "public"."facts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraction_runs" ADD CONSTRAINT "extraction_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraction_runs" ADD CONSTRAINT "extraction_runs_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraction_runs" ADD CONSTRAINT "extraction_runs_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facts" ADD CONSTRAINT "facts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facts" ADD CONSTRAINT "facts_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facts" ADD CONSTRAINT "facts_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facts" ADD CONSTRAINT "facts_period_id_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facts" ADD CONSTRAINT "facts_taxonomy_node_key_taxonomy_nodes_key_fk" FOREIGN KEY ("taxonomy_node_key") REFERENCES "public"."taxonomy_nodes"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facts" ADD CONSTRAINT "facts_source_logical_document_id_logical_documents_id_fk" FOREIGN KEY ("source_logical_document_id") REFERENCES "public"."logical_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "computed_metrics" ADD CONSTRAINT "computed_metrics_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "computed_metrics" ADD CONSTRAINT "computed_metrics_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "computed_metrics" ADD CONSTRAINT "computed_metrics_scenario_id_loan_scenarios_id_fk" FOREIGN KEY ("scenario_id") REFERENCES "public"."loan_scenarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "computed_metrics" ADD CONSTRAINT "computed_metrics_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "computed_metrics" ADD CONSTRAINT "computed_metrics_period_id_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_scenarios" ADD CONSTRAINT "loan_scenarios_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan_scenarios" ADD CONSTRAINT "loan_scenarios_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "form_registry_form_year_field" ON "form_registry" USING btree ("form_family","tax_year","field_id");--> statement-breakpoint
CREATE UNIQUE INDEX "learned_mappings_tenant_label" ON "learned_mappings" USING btree ("tenant_id","label_norm");--> statement-breakpoint
CREATE INDEX "deals_tenant_idx" ON "deals" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "entities_tenant_idx" ON "entities" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "entities_deal_idx" ON "entities" USING btree ("deal_id");--> statement-breakpoint
CREATE INDEX "periods_tenant_idx" ON "periods" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "periods_entity_idx" ON "periods" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "documents_tenant_idx" ON "documents" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "documents_deal_idx" ON "documents" USING btree ("deal_id");--> statement-breakpoint
CREATE INDEX "documents_sha256_idx" ON "documents" USING btree ("sha256");--> statement-breakpoint
CREATE INDEX "logical_documents_tenant_idx" ON "logical_documents" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "logical_documents_document_idx" ON "logical_documents" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "pages_tenant_idx" ON "pages" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "pages_logical_document_idx" ON "pages" USING btree ("logical_document_id");--> statement-breakpoint
CREATE INDEX "addbacks_tenant_idx" ON "addbacks" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "addbacks_deal_idx" ON "addbacks" USING btree ("deal_id");--> statement-breakpoint
CREATE INDEX "extraction_runs_tenant_idx" ON "extraction_runs" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "extraction_runs_deal_idx" ON "extraction_runs" USING btree ("deal_id");--> statement-breakpoint
CREATE INDEX "facts_tenant_idx" ON "facts" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "facts_deal_idx" ON "facts" USING btree ("deal_id");--> statement-breakpoint
CREATE INDEX "facts_entity_period_idx" ON "facts" USING btree ("entity_id","period_id");--> statement-breakpoint
CREATE INDEX "facts_taxonomy_idx" ON "facts" USING btree ("taxonomy_node_key");--> statement-breakpoint
CREATE INDEX "computed_metrics_tenant_idx" ON "computed_metrics" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "computed_metrics_deal_scenario_idx" ON "computed_metrics" USING btree ("deal_id","scenario_id");--> statement-breakpoint
CREATE INDEX "issues_tenant_idx" ON "issues" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "issues_deal_idx" ON "issues" USING btree ("deal_id");--> statement-breakpoint
CREATE INDEX "loan_scenarios_tenant_idx" ON "loan_scenarios" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "loan_scenarios_deal_idx" ON "loan_scenarios" USING btree ("deal_id");--> statement-breakpoint
CREATE INDEX "audit_log_tenant_idx" ON "audit_log" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "audit_log_table_row_idx" ON "audit_log" USING btree ("table_name","row_id");