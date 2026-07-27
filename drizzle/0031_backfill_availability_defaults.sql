-- Custom SQL migration file, put your code below! --
-- Backfill a standard week (availability_defaults) for every existing
-- athlete who has an active training plan but no defaults yet.
-- resolveWeek() returns [] for any weekday with no availability_defaults
-- row, and nothing else in the codebase ever creates those rows — every
-- such athlete's rollover silently materializes an all-rest week.
--
-- Per weekday (Monday = 0 .. Sunday = 6), for each affected user:
--   1. Prefer that weekday's availableBlocks from the athlete's most
--      recent week_plans row (the best record of what they actually had).
--   2. Where that yields nothing (no week history at all, or that day
--      was empty), fall back to the active plan's constraints, spread the
--      way the deleted prefillAvailability did for a fresh athlete:
--      hoursPerWeek/daysPerWeek minutes on the LAST `daysPerWeek` days of
--      the week, as a single untimed block; other days get no block.
--
-- Idempotent: `target_users` excludes any user who already has even one
-- availability_defaults row, and the insert itself is additionally
-- guarded by WHERE NOT EXISTS plus ON CONFLICT DO NOTHING against the
-- (user_id, weekday) unique index — a second run touches zero rows.
-- Migration 0029's non-idempotent backfill (caught only in review, would
-- have destroyed every stored workout on a re-run) is the mistake this is
-- built not to repeat.
WITH target_users AS (
  SELECT DISTINCT tp.user_id
  FROM training_plans tp
  WHERE tp.status = 'active'
    AND NOT EXISTS (
      SELECT 1 FROM availability_defaults ad WHERE ad.user_id = tp.user_id
    )
),
latest_plan AS (
  -- One canonical active plan per user, for the constraints fallback.
  SELECT DISTINCT ON (tp.user_id) tp.user_id, tp.constraints
  FROM training_plans tp
  JOIN target_users tu ON tu.user_id = tp.user_id
  WHERE tp.status = 'active'
  ORDER BY tp.user_id, tp.created_at DESC
),
latest_week AS (
  SELECT DISTINCT ON (wp.user_id) wp.user_id, wp.days
  FROM week_plans wp
  JOIN target_users tu ON tu.user_id = wp.user_id
  ORDER BY wp.user_id, wp.week_start DESC
),
weekdays AS (
  SELECT generate_series(0, 6) AS weekday
),
week_blocks AS (
  -- weekday (Monday = 0) -> that day's stored availableBlocks, derived
  -- from the date itself rather than array position, matching resolve.ts.
  SELECT DISTINCT ON (lw.user_id, weekday)
    lw.user_id,
    ((EXTRACT(DOW FROM (d ->> 'date')::date)::int + 6) % 7) AS weekday,
    (d -> 'availableBlocks') AS blocks
  FROM latest_week lw, jsonb_array_elements(lw.days) AS d
),
fallback AS (
  SELECT
    tu.user_id,
    wd.weekday,
    COALESCE((lp.constraints ->> 'daysPerWeek')::int, 0) AS days_per_week,
    COALESCE((lp.constraints ->> 'hoursPerWeek')::numeric, 0) AS hours_per_week
  FROM target_users tu
  CROSS JOIN weekdays wd
  LEFT JOIN latest_plan lp ON lp.user_id = tu.user_id
),
resolved AS (
  SELECT
    f.user_id,
    f.weekday,
    CASE
      WHEN wb.blocks IS NOT NULL AND jsonb_array_length(wb.blocks) > 0
        THEN wb.blocks
      WHEN f.days_per_week > 0 AND f.weekday >= (7 - f.days_per_week)
        THEN jsonb_build_array(jsonb_build_object(
          'start', NULL,
          'end', NULL,
          'mins', GREATEST(
            0,
            ROUND((f.hours_per_week * 60 / f.days_per_week) / 5) * 5
          )::int,
          'energy', 'normal',
          'sports', NULL
        ))
      ELSE '[]'::jsonb
    END AS blocks
  FROM fallback f
  LEFT JOIN week_blocks wb
    ON wb.user_id = f.user_id AND wb.weekday = f.weekday
)
INSERT INTO availability_defaults (user_id, weekday, blocks)
SELECT r.user_id, r.weekday, r.blocks
FROM resolved r
WHERE NOT EXISTS (
  SELECT 1 FROM availability_defaults ad
  WHERE ad.user_id = r.user_id AND ad.weekday = r.weekday
)
ON CONFLICT (user_id, weekday) DO NOTHING;
