# Original contributions

This project ports three contributions into one TypeScript application. No separate Vite or Python server is required.

| Source | Snapshot | Contribution |
| --- | --- | --- |
| [Jiyaa-codes backend](https://github.com/Jiyaa-codes/Codex-Cryptum-2026/tree/main) | `a76e71e65b9b3bdfa90fd685df795fa18f133aa5` | Team credentials, HMAC flags, submissions, duplicate-safe scoring |
| [Frontend PR #1](https://github.com/ayaankhatri/Codex-Cryptum-2026/pull/1) | `1323a05a0eb06f9ff98df3c582abc46a0591289d` | Participant UI, briefing, conversations, leaderboard |
| [Challenge PR #2](https://github.com/ayaankhatri/Codex-Cryptum-2026/pull/2) | `fe26bff357e04bbfe5cdb6a38cf506e25e22e0fa` | Level 5/6 filters and vulnerable leaderboard sandbox |

Google identity now uses Better Auth. Teams still require an access code. Model calls use the Vercel AI SDK and `gpt-6-luna`.

Sandbox writes stay separate from official scoring and authentication. Server verification is required before a sandbox exploit earns official points. The level 6 inspection boundary is intentionally weak.

See [challenges.md](challenges.md) for the current implementation and [component credits](../apps/web/THIRD_PARTY.md) for attribution.
