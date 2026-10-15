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

Open **http://localhost:3000**. Sign in with Google, then create your team or join using a teammate’s access code. No demo teams are seeded.

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
| `LLM_MODEL` | `gpt-6-luna` (the event model), or `qwen3:8b` for the self-hosted fallback (see `docs/ENDPOINT.md`) |
| `FLAG_SECRET` | Independent random secret, at least 32 bytes |
| `ORGANIZER_TOKEN` | Independent secret for resetting the sandbox |

Register this redirect URI in your Google OAuth client:

```text
http://localhost:3000/api/auth/callback/google
```

For deployment, use your HTTPS domain in both `BETTER_AUTH_URL` and the Google redirect URI. Missing credentials produce an error, not a demo fallback.

## Cloudflare deployment

Cloudflare Workers Builds deploys `main` to **https://codex.acmvit.in**. The connected GitHub repository is `ACM-VIT/codex-cryptum-2026`; the build command is `pnpm build:cloudflare` and the deploy command is `pnpm --filter cryptum-cloudflare deploy`. Builds use Node.js 26 and pnpm 12.11.2.

`infra/cloudflare/cloudflare.config.ts` declares the Worker, custom domain and Hyperdrive binding. Hyperdrive uses the existing Neon database with query caching disabled so scores and challenge state stay current. Database clients and Better Auth adapters are scoped to each Worker request. Local commands continue using `DATABASE_URL` from `.env`.

The OpenNext build uses webpack and a pinned adapter patch that inlines Next.js 16.4's `preview-props.json`. The patch prevents a runtime manifest error after an otherwise successful build. `apps/web/wrangler.jsonc` supplies adapter build settings; deployment uses the `cf` CLI in the separate infrastructure workspace.

To deploy locally, run `pnpm deploy` after authenticating `cf`. Application secrets are already stored as encrypted Worker secrets. To replace them from the ignored root `.env`, run:

```sh
pnpm build:cloudflare
pnpm --filter cryptum-cloudflare exec cf deploy --prebuilt --secrets-file ../../.env
```

Google OAuth must allow `https://codex.acmvit.in/api/auth/callback/google`. Never commit `.env` or paste its values into build commands. The Python classifier remains a separate authenticated HTTPS service configured through the Worker secrets.

## Model hosting

The event uses OpenAI: set `LLM_API_KEY`, keep `LLM_BASE_URL=https://api.openai.com/v1` and `LLM_MODEL=gpt-6-luna`. The self-hosted Qwen setup below is a fallback only.

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
- `pnpm db:seed`: synchronize challenge metadata without creating teams. Existing points, availability, and progress are preserved.

The provisioned Neon database is project **`dry-band-16656722`**, branch **`development`**, database **`cryptum`**, region **`aws-ap-southeast-1`**, PostgreSQL **17**. Its connection string is only in the ignored local `.env`. Migrations and seed have been applied.

**Safety:** the leaderboard sandbox is intentionally vulnerable. Sandbox edits cannot directly change official scores. Challenge filters are puzzle mechanics, not protections for real secrets.

## Level 7/8 Python guardrail component

Akhand's framework-independent Python package lives in `security/`: independent CPU
input classification for Levels 7 and 8, Level 8 output classification, team-specific
HMAC flags, trusted system prompts and fail-closed policy enforcement. Model weights
are pretrained and unchanged. The package targets Python 3.11/3.12.

See [security/README.md](security/README.md) for the package layout and interfaces,
[security/DEPLOYMENT.md](security/DEPLOYMENT.md) for model preparation/lifecycle and
integration contracts, and [security/PORTABILITY_REPORT.md](security/PORTABILITY_REPORT.md)
for platform evidence and limitations.

```text
uv sync --locked --python 3.12 --extra ml --extra dev
uv run --no-sync python -m pytest -q -m "not integration"
uv run --no-sync ruff check security
uv build --wheel
```

The Next.js application and Python guardrails use separate configuration schemas:
root `.env` belongs to the application; optional `security/.env` contains only the
Python keys from `security/.env.example`. Both local files must remain untracked.
Levels 7–8 now use the private pretrained-classifier bridge through a server-only
Next.js client. Start it with
`uv run --no-sync python -m security.classifier_service --env-file security/.env` in a separate terminal before admitting participants.
Set the same `CRYPTUM_CLASSIFIER_TOKEN` in root `.env` and `security/.env`, and set
`CRYPTUM_CLASSIFIER_URL` in root `.env` to its private endpoint. Keep the service on
loopback or behind authenticated private HTTPS. See `security/DEPLOYMENT.md`. The existing
Next.js provider settings do not automatically change the native Python inference
adapter or HMAC derivation. The Python pipeline now supports both Ollama and the
official OpenAI SDK; see [provider setup](security/README.md#selecting-the-python-llm-provider). The Python work does not implement authentication, scoring, or any
other challenge levels.

Leaderboards refresh every three seconds and immediately on reconnect or tab focus. Official scores come from recorded solves. Level 10 uses isolated copies of registered teams, initialized from their real scores; practice edits persist until reset. At least two registered teams are required.
