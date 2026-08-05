-- v0.42: races.sport becomes the single authority for a plan's sport.
--
-- Backfill first, constrain second. Any row this CASE cannot place is left
-- NULL and the NOT-NULL constraint applied below then FAILS the migration —
-- deliberately.
-- Guessing a sport is the defect this release exists to remove, and a
-- migration that guesses would reintroduce it at the one moment nobody is
-- watching.
--
-- EXACT lookup on a normalised key — never substring matching. Three
-- attempts at heuristic matching each produced a confidently wrong sport
-- ("time trial" -> Triathlon; "10k open water swim" -> Run), so the
-- TypeScript side is now a lookup table and this mirrors it key for key.
-- tests/race-sport-migration.test.ts asserts the two agree.
--
-- The normaliser strips everything that is not a letter, digit or dot, so
-- 'gran_fondo', 'GranFondo' and 'gran fondo' all collapse to 'granfondo'.
UPDATE races SET sport = CASE regexp_replace(lower(race_type), '[^a-z0-9.]', '', 'g')
  WHEN 'marathon'      THEN 'Run'
  WHEN 'halfmarathon'  THEN 'Run'
  WHEN '10k'           THEN 'Run'
  WHEN '5k'            THEN 'Run'
  WHEN 'ultra'         THEN 'Run'
  WHEN 'ultramarathon' THEN 'Run'
  WHEN 'parkrun'       THEN 'Run'
  WHEN 'ironman'       THEN 'Triathlon'
  WHEN '70.3'          THEN 'Triathlon'
  WHEN 'olympictri'    THEN 'Triathlon'
  WHEN 'sprinttri'     THEN 'Triathlon'
  WHEN 'halfironman'   THEN 'Triathlon'
  WHEN 'triathlon'     THEN 'Triathlon'
  WHEN 'granfondo'     THEN 'Bike'
  WHEN 'century'       THEN 'Bike'
  WHEN 'crit'          THEN 'Bike'
  WHEN 'criterium'     THEN 'Bike'
  ELSE NULL
END
WHERE sport IS NULL;

ALTER TABLE "races" ALTER COLUMN "sport" SET NOT NULL;
