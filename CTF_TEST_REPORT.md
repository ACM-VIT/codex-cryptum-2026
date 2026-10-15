# Codex Cryptum local application test report

The original QA snapshot below is retained. See the [feat/dev merge follow-up](#featdev-merge-follow-up)
for current team-creation integration and post-merge test results.

Date: 2026-10-15. Branch: `llm-guardrails`, starting HEAD `0184f95`.
Overall launch status: **PARTIALLY**. The application runs and tested flows work,
but complete participant solutions for Levels 2–9 and real Google OAuth have not
been demonstrated. Team creation is implemented on an unmerged branch.
No commits, pushes, merges or deployment were performed during this QA work.

## Environment and isolation

Arch Linux x86_64, Python 3.12.14 in uv, Node 26.11.1, pnpm 12.11.2, Chromium.
Tests used disposable loopback PostgreSQL on port 55432, separate QA databases,
synthetic teams and signed synthetic Better Auth sessions. The supplied production
Neon database and real competition results were not accessed or overwritten.
Provided API credentials were loaded server-side only. No key, team access code,
protected flag or private reasoning body is included in this report.

Configured application provider: OpenAI-compatible endpoint `https://api.openai.com/v1`,
model `gpt-6-luna`. Local Ollama also had `qwen3:8b`. Both pretrained classifiers
loaded real pinned weights on CPU. See [security/TEST_REPORT.md](security/TEST_REPORT.md)
for models, revisions, real-vs-mocked tests, latency, metrics and thinking tests.

## Challenge status

PASS for flag submission below means correct/wrong/duplicate/cross-challenge checks
using **trusted synthetic fixtures**, not proof of participant flag recovery.
NOT TESTED for full solution means limited candidate attempts did not demonstrate
success; it does not mean the level is impossible.

| Level | Loads / instructions | Real interaction | Intended solution / flag obtainable | Flag submission | Points / duplicate handling | Overall |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | PASS | PASS | PASS, recovered from actual model through participant UI | PASS | PASS | PASS |
| 2 | PASS | PASS | NOT TESTED to successful completion | PASS, fixture | PASS | NOT TESTED |
| 3 | PASS | PASS | NOT TESTED to successful completion | PASS, fixture | PASS | NOT TESTED |
| 4 | PASS | PASS | NOT TESTED to successful completion; keyword blocking exercised | PASS, fixture | PASS | NOT TESTED |
| 5 | PASS | PASS | NOT TESTED to successful completion | PASS, fixture | PASS | NOT TESTED |
| 6 | PASS | PASS | NOT TESTED to successful completion | PASS, fixture | PASS | NOT TESTED |
| 7 | PASS | PASS, real CPU classifier + real API | NOT TESTED to successful completion; solvability unverified | PASS, fixture | PASS | NOT TESTED |
| 8 | PASS | PASS, both real CPU classifiers + real API | NOT TESTED to successful completion; solvability unverified | PASS, fixture | PASS | NOT TESTED |
| 9 | PASS | PASS | NOT TESTED to successful completion | PASS, fixture | PASS | NOT TESTED |
| 10 | PASS | PASS, sandbox HTTP endpoints | PASS, intended sandbox IDOR objective reproduced locally | PASS, completion route; no manual flag required | PASS, awarded once | PASS |

Levels 2–6 and 9 each received two targeted existing-spec candidate requests with
real model replies; no flag was recovered. Levels 7/8 received normal, thinking
control, direct-request, reasoning-request and translation cases, including a second
Level 8 team. The reasoning-request fixture was input-blocked; other observed replies
were safe. A blocked output or internally read fixture was never counted as a solve.
The intentional Level 10 sandbox weakness was preserved; it did not alter another
team's official score. No new vulnerability/objective was introduced.

## Application and branch verification

| Feature | Result | Evidence / boundary |
| --- | --- | --- |
| Catalog and instructions | PASS | All ten challenge definitions loaded with nonempty instructions |
| Current-branch team creation | FAIL / absent | `/api/teams` returns 404 on this checkout |
| Team creation feature on another branch | PASS separately, not merged | `origin/team-creation` at `37512e6`: 13/13 real HTTP checks; 9/9 database integration cases |
| Team joins and own-team data | PASS | Correct generated code joins, wrong code denied; isolated team state |
| Better Auth session enforcement | PASS with synthetic signed sessions | Actual session lookup, unauthenticated rejection, signout and team logout exercised |
| Real Google signup/login | NOT TESTED | Browser account interaction and real OAuth callback not performed |
| Database and persistence | PASS | Disposable PostgreSQL, migrations and seed; score survived backend restart |
| Scoring | PASS | Levels 1–9 total 4500, sandbox completion adds 1000; duplicate/wrong submissions add nothing |
| Official leaderboard | PASS | Descending ranks, score updates, unrelated team unchanged |
| Intended sandbox leaderboard weakness | PASS | Documented IDOR objective completed only on local synthetic data |
| OpenAI integration | PASS | Actual API/model replies and new official Python SDK smoke |
| Pretrained classifier bridge | PASS | Actual CPU models on private authenticated loopback service, no LLM-judge fallback |
| Frontend/backend connection | PASS | Real participant-browser Level 1 response → flag submission → completed state → leaderboard 100 |
| Production deployment | NOT TESTED | Private service supervision, TLS, capacity and remote rollout not performed |

The detached team-creation branch also passed unauthorized/invalid/duplicate creation,
persisted generated code, joins, two-member listing, creator-only rename, member
leave, last-member confirmation and team deletion. Only synthetic teams were deleted.
That branch was inspected/tested independently rather than merged. The unmerged
`origin/levels-3-9` branch was reviewed read-only; its changes were not assumed present.

## Test evidence

- JavaScript final relevant suites: **124 passed**, 7 database tests skipped in the
  ordinary selection. The database selection previously passed **7/7** on main.
- Python: **317 unit/mock cases passed**, plus **12 real classifier/Ollama cases**
  and **3 real official-SDK OpenAI cases**. See the security report for overlapping
  run counts and exact commands; do not add overlapping suite totals.
- Local real HTTP application checks: **30/30 passed**, covering catalog, sessions,
  authentication/CSRF, levels 1–9 submissions, cross-team/challenge rejection,
  score/ranking, sandbox objective, isolation and logout.
- Team-creation branch: **13/13 HTTP** and **9/9 database** checks passed separately.
- Chromium: five-page unauthenticated smoke, no JavaScript errors; authenticated
  Level 1 actual-model solve, submit and leaderboard flow passed using signed
  synthetic sessions. This does not verify interactive Google OAuth.
- Next.js lint, typecheck and production build passed. Python Ruff, format, wheel
  build and `git diff --check` passed. Updated cross-platform CI was not run remotely.

Evidence scripts/results are local QA artifacts outside Git under `/tmp/cryptum-qa`;
private environment/cookie artifacts are deliberately excluded. Retained prior tests
were not rerun merely for repetition. Suites affected by code changes were rerun.

## Confirmed defects and local fixes

| Defect | Affected files | Fix / regression evidence |
| --- | --- | --- |
| Levels 7/8 web path used generative LLM judging instead of the pretrained models | `apps/web/src/server/llm.ts`, new `ml-classifiers.ts`, new `security/classifier_service.py` | Private authenticated CPU bridge; real HTTP/classifier checks and focused simulated tests; Level 9 judge unchanged |
| Backend flags used a prefix incompatible with required format | `apps/web/src/server/security.ts` | Restored required `cdx{...}` prefix while preserving existing HMAC payload/secret; flag, submission and isolation regressions passed |
| Inline thinking text could reach participants through the SDK text field | `apps/web/src/server/model-provider.ts`, `llm.test.ts` | Two simulated-response regressions first failed; closed blocks removed, malformed blocks/streams rejected; separate reasoning discarded |
| UI accepted more characters than backend | `apps/web/src/components/ui/ai-prompt-box.tsx` | Counter/maxlength aligned to existing 2000-character server limit; actual browser assertion passed |
| Native Python lacked OpenAI provider selection | `security/adapters/`, `security/config/providers.py`, runtime/demo/deploy helpers | Official SDK adapter, explicit settings, bounded deadlines/retries and fail-closed selection; real API and both-level classifier tests passed |

An initial 503 on real Level 7/8 web requests was traced to a server started before
private transport variables were set. Restart with the complete configuration fixed
it; no classifier fallback was introduced. A browser test initially used 127.0.0.1
against `BETTER_AUTH_URL=http://localhost:3000`; correcting the test hostname fixed
existing same-origin validation, which was not weakened.

## Remaining launch blockers

1. Review/integrate team creation from its actual branch; do not assume the current
   404 is an unimplemented feature across the repository.
2. Verify real Google OAuth interactively with correct callback registration.
3. Demonstrate organizer-approved participant solutions for Levels 2–9, especially
   7/8 with the selected production model. Their solvability remains unverified.
4. Operate the private classifier process with proper secrets, supervision, HTTPS
   where remote, bounded admission and measured capacity. Busy models fail closed.
5. The output classifier alone had low recall on the small held-out set; deterministic
   supplementation improves detection but retains documented misses/false positives.
   No thresholds or intended challenge difficulty were silently changed.

## Launch commands

Use the intended development database only. Create root `.env` using its example;
create private `security/.env` using its example and share only the classifier bearer
transport token with the web server. Never pass the root database/auth env file to
the strict Python loader. Configure Google callback and `BETTER_AUTH_URL` consistently.

```text
pnpm install --frozen-lockfile
uv python install 3.12
uv sync --locked --python 3.12 --extra ml --extra dev --extra openai
uv run --no-sync python -m security.deploy prepare --env-file security/.env --timeout 600
pnpm db:migrate
pnpm db:seed
```

Run in separate terminals:

```text
uv run --no-sync python -m security.classifier_service --env-file security/.env
pnpm dev
```

Open `http://localhost:3000` when that is the configured auth URL. For production
build verification use `pnpm build`, then `pnpm start`; hosting must supervise both
processes. Application LLM selection still uses existing root `LLM_*` settings.
The alternative native Python pipeline uses `LLM_PROVIDER` plus `OPENAI_*` or
`OLLAMA_*`; see [security/DEPLOYMENT.md](security/DEPLOYMENT.md). Installing OpenAI
support does not move backend authentication, persistence or scoring into Python.

## feat/dev merge follow-up

The PR now targets `feat/dev`. Its latest fetched commit, `9f259c0`, was merged
locally into `llm-guardrails`, including the team creation, team-code storage,
account/session handling, navigation and database migrations previously tested on
a separate branch. `origin/main` (`15fe01a`) is already an ancestor of that target.
The earlier missing `/api/teams` blocker describes the pre-merge snapshot, not the
current source: the production build now includes `/api/teams`, `/api/team`,
`/api/session/logout` and `/team`.

Conflict resolution preserves all backend team helpers and the `feat/dev`
phrase-plus-team-HMAC flag contract. Level 7/8 ML guardrail tests, provider/thinking
regressions and cross-team/challenge flag assertions were retained. No intentional
CTF vulnerability, classifier threshold or model weight was changed.

Post-merge validation on this Linux host:

- JavaScript suites: **128 passed** (5 catalog, 123 web); the 9 database cases are
  excluded from that ordinary selection and were run separately.
- Merged PostgreSQL integration against the isolated QA database: **9 passed**.
- Python 3.11.16 core/mock suite: **320 passed**, 15 integration cases deselected.
- Python 3.12.14 full selection with real cached CPU classifiers/local Ollama:
  **332 passed, 3 skipped**; the three OpenAI cases were separately run and passed.
- Official SDK real OpenAI integration: **3 passed**, including both levels with
  actual pretrained classifiers and synthetic protected contexts.
- Lint, typecheck, production Next.js build, Ruff, mock CLI and Python wheel: PASS.

The macOS Python 3.11 CI failure was traced to startup-timeout enforcement, not
failed ARM64 ML dependency installation. A deterministic Python 3.11 cancellation
regression and explicit startup deadline guards now pass locally. See
[security/PORTABILITY_REPORT.md](security/PORTABILITY_REPORT.md#macos-python-311-ci-investigation-and-merge-follow-up).
**The changed code has not yet passed the actual macOS GitHub Actions job.**
No push was made. OAuth interaction, event-model solvability for Levels 2–9,
and production rollout/capacity remain unverified; full event readiness is still
PARTIAL. No additional exploit search was performed during this merge repair.
