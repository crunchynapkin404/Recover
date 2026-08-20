ALTER TABLE "training_plans" ADD COLUMN "first_race_id" uuid;--> statement-breakpoint
ALTER TABLE "training_plans" ADD COLUMN "first_race_date" date;--> statement-breakpoint
ALTER TABLE "training_plans" ADD COLUMN "first_race_type" text;--> statement-breakpoint
ALTER TABLE "training_plans" ADD CONSTRAINT "training_plans_first_race_id_races_id_fk" FOREIGN KEY ("first_race_id") REFERENCES "public"."races"("id") ON DELETE set null ON UPDATE no action;