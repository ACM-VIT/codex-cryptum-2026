CREATE TABLE "chat_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"challenge_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	CONSTRAINT "chat_operations_status_valid" CHECK ("chat_operations"."status" IN ('pending', 'completed', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "chat_operations" ADD CONSTRAINT "chat_operations_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_operations" ADD CONSTRAINT "chat_operations_challenge_id_challenges_id_fk" FOREIGN KEY ("challenge_id") REFERENCES "public"."challenges"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_operations_rate_idx" ON "chat_operations" USING btree ("team_id","created_at");--> statement-breakpoint
CREATE INDEX "chat_operations_pending_idx" ON "chat_operations" USING btree ("team_id","status","expires_at");