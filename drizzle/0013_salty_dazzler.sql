ALTER TABLE "body_prefs" ADD COLUMN "max_hr" integer;--> statement-breakpoint
ALTER TABLE "body_prefs" ADD COLUMN "ftp_watts" integer;--> statement-breakpoint
ALTER TABLE "daily_metrics" ADD COLUMN "ctl" real;--> statement-breakpoint
ALTER TABLE "daily_metrics" ADD COLUMN "atl" real;--> statement-breakpoint
ALTER TABLE "daily_metrics" ADD COLUMN "load_source" text;