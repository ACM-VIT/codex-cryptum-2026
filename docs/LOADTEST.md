# Load test results: MacBook Air M5, 16 GB

## How it was run

```bash
python3 scripts/load_test.py --users 10,20,30
```

- Each simulated user runs a 3-turn chat with a level-style system prompt, sending prompt-injection style messages through the gate on `:8080`.
- The thinking guard from [ENDPOINT.md](ENDPOINT.md) is applied.
- Users pause 3–8 s between turns and start within 5 s of each other.
- Settings are those in [CONCURRENCY.md](CONCURRENCY.md): 4 parallel slots, queue 32.
- Other apps were open, and the Mac had ~4.5–6 GB in swap.

## Results

| Users | Requests | Errors | p50 latency | p95 latency | p50 first token | Throughput |
|---|---|---|---|---|---|---|
| 10 | 30 | 0 | 20.4 s | 23.5 s | 10.9 s | 16.5 tok/s, 21 req/min |
| 20 | 60 | 0 | 53.5 s | 61.8 s | 44.0 s | 14.8 tok/s, 19 req/min |
| 30 | 90 | 0 | 80.7 s | 89.4 s | 71.3 s | 16.4 tok/s, 20 req/min |

- **Latency** is the time from sending a message to receiving the full reply.
- **First token** is mostly time spent waiting in the queue for one of the 4 slots.
- Replies averaged ~47 tokens, because refusals are short.
- No request failed or timed out (the timeout was 120 s), and the gate logged no 502/503.

## What it means

**The Mac's ceiling is about 20 replies per minute.** That stayed the same from 10 to 30 users. Past about 4 simultaneous requests, extra load doesn't add throughput; it just lengthens the queue, so latency grows in a straight line with the number of people waiting.

These users paused only 3–8 s between messages, which is much faster than people type and read. The figures are a worst case. A rule of thumb for the room:

| Messages per minute from the whole room | Experience |
|---|---|
| up to ~15 | Replies in 5–20 s. Fine. |
| ~20 | At capacity. Waits grow to 30–60 s. |
| over 20 | The queue keeps growing. Waits pass 90 s, and the backend's 120 s timeouts and 503s start. |

For example, 30 teams each sending a message every 2 minutes is ~15/min, which is OK. 30 teams sending one every 30 s is ~60/min, which is 3× over capacity.

## Verdict

- **Up to about 10–15 actively chatting teams:** this Mac is enough.
- **20–30 teams chatting continuously:** it isn't. Waits approach 1.5 min and any burst overflows.

If you expect more than 15 active teams, in order of impact:

1. **A second machine running the same setup.** Split levels between them (e.g. levels 1–5 on one, 6–10 on the other), or have Backend round-robin across both. This roughly doubles capacity, and the second machine is also the backup.
2. **Per-team rate limit in the backend:** one request in flight per team. This keeps waits fair and stops a single script from filling the queue.
3. **Lower `max_tokens` (e.g. 128).** This mostly affects long answers; refusals are short anyway.
4. **Free up memory on event day.** Swap was ~5 GB during these runs. A clean machine was measured at 8.3 tok/s for a single request, versus as low as 4 tok/s while swapping.
5. **Levels 7–9 use extra model calls** for classifiers and the judge. If those run on this same model, each participant message costs 2–3 requests and the capacity above shrinks by the same factor. Put those calls on a smaller model or a second machine.
