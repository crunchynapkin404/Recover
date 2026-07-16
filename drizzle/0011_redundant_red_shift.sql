CREATE TABLE "body_prefs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"wake_time" text,
	"sleep_need_secs" integer DEFAULT 28800 NOT NULL,
	CONSTRAINT "body_prefs_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "body_prefs" ADD CONSTRAINT "body_prefs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;