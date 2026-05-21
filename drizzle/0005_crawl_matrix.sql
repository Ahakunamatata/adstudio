CREATE TABLE "crawl_matrix" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid,
	"source" "crawl_job_source" NOT NULL,
	"keyword" text NOT NULL,
	"region" text NOT NULL,
	"cadence_hours" integer DEFAULT 24 NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"enabled" integer DEFAULT 1 NOT NULL,
	"last_run_at" timestamp with time zone,
	"next_run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "crawl_matrix" ADD CONSTRAINT "crawl_matrix_product_id_my_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."my_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "crawl_matrix_due_idx" ON "crawl_matrix" USING btree ("enabled","next_run_at");--> statement-breakpoint
CREATE INDEX "crawl_matrix_product_idx" ON "crawl_matrix" USING btree ("product_id","created_at" DESC NULLS LAST);