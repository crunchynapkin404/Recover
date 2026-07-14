ALTER TABLE "api_tokens" ADD COLUMN IF NOT EXISTS "lookup_prefix" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD COLUMN IF NOT EXISTS "scopes" text DEFAULT 'read' NOT NULL;--> statement-breakpoint
ALTER TABLE "wellness_daily" ADD COLUMN IF NOT EXISTS "mood" text;--> statement-breakpoint
ALTER TABLE "wellness_daily" ADD COLUMN IF NOT EXISTS "tags" jsonb;--> statement-breakpoint
ALTER TABLE "wellness_daily" ADD COLUMN IF NOT EXISTS "notes" text;
