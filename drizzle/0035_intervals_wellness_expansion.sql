ALTER TABLE "wellness_daily" ADD COLUMN IF NOT EXISTS "sleeping_hr" real;
ALTER TABLE "wellness_daily" ADD COLUMN IF NOT EXISTS "hrv_sdnn_ms" real;
ALTER TABLE "wellness_daily" ADD COLUMN IF NOT EXISTS "readiness" real;
ALTER TABLE "wellness_daily" ADD COLUMN IF NOT EXISTS "hydration_l" real;
ALTER TABLE "wellness_daily" ADD COLUMN IF NOT EXISTS "steps" integer;
ALTER TABLE "wellness_daily" ADD COLUMN IF NOT EXISTS "sleep_quality" integer;

ALTER TABLE "connections" ADD COLUMN IF NOT EXISTS "last_wellness_poll_at" timestamp with time zone;
