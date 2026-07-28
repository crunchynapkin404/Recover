CREATE TABLE "availability_defaults" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"weekday" smallint NOT NULL,
	"blocks" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "availability_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"date" date NOT NULL,
	"blocks" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "week_plans" ADD COLUMN "availability_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "availability_defaults" ADD CONSTRAINT "availability_defaults_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_overrides" ADD CONSTRAINT "availability_overrides_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "availability_defaults_user_weekday_uq" ON "availability_defaults" USING btree ("user_id","weekday");--> statement-breakpoint
CREATE UNIQUE INDEX "availability_overrides_user_date_uq" ON "availability_overrides" USING btree ("user_id","date");
--> statement-breakpoint
-- Backfill week_plans.days into the block/plural shape. Legacy blocks keep
-- null clock times on purpose: the migration must not invent times the
-- athlete never gave.
UPDATE "week_plans" SET "days" = (
  SELECT jsonb_agg(
    (d - 'workout')
    || jsonb_build_object(
      'workouts',
      CASE
        WHEN d ? 'workouts' THEN d->'workouts'
        WHEN d->'workout' IS NULL OR d->'workout' = 'null'::jsonb
          THEN '[]'::jsonb
        ELSE jsonb_build_array(
          (d->'workout') || jsonb_build_object(
            'purpose',
            CASE d->'workout'->>'type'
              WHEN 'Recovery'  THEN 'recovery'
              WHEN 'Endurance' THEN 'aerobic_base'
              WHEN 'Long'      THEN 'long'
              WHEN 'Tempo'     THEN 'threshold'
              WHEN 'Intervals' THEN 'vo2max'
              WHEN 'Brick'     THEN 'brick'
              ELSE 'aerobic_base'
            END,
            'minEffectiveMins',
            CASE d->'workout'->>'type'
              WHEN 'Recovery'  THEN 20
              WHEN 'Endurance' THEN 40
              WHEN 'Long'      THEN 90
              WHEN 'Tempo'     THEN 45
              WHEN 'Intervals' THEN 40
              WHEN 'Brick'     THEN 60
              ELSE 40
            END
          )
        )
      END,
      'availableBlocks',
      CASE
        WHEN d ? 'availableBlocks' THEN d->'availableBlocks'
        WHEN (d->>'availableMins') ~ '^[0-9]+$' AND (d->>'availableMins')::int > 0
          THEN jsonb_build_array(jsonb_build_object(
            'start', NULL, 'end', NULL,
            'mins', (d->>'availableMins')::int,
            'energy', 'normal', 'sports', NULL
          ))
        ELSE '[]'::jsonb
      END
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