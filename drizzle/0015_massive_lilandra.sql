CREATE TABLE "biomarkers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"display_name" text NOT NULL,
	"category" text DEFAULT 'other' NOT NULL,
	"value" real NOT NULL,
	"unit" text,
	"measured_at" date NOT NULL,
	"source" text NOT NULL,
	"confidence" real,
	"raw_label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "body_prefs" ADD COLUMN "birth_year" integer;--> statement-breakpoint
ALTER TABLE "biomarkers" ADD CONSTRAINT "biomarkers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "biomarkers_user_name_date_uq" ON "biomarkers" USING btree ("user_id","name","measured_at");--> statement-breakpoint
CREATE INDEX "biomarkers_user_name_idx" ON "biomarkers" USING btree ("user_id","name");