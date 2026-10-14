# Event API contract

This is a proposed integration contract for the frontend. The backend is not implemented in this repository. All routes below are relative to `VITE_API_BASE_URL`.

Use JSON responses, cookie authentication, and server-authoritative state. The frontend sends `credentials: include` and aborts requests after 90 seconds. Do not return hidden prompts, reasoning, classifier internals, or valid flags in catalog/session responses.

## Endpoints

| Method | Path                           | Request                    | Response                                                                        |
| ------ | ------------------------------ | -------------------------- | ------------------------------------------------------------------------------- |
| GET    | `/session`                     | —                          | `Session` or JSON `null` when unauthenticated                                   |
| POST   | `/session`                     | `{ teamName, accessCode }` | `Session`; establish secure HttpOnly cookie                                     |
| DELETE | `/session`                     | —                          | `{ "ok": true }`; clear cookie                                                  |
| GET    | `/challenges`                  | —                          | `Challenge[]`, public catalog of all ten levels                                 |
| POST   | `/challenges/:id/messages`     | `{ content }`              | Updated `Session`, containing the committed user and visible assistant messages |
| DELETE | `/challenges/:id/conversation` | —                          | Updated `Session`, preserving solved flags and score                            |
| POST   | `/challenges/:id/submissions`  | `{ flag }`                 | `{ status: "accepted"                                                           | "incorrect" | "duplicate", session: Session }` |
| GET    | `/leaderboard`                 | —                          | `{ updatedAt: ISODate, teams: LeaderboardTeam[] }`                              |

This first adapter uses complete responses rather than token streaming. A pending indicator stays visible while awaiting the model. Message history is stored on the server; clients send only the new user message, not system messages or trusted roles.

```ts
type Message = {
  id: string;
  role: "user" | "assistant";
  content: string; // Final, visible text only. React escapes it.
};

type Session = {
  id: string; // Stable team identifier, not the authentication token.
  teamName: string;
  score: number;
  solved: number[]; // Unique challenge IDs, 1–10.
  conversations: Record<string, Message[]>; // Keys "1" through "10".
};

type Challenge = {
  id: number;
  title: string;
  subtitle: string;
  description: string;
  difficulty: "Intro" | "Easy" | "Medium" | "Hard" | "Expert";
  points: number;
  defenses: string[]; // Participant-facing descriptions, never hidden configuration.
  hint: string;
  turnLimit: number | null;
};

type LeaderboardTeam = {
  id: string;
  teamName: string;
  score: number;
  solved: number;
  rank: number; // Server-assigned. UI does not recalculate live ranks.
};
```

## Responsibility and consistency

- Authenticate the team from its cookie; do not trust a supplied display name as identity.
- Enforce content length, rate limits, challenge IDs, turn limits, and authorization server-side. The UI uses a 4,000-character prompt limit and a 512-character submission limit.
- Serialize conflicting conversation writes and make flag awards idempotent. Multi-tab/team concurrency must be handled by the backend; a local UI busy state is only a convenience.
- A reset should affect only the selected challenge and reset its turn budget without clearing solved flags.
- Reject shared flags where team-specific flags apply. The client does not compare live submissions.
- Keep the intentionally vulnerable leaderboard sandbox isolated from authentication, ordinary flag verification, and infrastructure. Agree with organizers whether its displayed standings are separate from authoritative flag scores.
- Use same-origin secure session cookies and server-side Origin/CSRF checks for mutations. If a CSRF-token handshake is chosen, extend this adapter to send it before enabling live use.
- On an ambiguous network timeout, refresh the session before retrying a mutation. The server may already have committed it. Submission retries must never award twice.

## Error handling

The adapter recognizes 401 (expired session), 403 (denied), 409 (conversation conflict), 429 (rate limit), and 503 (model unavailable). Other non-2xx responses display a retryable generic error. JSON response shapes are validated with Zod. Never expose server stack traces through participant error messages.

For initial unauthenticated requests, return JSON `null` from `GET /session` so team entry remains accessible. When a request expires during play, the user can leave the expired session and rejoin. Failed requests do not inject demo replies into live conversations.
