# Concurrency and memory settings

The Ollama app reads its environment from `launchctl`, so `scripts/ollama_env.sh` sets the variables there, restarts the app and preloads the model.

```bash
./scripts/ollama_env.sh apply
```

```bash
./scripts/ollama_env.sh show
```

```bash
./scripts/ollama_env.sh reset
```

`launchctl setenv` does not survive a reboot or logout. After any restart of the Mac, run `apply` again before the event, then check `show`.

## Settings

| Variable | Value | Why |
|---|---|---|
| `OLLAMA_NUM_PARALLEL` | 4 | Throughput peaks at 4 parallel slots on the M5 Air (see below). More slots only add memory. |
| `OLLAMA_MAX_QUEUE` | 32 | Above this, requests get an immediate HTTP 503 instead of waiting. 32 queued is about 1–1.5 min of waiting, which keeps the wait under the backend's 120 s timeout. |
| `OLLAMA_KEEP_ALIVE` | -1 | Keeps the model loaded all event. Reloading costs ~10 s and can fail under memory pressure. |
| `OLLAMA_MAX_LOADED_MODELS` | 1 | Stops the plain `qwen3:8b` (or another model) from loading next to `codex-qwen` and running out of memory. |
| `OLLAMA_FLASH_ATTENTION` | 1 | Required for the quantised KV cache, and lowers memory. |
| `OLLAMA_KV_CACHE_TYPE` | q8_0 | Halves the KV cache: 4 × 4096 tokens take 1.2 GB instead of 2.3 GB. Replies looked unaffected, and the think-leak checks still pass. |

To try other values, override them for one `apply`:

```bash
NUM_PARALLEL=6 MAX_QUEUE=48 ./scripts/ollama_env.sh apply
```

## Measured on the M5 Air (16 GB)

All requests asked for 120 tokens.

| Concurrent requests | Wall time | Total throughput |
|---|---|---|
| 1 | 14.4 s | 8.3 tok/s |
| 4 | 23.6 s | 20.3 tok/s |
| 8 | 44.5 s | 21.6 tok/s (the last 4 waited for a free slot) |

Four parallel requests take ~1.6× as long as one, but get ~2.4× the total throughput. Past 4, extra requests just queue.

With these settings, the loaded model uses 6.1 GB of GPU memory (5 GB weights, 1.2 GB KV cache). During testing, the Mac also had ~6 GB in swap because other apps were open, and speed swung between 4 and 8.5 tok/s for a single request. **On event day, close everything except Ollama, the gate and a terminal.**

## Restarts

`apply` restarts the app with SIGTERM, because the app ignores an AppleScript quit. After any restart (yours, a crash, or an app update), the model is unloaded until the first request. Run `./scripts/ollama_env.sh warm` to load it again straight away.

The Ollama app checks for updates every hour, and an update restarts the server. Turn off auto-update in the Ollama app's settings before the event.

Task 5's load test gives the full numbers for 10/20/30 concurrent chats.
