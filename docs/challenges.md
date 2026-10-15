# Challenges

## Participant flow

- **Levels 1–9:** send prompts, inspect responses, recover your team's flag, submit it.
- **Level 10 (hidden):** not listed in the catalog. Assistants on levels 1–9 drop a cryptic hint about `/api/challenge/leaderboard` on about 1 in 8 replies. Teams that find the isolated leaderboard, reach first place, and verify through the API earn 1000 points. No chat or flag submission.

The API tells the UI which interface to show through `interaction` and `completionMethod`. Official points come from unique server-created solve records, never from sandbox scores.

## Files

| File | Responsibility |
| --- | --- |
| `packages/challenges/src/index.ts` | Public titles, descriptions, points, hints, limits, interaction types |
| `packages/challenges/src/server.ts` | Prompt, input-guard, and output-guard policies |
| `packages/contracts/src/index.ts` | Shared request/response types and validation |
| `apps/web/src/server/llm.ts` | Execute the defense pipeline |
| `apps/web/src/server/model-provider.ts` | AI SDK calls to GPT 6 Luna |
| `apps/web/src/server/challenges.ts` | Conversations, request budgets, submissions, scoring |
| `apps/web/src/server/sandbox.ts` | Sandbox edits and completion verification |

Import `@cryptum/challenges` for public metadata. Import `@cryptum/challenges/server` only on the server. Neither contains runtime flags or credentials.

## LLM pipeline

```text
reserve request → input guard → build instructions → model → output guard → save turn
```

Database transactions are short. They are not held open while waiting for the model. Failed requests count toward the rate limit; conversation resets cannot erase that budget. Conflicting requests are rejected, and expired replies are discarded.

The provider uses AI SDK `instructions` for trusted instructions and `messages` for user/assistant history. Levels 7–8 call the private Python pretrained-classifier bridge before generation
and, for Level 8, before output delivery. Input thresholds remain 0.75/0.80 and
Level 8 output remains 0.75. Level 9 keeps its existing LLM conversation judge.
Provider errors are sanitized; flags and credentials are not logged. The shared
provider returns only final text, strips inline thinking blocks, and rejects
unexpected reasoning streams. Qwen3 identifiers receive its soft `/no_think`
control; OpenAI prompts do not. See `security/DEPLOYMENT.md` for the private bridge.

| Level | Prompt | Input guard | Output guard |
| --- | --- | --- | --- |
| 1 | Open | None | None |
| 2 | Private, closing words | None | None |
| 3 | Vault, 12-character pieces | None | None |
| 4 | Private, closing words | Keyword | Exact match on closing words |
| 5 | Private, closing words | None | Exact match on flag and closing words |
| 6 | Private, closing words | None | Encoding-aware on flag and closing words, limited inspection window |
| 7 | Private, closing words | Classifier | Encoding-aware on closing words, limited inspection window |
| 8 | Private, closing words | Classifier | Classifier on flag, encoding-aware on closing words |
| 9 | Vault, 6-character pieces | Blocklist | Leak filter and conversation judge |
| 10 | No model | Sandbox exploit | Server verification |

Private levels keep the flag out of the model's instructions until the player types that level's closing words after the model has explained them, so authority claims cannot leak it. The model only explains the closing words when asked for its rules. From level 4 on, that explanation passes through an output filter too, so players have to get the closing words out in a shape the filter misses. Vault levels release one numbered piece per message. Neither can be won with a single message.

These weaknesses are intentional CTF mechanics. Do not use them to protect real secrets.

## Developer interface

The execution function takes a typed request:

```ts
await runChallengeModel({
  definition, // from getChallengeDefinition(id)
  flag,       // generated on the server for this team and challenge
  history,    // user/assistant turns
  message,    // current participant input
});
```

Application routes should use the challenges service around this function so authorization, limits, persistence, and scoring are not skipped. Tests can pass a typed provider function as its second argument.

The browser client implements `CtfApi` from `@cryptum/contracts`:

- `GET /api/challenges`: active catalog.
- `POST /api/challenges/:id/messages`: `{ content }` → updated session.
- `DELETE /api/challenges/:id/conversation`: reset chat history.
- `POST /api/challenges/:id/submissions`: `{ flag }` → submission result and session.
- `GET /api/challenge/leaderboard`: sandbox entries.
- `PATCH /api/challenge/leaderboard/teams/:id`: `{ score?, display_name? }` → sandbox edit.
- `POST /api/challenge/leaderboard/complete`: `{}` → verified completion and award.
- `GET /api/leaderboard`: official standings.

Mutations require Google identity, a matching team session, JSON, and a same-origin request. Cross-team edits are allowed only in the deliberately vulnerable sandbox.

## Add a challenge

1. Add public metadata in `packages/challenges/src/index.ts`.
2. Add its execution policy in `packages/challenges/src/server.ts`.
3. Run `pnpm db:seed` on a development branch.
4. Add tests for its guards and completion method. A new sandbox type also needs its own server-side verification; the current sandbox service handles the leaderboard challenge only.
5. Run the checks in the root README.

IDs are positive PostgreSQL integers, not capped at ten. Missing or inconsistent definitions fail closed. Schema changes need migrations; catalog changes do not.
