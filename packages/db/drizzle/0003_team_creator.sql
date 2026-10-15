ALTER TABLE "teams" ADD COLUMN "created_by" text;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_created_by_unique" UNIQUE("created_by");