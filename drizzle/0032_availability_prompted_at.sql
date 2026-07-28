-- The weekly availability nudge needs a record of having been sent.
-- shouldPromptAvailability only checked "is the week unconfirmed and still
-- inside the 4-day window", and the scheduler's sync job re-chains daily, so
-- an athlete who never confirmed was pushed Mon, Tue, Wed, Thu and Fri. The
-- spec says once per week; one week_plans row per user-week makes this column
-- exactly that guard.
--
-- Additive and idempotent: existing rows get NULL, which reads as "not yet
-- prompted this week" — the same state they were already in.
ALTER TABLE "week_plans" ADD COLUMN IF NOT EXISTS "availability_prompted_at" timestamp with time zone;
