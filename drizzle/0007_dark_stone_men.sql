CREATE TABLE "training_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"week_number" smallint NOT NULL,
	"phase" text NOT NULL,
	"target_load_total" real,
	"target_sessions" smallint,
	"workouts" jsonb NOT NULL,
	"actual_load" real,
	"actual_sessions" smallint,
	"adherence_pct" real,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "training_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"race_type" text NOT NULL,
	"race_date" date NOT NULL,
	"start_date" date NOT NULL,
	"weeks_total" smallint NOT NULL,
	"current_week" smallint DEFAULT 1 NOT NULL,
	"target_ctl" real,
	"starting_ctl" real,
	"status" text DEFAULT 'active' NOT NULL,
	"constraints" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "training_blocks" ADD CONSTRAINT "training_blocks_plan_id_training_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."training_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_plans" ADD CONSTRAINT "training_plans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "training_blocks_plan_week_uq" ON "training_blocks" USING btree ("plan_id","week_number");--> statement-breakpoint
CREATE INDEX "training_plans_user_status_idx" ON "training_plans" USING btree ("user_id","status");