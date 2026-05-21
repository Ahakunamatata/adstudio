CREATE TYPE "public"."ad_source" AS ENUM('meta', 'tiktok', 'google');--> statement-breakpoint
CREATE TYPE "public"."ad_status" AS ENUM('active', 'down', 'stale');--> statement-breakpoint
CREATE TYPE "public"."user_feedback" AS ENUM('positive', 'negative');--> statement-breakpoint
CREATE TABLE "ad_embeddings" (
	"ad_id" text PRIMARY KEY NOT NULL,
	"model" text NOT NULL,
	"embedding" vector(1024) NOT NULL,
	"embedded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ads" (
	"id" text PRIMARY KEY NOT NULL,
	"source" "ad_source" NOT NULL,
	"source_id" text NOT NULL,
	"advertiser_name" text,
	"advertiser_page_id" text,
	"ad_creative_bodies" text[],
	"ad_creative_titles" text[],
	"ad_creative_link_descriptions" text[],
	"ad_creative_link_captions" text[],
	"video_url" text,
	"thumbnail_url" text,
	"snapshot_url" text,
	"region" text,
	"publisher_platforms" text[],
	"languages" text[],
	"delivery_start_at" timestamp with time zone,
	"delivery_stop_at" timestamp with time zone,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" "ad_status" DEFAULT 'active' NOT NULL,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "my_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"intro" text DEFAULT '' NOT NULL,
	"pain_points" text DEFAULT '' NOT NULL,
	"url" text DEFAULT '' NOT NULL,
	"images" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"inferred_industry" text,
	"inferred_keywords" text[] DEFAULT '{}'::text[],
	"cleaned_intro" text,
	"cleaned_pain_points" text,
	"use_for_cloning" integer DEFAULT 1 NOT NULL,
	"created_by" text DEFAULT 'demo-user' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_ad_matches" (
	"product_id" uuid NOT NULL,
	"ad_id" text NOT NULL,
	"relevance_score" integer NOT NULL,
	"matched_keywords" text[] DEFAULT '{}'::text[],
	"user_feedback" "user_feedback",
	"surfaced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_ad_matches_product_id_ad_id_pk" PRIMARY KEY("product_id","ad_id")
);
--> statement-breakpoint
ALTER TABLE "ad_embeddings" ADD CONSTRAINT "ad_embeddings_ad_id_ads_id_fk" FOREIGN KEY ("ad_id") REFERENCES "public"."ads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_ad_matches" ADD CONSTRAINT "product_ad_matches_product_id_my_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."my_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_ad_matches" ADD CONSTRAINT "product_ad_matches_ad_id_ads_id_fk" FOREIGN KEY ("ad_id") REFERENCES "public"."ads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ad_embeddings_hnsw_idx" ON "ad_embeddings" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "ads_source_idx" ON "ads" USING btree ("source");--> statement-breakpoint
CREATE INDEX "ads_region_idx" ON "ads" USING btree ("region");--> statement-breakpoint
CREATE INDEX "ads_advertiser_idx" ON "ads" USING btree ("advertiser_name");--> statement-breakpoint
CREATE INDEX "ads_first_seen_idx" ON "ads" USING btree ("first_seen_at");--> statement-breakpoint
CREATE INDEX "ads_status_last_seen_idx" ON "ads" USING btree ("status","last_seen_at");--> statement-breakpoint
CREATE INDEX "my_products_created_by_idx" ON "my_products" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "my_products_created_at_idx" ON "my_products" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "pam_product_score_idx" ON "product_ad_matches" USING btree ("product_id","relevance_score" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "pam_ad_idx" ON "product_ad_matches" USING btree ("ad_id");