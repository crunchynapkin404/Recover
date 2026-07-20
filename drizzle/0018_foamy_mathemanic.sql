CREATE TABLE "llm_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"model" text NOT NULL,
	"slot" text NOT NULL,
	"purpose" text NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "perceived_exertion" real;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "feel" text;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "debrief_notes" text;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "debrief_state" text;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "debrief_thread_id" uuid;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "review_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "search" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce(content, ''))) STORED;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "last_activity_poll_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notification_prefs" ADD COLUMN "ride_debriefs_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_prefs" ADD COLUMN "debrief_push_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "wellness_daily" ADD COLUMN "search" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce(notes, ''))) STORED;--> statement-breakpoint
ALTER TABLE "llm_usage" ADD CONSTRAINT "llm_usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "llm_usage_user_created_idx" ON "llm_usage" USING btree ("user_id","created_at");--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_debrief_thread_id_chat_threads_id_fk" FOREIGN KEY ("debrief_thread_id") REFERENCES "public"."chat_threads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activities_user_debrief_idx" ON "activities" USING btree ("user_id","debrief_state");--> statement-breakpoint
CREATE INDEX "chat_messages_search_idx" ON "chat_messages" USING gin ("search");--> statement-breakpoint
CREATE INDEX "wellness_search_idx" ON "wellness_daily" USING gin ("search");