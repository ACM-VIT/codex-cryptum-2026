# Codex Cryptum 2026

This repository contains three isolated cybersecurity challenges: a sandbox
leaderboard, Level 5 exact-match redaction, and Level 6 smart redaction. The
service uses Python 3.10+ and the standard library. The leaderboard UI is at
`/`.

## Start the service

Configure participant bearer tokens as a JSON object mapping a secret token to
one of the configured sandbox team IDs, and configure a separate organizer
token from your local secret store. Tokens must be ASCII and at least 16
characters. Do not commit or print them.

```powershell
$env:CRYPTUM_PARTICIPANT_TOKENS = '{"<participant-secret-from-secret-store>":"team-cipher"}'
$env:CRYPTUM_ORGANIZER_TOKEN = '<organizer-secret-from-secret-store>'
py -m cryptum
```

Replace the placeholder values with runtime secrets before starting the
service; the example values are not usable credentials.

The development flags in `cryptum/challenges.py` are synthetic. For an event,
inject the real values server-side with `create_server(flags={5: ..., 6: ...})`.
Never place real flags in frontend assets, API configuration responses, logs,
or public documentation. The service suppresses request logs and filters
leaderboard display names before returning them.

## Participant challenge descriptions

- **Sandbox leaderboard:** use browser DevTools to explore the practice
  leaderboard API, reach first place in the sandbox, then verify completion.
- **Level 5 — Exact Flag Redaction:** the assistant has a level-specific flag;
  its output filter blocks the exact flag string. Recover the flag and submit
  it for server-side verification.
- **Level 6 — Smart Flag Redaction:** a separate flag is protected against
  exact, case, separator, reversal, ROT13, URL/HTML, Base64, and hexadecimal
  forms. Recover it and submit it for server-side verification.

These descriptions state objectives without publishing solution steps.

## API contract

Participant requests use `Authorization: Bearer <participant-token>`. The
trusted auth integration injects the token-to-team mapping through
`CRYPTUM_PARTICIPANT_TOKENS` or `create_server(tokens=...)`. Do not trust a
participant ID supplied by an unverified header. Organizer reset uses the
separate `CRYPTUM_ORGANIZER_TOKEN`.

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| GET | `/api/challenge/leaderboard` | public | Ranked sandbox scores and objective |
| GET | `/api/competition/leaderboard` | public | Read-only authoritative score provider seam |
| PATCH | `/api/challenge/leaderboard/teams/{team_id}` | participant | Sandbox team update; intentionally vulnerable CTF route |
| POST | `/api/challenge/leaderboard/complete` | participant | Verify a qualifying sandbox leaderboard exploit |
| POST | `/api/challenge/leaderboard/reset` | organizer | Restore seed scores and clear challenge state |
| POST | `/api/challenges/level-5/chat` | participant | Generate and exact-match-filter a Level 5 response |
| POST | `/api/challenges/level-5/verify` | participant | Verify Level 5 flag; award points once per team |
| POST | `/api/challenges/level-6/chat` | participant | Generate and enhanced-filter a Level 6 response |
| POST | `/api/challenges/level-6/verify` | participant | Verify Level 6 flag; award points once per team |

The chat request body is `{"message":"..."}` and verification body is
`{"flag":"..."}`. The leaderboard completion endpoint accepts an empty JSON
object. All challenge writes and awards use the challenge-only SQLite store
(`CRYPTUM_CHALLENGE_DB`, default `challenge.sqlite3`). They never write to the
competition score provider.

## Integration boundaries

- **Authentication:** no auth service exists in this repository. The
  injectable token map must come from the trusted event gateway. Use separate
  participant and organizer secrets; the service rejects weak, non-ASCII, or
  unknown-team participant mappings.
- **Competition scoring:** no scoring service exists here. Supply a
  `competition_entries()` callback (or iterable) from the authoritative
  read-only scorer. Only team ID,
  display name, score, and computed rank are returned; challenge writes cannot
  call this provider.
- **LLM:** `model_provider(level: int, message: str) -> str` is the adapter
  contract. A deterministic local provider supports development. The selected
  server-side filter runs on every provider response before it reaches a
  participant. Inject real model access and secret-backed flags at startup.
- **Browser identity:** the standalone UI displays the sandbox board and
  objective. The event frontend should attach the authenticated participant
  bearer token when calling mutation, verification, and completion endpoints.

## Tests

Run `py -m unittest discover -s tests -v` for the full suite.
Run `py -m compileall -q cryptum tests` for Python compilation checks.

Organizer solution notes and the Akhand review handoff are local-only,
Git-ignored files under `docs/`; do not publish them to participant-facing
spaces.
