-- Custom SQL migration file, put your code below! --
-- Archive every `active` training plan except the newest per user.
--
-- Seven code paths ask "which is this athlete's active plan?". Five asked
-- with an unordered findFirst, which Postgres answers in heap order, so on
-- an account holding more than one active row the coach, the dashboard and
-- the week engine could each resolve a DIFFERENT plan. Live evidence
-- 2026-08-01: three active rows from one 2026-07-15 creation retry, the
-- coach reporting week 1 against an engine running week 4, and
-- update_training_plan writing to a row nothing else read.
--
-- getActivePlan() (src/lib/active-plan.ts) now resolves the newest active
-- row everywhere. This migration makes the stored data agree with that
-- choice, so it changes NO observable behaviour — it removes the ambiguity
-- sitting behind it. generateTrainingPlan already archives the previous
-- plan before inserting a new one (src/lib/training-plan.ts:813), so this
-- is a one-time cleanup of rows predating that guard, not a recurring
-- repair.
--
-- Idempotent: a second run matches nothing, because after the first run no
-- user has two active rows for the EXISTS clause to find. The
-- (created_at, id) tuple keeps the ordering total, so two rows sharing a
-- timestamp still resolve deterministically instead of both surviving or
-- both being archived.
UPDATE training_plans p
SET status = 'archived'
WHERE p.status = 'active'
  AND EXISTS (
    SELECT 1
    FROM training_plans q
    WHERE q.user_id = p.user_id
      AND q.status = 'active'
      AND (q.created_at, q.id) > (p.created_at, p.id)
  );
