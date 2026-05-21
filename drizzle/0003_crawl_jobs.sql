CREATE TYPE "public"."crawl_job_source" AS ENUM('tiktok', 'meta', 'google');--> statement-breakpoint
CREATE TYPE "public"."crawl_job_status" AS ENUM('pending', 'running', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "crawl_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid,
	"source" "crawl_job_source" NOT NULL,
	"keyword" text NOT NULL,
	"region" text NOT NULL,
	"status" "crawl_job_status" DEFAULT 'pending' NOT NULL,
	"ads_found" integer DEFAULT 0 NOT NULL,
	"ads_new" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"scheduled_for" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "crawl_jobs" ADD CONSTRAINT "crawl_jobs_product_id_my_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."my_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "crawl_jobs_dispatch_idx" ON "crawl_jobs" USING btree ("status","scheduled_for");--> statement-breakpoint
CREATE INDEX "crawl_jobs_product_idx" ON "crawl_jobs" USING btree ("product_id","created_at" DESC NULLS LAST);