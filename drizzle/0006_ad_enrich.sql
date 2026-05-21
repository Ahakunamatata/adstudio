CREATE TYPE "public"."enrich_queue_status" AS ENUM('pending', 'running', 'done', 'failed');--> statement-breakpoint
CREATE TABLE "enrich_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ad_id" text NOT NULL,
	"status" "enrich_queue_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"last_error" text,
	"scheduled_for" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ads" ADD COLUMN "transcript" text;--> statement-breakpoint
ALTER TABLE "ads" ADD COLUMN "landing_page_url" text;--> statement-breakpoint
ALTER TABLE "ads" ADD COLUMN "metrics" jsonb;--> statement-breakpoint
ALTER TABLE "ads" ADD COLUMN "enriched_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "enrich_queue" ADD CONSTRAINT "enrich_queue_ad_id_ads_id_fk" FOREIGN KEY ("ad_id") REFERENCES "public"."ads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "enrich_queue_dispatch_idx" ON "enrich_queue" USING btree ("status","scheduled_for");--> statement-breakpoint
CREATE INDEX "enrich_queue_ad_id_idx" ON "enrich_queue" USING btree ("ad_id");--> statement-breakpoint
CREATE INDEX "ads_enriched_at_idx" ON "ads" USING btree ("enriched_at");