ALTER TABLE "wellness_daily" ADD COLUMN "sleep_deep_secs" integer;--> statement-breakpoint
ALTER TABLE "wellness_daily" ADD COLUMN "sleep_rem_secs" integer;--> statement-breakpoint
ALTER TABLE "wellness_daily" ADD COLUMN "sleep_light_secs" integer;--> statement-breakpoint
ALTER TABLE "wellness_daily" ADD COLUMN "sleep_awake_secs" integer;--> statement-breakpoint
ALTER TABLE "wellness_daily" ADD COLUMN "bed_start" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "wellness_daily" ADD COLUMN "bed_end" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "wellness_daily" ADD COLUMN "temp_deviation_c" real;--> statement-breakpoint
ALTER TABLE "wellness_daily" ADD COLUMN "respiratory_rate" real;--> statement-breakpoint
ALTER TABLE "wellness_daily" ADD COLUMN "systolic" real;--> statement-breakpoint
ALTER TABLE "wellness_daily" ADD COLUMN "diastolic" real;--> statement-breakpoint
ALTER TABLE "wellness_daily" ADD COLUMN "body_fat_pct" real;--> statement-breakpoint
ALTER TABLE "wellness_daily" ADD COLUMN "field_sources" jsonb;