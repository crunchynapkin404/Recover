CREATE TABLE "plan_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"week_plan_id" uuid NOT NULL,
	"date" date NOT NULL,
	"trigger" text NOT NULL,
	"action" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "week_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"plan_id" uuid NOT NULL,
	"week_start" date NOT NULL,
	"skeleton_week" smallint NOT NULL,
	"days" jsonb NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "plan_adjustments" ADD CONSTRAINT "plan_adjustments_week_plan_id_week_plans_id_fk" FOREIGN KEY ("week_plan_id") REFERENCES "public"."week_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "week_plans" ADD CONSTRAINT "week_plans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "week_plans" ADD CONSTRAINT "week_plans_plan_id_training_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."training_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "plan_adjustments_week_idx" ON "plan_adjustments" USING btree ("week_plan_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "week_plans_user_week_uq" ON "week_plans" USING btree ("user_id","week_start");--> statement-breakpoint
CREATE INDEX "week_plans_user_status_idx" ON "week_plans" USING btree ("user_id","status");