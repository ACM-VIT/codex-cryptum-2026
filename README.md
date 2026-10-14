# Codex Cryptum 2026

This repository currently contains a standalone challenge API for Riya's
leaderboard, Level 5, and Level 6 components. It uses Python 3.10+ and only the
standard library. The public leaderboard is served at `/`.

## Run locally

In PowerShell, set participant tokens as a JSON object whose values are the
team IDs, plus a separate organizer reset token:

```powershell
$env:CRYPTUM_PARTICIPANT_TOKENS='{"local-participant-token":"team-aurora"}'
$env:CRYPTUM_ORGANIZER_TOKEN='local-organizer-token'
py -m cryptum
```

The development flags are synthetic constants in `cryptum/challenges.py`.
Replace them with deployment secrets before running a real event. Do not put
flags or participant/organizer tokens in browser code or logs. The service
does not log request bodies, authorization headers, or model responses.

## API contract

Participant endpoints use `Authorization: Bearer <participant-token>`. Tokens
are configured by the trusted deployment/authentication layer in
`CRYPTUM_PARTICIPANT_TOKENS`. An existing auth gateway can supply its own
mapping when constructing `create_server`; do not trust a participant ID
provided directly in an unverified request header. The organizer reset route
uses the separately configured `CRYPTUM_ORGANIZER_TOKEN`.

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| GET | `/api/challenge/leaderboard` | public | Ranked, intentionally vulnerable sandbox scores |
| GET | `/api/competition/leaderboard` | public | Read-only authoritative provider seam |
| PATCH | `/api/challenge/leaderboard/teams/{team_id}` | participant | Intentionally vulnerable profile/score update |
| POST | `/api/challenge/leaderboard/reset` | organizer | Restore sandbox seed data and clear awards |
| POST | `/api/challenges/level-5/chat` | participant | Generate and exact-match-filter a Level 5 response |
| POST | `/api/challenges/level-5/verify` | participant | Verify the Level 5 flag and award points once per team |
| POST | `/api/challenges/level-6/chat` | participant | Generate and enhanced-filter a Level 6 response |
| POST | `/api/challenges/level-6/verify` | participant | Verify the Level 6 flag and award points once per team |

Competition results come from a separately injected, read-only
`competition_entries` provider. The current repository has no competition
scoring or authentication service, so the included values and token mapping
are development seams, not production integrations. Challenge team scores
and award records are persisted in `CRYPTUM_CHALLENGE_DB` (default
`challenge.sqlite3`) and never write through to the competition provider.

The LLM adapter contract is `model_provider(level: int, message: str) -> str`.
The default is a deterministic local challenge model so the APIs work without
external dependencies. Inject the event's model client through `create_server`;
the server always applies the selected level's output filter to the returned
string before sending it to the participant.

## Tests

Run `py -m unittest discover -s tests -v`.

## Organizer materials

Organizer solve notes belong under `docs/organizer/`. Apply repository or
deployment access controls before sharing this material with participants.
