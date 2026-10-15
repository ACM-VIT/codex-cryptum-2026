ALTER TABLE "teams" ADD COLUMN "access_code_lookup" text;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_access_code_lookup_unique" UNIQUE("access_code_lookup");