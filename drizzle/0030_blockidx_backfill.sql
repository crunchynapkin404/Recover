-- Custom SQL migration file, put your code below! ----
-- Stamp `blockIdx` onto every stored session. Every stored day currently
-- has at most one block, so 0 is correct for all of them. Idempotent:
-- gated on the key's absence (`w ? 'blockIdx'`), a re-run is a no-op — the
-- same discipline migration 0029's backfill was missing, which would have
-- destroyed every workout on a second run.
UPDATE "week_plans" SET "days" = (
  SELECT jsonb_agg(
    d || jsonb_build_object(
      'workouts',
      COALESCE((
        SELECT jsonb_agg(
          CASE WHEN w ? 'blockIdx' THEN w
               ELSE w || jsonb_build_object('blockIdx', 0) END
          ORDER BY wo
        )
        FROM jsonb_array_elements(d->'workouts') WITH ORDINALITY AS t2(w, wo)
      ), '[]'::jsonb)
    )
    ORDER BY ord
  )
  FROM jsonb_array_elements("days") WITH ORDINALITY AS t(d, ord)
)
-- jsonb_array_length() errors on a non-array, and Postgres does not promise
-- to evaluate the jsonb_typeof() guard first, so express the whole test as
-- one CASE rather than relying on AND short-circuiting. The app never writes
-- a scalar "days", but an error here aborts the entire migration transaction.
WHERE CASE
        WHEN jsonb_typeof("days") = 'array' THEN jsonb_array_length("days")
        ELSE 0
      END > 0;
