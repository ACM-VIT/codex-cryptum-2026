# Codex Cryptum 2026

A prompt-injection CTF built with Next.js, PostgreSQL, Drizzle, Better Auth, and the Vercel AI SDK. Uses pnpm workspaces.

## Run

```sh
pnpm install
cp .env.example .env   # skip if .env already exists
# Fill in the settings below.
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Open **http://localhost:3000**. Sign in with Google, then join **Demo Team** using `DEV_TEAM_ACCESS_CODE` from your local `.env`.

Use Node.js 26 and pnpm 12.11.2. The app uses Next.js 16.4.1, React 19.3.1, and TypeScript 7. Dependencies are recorded in `pnpm-lock.yaml`.

## Settings

Keep these in the root `.env`. Never commit it.

| Setting | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string |
| `BETTER_AUTH_URL` | App URL; locally `http://localhost:3000` |
| `BETTER_AUTH_SECRET` | Random secret, at least 32 characters |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google OAuth web client |
| `LLM_API_KEY` | Model provider key |
| `LLM_BASE_URL` | OpenAI-compatible base URL, e.g. `https://api.openai.com/v1` |
| `LLM_MODEL` | `gpt-6-luna`, or `qwen3:8b` for the event model host (see `docs/ENDPOINT.md`) |
| `FLAG_SECRET` | Independent random secret, at least 32 bytes |
| `DEV_TEAM_ACCESS_CODE` | Development team's access code |
| `ORGANIZER_TOKEN` | Independent secret for resetting the sandbox |

Register this redirect URI in your Google OAuth client:

```text
http://localhost:3000/api/auth/callback/google
```

For deployment, use your HTTPS domain in both `BETTER_AUTH_URL` and the Google redirect URI. Missing credentials produce an error, not a demo fallback.

## Model hosting

- **Backend team:** [docs/ENDPOINT.md](docs/ENDPOINT.md), how to call the model.
- **Event day:** [docs/RUNBOOK.md](docs/RUNBOOK.md), setup, fixes and backup.
- **Levels 3 and 9:** [docs/LEVELS.md](docs/LEVELS.md), how they work and test results.

## Layout

```text
apps/web             UI, API routes, authentication, challenge execution
packages/challenges  Public catalog and server-only defense policies
packages/contracts   Shared TypeScript types and Zod schemas
packages/db          Drizzle tables, migrations, development seed
```

See [docs/challenges.md](docs/challenges.md) to understand or add a challenge. [docs/integration.md](docs/integration.md) lists the original contributions. Component and font credits are in [apps/web/THIRD_PARTY.md](apps/web/THIRD_PARTY.md).

## Checks

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm test:db   # optional; use a disposable development database
```

Database tests temporarily edit sandbox state and restore it. CI runs the first four checks.

## Database

- `pnpm db:generate`: generate SQL after a schema change; review it before applying.
- `pnpm db:migrate`: apply committed migrations.
- `pnpm db:seed`: synchronize development challenge metadata and seed the demo team. Existing points, availability, and progress are preserved.

The provisioned Neon database is project **`dry-band-16656722`**, branch **`development`**, database **`cryptum`**, region **`aws-ap-southeast-1`**, PostgreSQL **17**. Its connection string is only in the ignored local `.env`. Migrations and seed have been applied.

**Safety:** the leaderboard sandbox is intentionally vulnerable. Sandbox edits cannot directly change official scores. Challenge filters are puzzle mechanics, not protections for real secrets.
