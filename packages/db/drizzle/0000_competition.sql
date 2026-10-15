CREATE TABLE "challenges" (
	"id" integer PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"subtitle" text NOT NULL,
	"description" text NOT NULL,
	"difficulty" text NOT NULL,
	"points" integer NOT NULL,
	"defenses" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"hint" text NOT NULL,
	"turn_limit" integer,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "challenges_points_nonnegative" CHECK ("challenges"."points" >= 0),
	CONSTRAINT "challenges_turn_limit_positive" CHECK ("challenges"."turn_limit" IS NULL OR "challenges"."turn_limit" > 0),
	CONSTRAINT "challenges_difficulty_valid" CHECK ("challenges"."difficulty" IN ('Intro', 'Easy', 'Medium', 'Hard', 'Expert'))
);
--> statement-breakpoint
CREATE TABLE "exploit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_team_id" uuid NOT NULL,
	"target_team_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"challenge_id" integer NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_role_valid" CHECK ("messages"."role" IN ('user', 'assistant'))
);
--> statement-breakpoint
CREATE TABLE "sandbox_teams" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"score" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"team_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "solves" (
	"team_id" uuid NOT NULL,
	"challenge_id" integer NOT NULL,
	"points" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "one_solve_per_team" UNIQUE("team_id","challenge_id"),
	CONSTRAINT "solves_points_nonnegative" CHECK ("solves"."points" >= 0)
);
--> statement-breakpoint
CREATE TABLE "submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"challenge_id" integer NOT NULL,
	"correct" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"access_code_hash" text NOT NULL,
	CONSTRAINT "teams_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "exploit_events" ADD CONSTRAINT "exploit_events_actor_team_id_teams_id_fk" FOREIGN KEY ("actor_team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exploit_events" ADD CONSTRAINT "exploit_events_target_team_id_sandbox_teams_id_fk" FOREIGN KEY ("target_team_id") REFERENCES "public"."sandbox_teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_challenge_id_challenges_id_fk" FOREIGN KEY ("challenge_id") REFERENCES "public"."challenges"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solves" ADD CONSTRAINT "solves_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solves" ADD CONSTRAINT "solves_challenge_id_challenges_id_fk" FOREIGN KEY ("challenge_id") REFERENCES "public"."challenges"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_challenge_id_challenges_id_fk" FOREIGN KEY ("challenge_id") REFERENCES "public"."challenges"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "exploit_events_actor_idx" ON "exploit_events" USING btree ("actor_team_id");--> statement-breakpoint
CREATE INDEX "messages_conversation_idx" ON "messages" USING btree ("team_id","challenge_id","created_at");--> statement-breakpoint
CREATE INDEX "sessions_team_idx" ON "sessions" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "submissions_team_challenge_idx" ON "submissions" USING btree ("team_id","challenge_id");