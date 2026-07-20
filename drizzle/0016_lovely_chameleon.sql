CREATE TABLE "races" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"race_type" text NOT NULL,
	"sport" text,
	"date" date NOT NULL,
	"priority" text NOT NULL,
	"status" text DEFAULT 'upcoming' NOT NULL,
	"goal_note" text,
	"result_activity_id" uuid,
	"debriefed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "training_plans" ADD COLUMN "race_id" uuid;--> statement-breakpoint
ALTER TABLE "races" ADD CONSTRAINT "races_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "races" ADD CONSTRAINT "races_result_activity_id_activities_id_fk" FOREIGN KEY ("result_activity_id") REFERENCES "public"."activities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "races_user_date_name_uq" ON "races" USING btree ("user_id","date","name");--> statement-breakpoint
CREATE INDEX "races_user_status_date_idx" ON "races" USING btree ("user_id","status","date");--> statement-breakpoint
ALTER TABLE "training_plans" ADD CONSTRAINT "training_plans_race_id_races_id_fk" FOREIGN KEY ("race_id") REFERENCES "public"."races"("id") ON DELETE set null ON UPDATE no action;