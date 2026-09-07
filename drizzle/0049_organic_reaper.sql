ALTER TABLE "notification_prefs" ALTER COLUMN "weekly_review_day" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "notification_prefs" ALTER COLUMN "weekly_review_hour" SET DEFAULT 18;--> statement-breakpoint
-- The column default only reaches rows written from here on, and every
-- existing athlete already has a notification_prefs row (getOrCreatePrefs in
-- push.ts makes one for everyone). Without this they keep Monday 07:00 and the
-- change means nothing to the people who reported the problem.
--
-- Scoped to rows still sitting on the OLD DEFAULT exactly. A row that says
-- anything else was chosen deliberately in Settings and is not ours to move;
-- the cost of that precision is that an athlete who deliberately picked
-- Monday 07:00 is moved with everyone else, which is not distinguishable from
-- "never touched it" without a column recording the choice.
UPDATE "notification_prefs"
SET "weekly_review_day" = 0, "weekly_review_hour" = 18
WHERE "weekly_review_day" = 1 AND "weekly_review_hour" = 7;
