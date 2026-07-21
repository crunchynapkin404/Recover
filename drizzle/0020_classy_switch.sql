CREATE TABLE "journal_prefs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"usual_behavior_tags" jsonb,
	CONSTRAINT "journal_prefs_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "journal_prefs" ADD CONSTRAINT "journal_prefs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;