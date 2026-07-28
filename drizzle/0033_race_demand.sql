ALTER TABLE "races" ADD COLUMN IF NOT EXISTS "event_days" integer NOT NULL DEFAULT 1;
ALTER TABLE "races" ADD COLUMN IF NOT EXISTS "distance_km" real;
ALTER TABLE "races" ADD COLUMN IF NOT EXISTS "elevation_m" integer;
ALTER TABLE "races" ADD COLUMN IF NOT EXISTS "demand_hours_override" real;

CREATE TABLE IF NOT EXISTS "race_stages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "race_id" uuid NOT NULL REFERENCES "races"("id") ON DELETE CASCADE,
  "day_number" integer NOT NULL,
  "distance_km" real,
  "elevation_m" integer,
  "name" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "race_stages_race_day_uq"
  ON "race_stages" ("race_id", "day_number");

ALTER TABLE "body_prefs" ADD COLUMN IF NOT EXISTS "level_override" text;
