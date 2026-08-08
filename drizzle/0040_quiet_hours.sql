ALTER TABLE "notification_prefs"
  ADD COLUMN IF NOT EXISTS "quiet_hours_start" smallint,
  ADD COLUMN IF NOT EXISTS "quiet_hours_end" smallint;