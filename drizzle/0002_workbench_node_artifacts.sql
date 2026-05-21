CREATE TYPE "public"."workbench_artifact_business_type" AS ENUM('objective_breakdown', 'clone_strategy', 'ad_script', 'storyboard_frame', 'final_video');--> statement-breakpoint
CREATE TABLE "workbench_node_artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" text NOT NULL,
	"node_id" text NOT NULL,
	"business_type" "workbench_artifact_business_type" NOT NULL,
	"content" jsonb NOT NULL,
	"raw_text" text,
	"model" text NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "workbench_artifacts_session_idx" ON "workbench_node_artifacts" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "workbench_artifacts_node_idx" ON "workbench_node_artifacts" USING btree ("node_id","created_at" DESC NULLS LAST);