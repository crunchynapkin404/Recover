CREATE TABLE "coach_memories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"category" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat_threads" ADD COLUMN "ephemeral" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "llm_settings" ADD COLUMN "model_quick" text;--> statement-breakpoint
ALTER TABLE "llm_settings" ADD COLUMN "model_deep" text;--> statement-breakpoint
ALTER TABLE "llm_settings" ADD COLUMN "default_mode" text DEFAULT 'deep' NOT NULL;--> statement-breakpoint
ALTER TABLE "llm_settings" ADD COLUMN "coach_personality" text DEFAULT 'encouraging' NOT NULL;--> statement-breakpoint
ALTER TABLE "coach_memories" ADD CONSTRAINT "coach_memories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "coach_memories_user_idx" ON "coach_memories" USING btree ("user_id");--> statement-breakpoint
UPDATE "llm_settings" SET "model_quick" = "model", "model_deep" = "model" WHERE "model_quick" IS NULL;