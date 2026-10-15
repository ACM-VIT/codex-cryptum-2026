CREATE TABLE "level6_output_history" (
	"team_id" uuid PRIMARY KEY NOT NULL,
	"content" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "level6_output_history" ADD CONSTRAINT "level6_output_history_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;