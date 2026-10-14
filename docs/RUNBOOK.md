# Event-day runbook (model host)

Owner: Infra. Commands run from the repo root on the model Mac unless stated. The Ollama CLI isn't on `PATH`:

```bash
alias ollama=/Applications/Ollama.app/Contents/Resources/ollama
```

## Day before

- [ ] **Turn off auto-update** in the Ollama app's settings. An update restarts the server mid-event.
- [ ] **Do the network check** in [NETWORK.md](NETWORK.md) with the real backend machine on the venue Wi-Fi. If the machines can't reach each other, plan for a phone hotspot or travel router.
- [ ] **Get the backend machine's IP**, and the backup backend's IP if there is one.
- [ ] **Get the backup machine ready** (see [Backup machine](#backup-machine)) and run the health check on it.
- [ ] **Charge both machines fully.** Pack both chargers and an extension lead.
- [ ] **Re-run the load test** if anything changed:
  ```bash
  python3 scripts/load_test.py --users 10,20,30
  ```

## Setup on the day (start 60 min before doors)

1. **Plug in the charger and keep the lid open.** A Mac on battery with the lid closed sleeps, even with `caffeinate`.
2. **Quit every other app** (browsers, Slack, IDEs). The model needs about 6 GB of the ~12 GB GPU budget, and swapping roughly halves its speed.
3. **Keep the Mac awake** for the whole event. Leave this terminal open:
   ```bash
   caffeinate -dimsu
   ```
4. **Apply the settings, restart Ollama and load the model:**
   ```bash
   ./scripts/ollama_env.sh apply
   ```
5. **Check the model has no thinking leaks** (about 3 min):
   ```bash
   python3 scripts/verify_no_think.py
   ```
6. **Start the gate** in its own terminal and keep it open; it logs every request:
   ```bash
   python3 infra/proxy/gate.py --allow <backend-ip> --allow 127.0.0.1
   ```
7. **Run the full health check.** Everything should read PASS:
   ```bash
   python3 scripts/healthcheck.py
   ```
8. **Give Backend the base URL** `http://<this-mac-ip>:8080/v1`. Get this Mac's IP with `ipconfig getifaddr en0`. Ask them to send one request, and confirm it appears in the gate log with status 200.
9. **Leave a monitor running** in a third terminal:
   ```bash
   python3 scripts/healthcheck.py --watch 60
   ```

## During the event

- Watch the gate log and the `--watch` output.
- **Speed:** 10 active chatters get answers in about 20 s, and 20 in about 55 s ([LOADTEST.md](LOADTEST.md)). If replies get much slower than that, the room is over capacity. Ask Backend to:
  - lower `max_tokens` (e.g. to 128);
  - rate-limit each team to one request in flight;
  - or switch some levels to the backup machine.
- **Don't** open the Ollama app window, pull models or run other heavy work on this Mac.

## Incidents

| Symptom | Likely cause | Fix |
|---|---|---|
| Backend gets connection refused or a timeout on `:8080` | The gate stopped, the Wi-Fi changed, or the Mac slept | Check that the gate terminal is still running and restart it. Check `ipconfig getifaddr en0`; if the IP changed, tell Backend. |
| Backend gets 403 | The backend's IP changed | Read the new IP from the gate log line. Restart the gate with the new `--allow`. |
| Backend gets 502 | The gate is up but Ollama is down | `./scripts/ollama_env.sh apply`. If the app won't start, reboot (≈3 min), then run `apply` again. |
| First reply after a quiet spell takes ~10 s, or `healthcheck` says "not in memory" | The model was unloaded (Ollama restarted) | `./scripts/ollama_env.sh warm` |
| `healthcheck` settings FAIL | Ollama was restarted outside the script (e.g. after a reboot) | `./scripts/ollama_env.sh apply` |
| Lots of 503s | The queue is full (32 waiting) | Ask Backend to back off and cap concurrency. Don't raise `MAX_QUEUE`: that only turns 503s into timeouts. |
| Every reply is slow, and memory is WARN/FAIL | Swapping | Quit other apps. If it doesn't recover, run `./scripts/ollama_env.sh apply` to reload cleanly. |
| A reply contains reasoning or think tags | The guard isn't applied | Check Backend appends `/no_think` to the system prompt and every user message, and cleans every reply ([ENDPOINT.md](ENDPOINT.md)). Run `python3 scripts/verify_no_think.py`. |
| Mac dead, frozen or overheating | — | Fail over to the backup machine (below). |

## Backup machine

Prepare it the day before; any Apple Silicon Mac with 16 GB or more works.

1. Install the Ollama app, then clone this repo and check out the event branch.
2. **Copy the model weights** from the main Mac with a USB drive or AirDrop. Don't download over campus Wi-Fi. On the main Mac:
   ```bash
   tar -C ~ -cf ollama-models.tar .ollama/models
   ```
   On the backup Mac, with the Ollama app quit:
   ```bash
   tar -C ~ -xf ollama-models.tar
   ```
   If you have to download instead, resume-safe and kept awake:
   ```bash
   caffeinate -i /Applications/Ollama.app/Contents/Resources/ollama pull hf.co/Qwen/Qwen3-8B-GGUF:Q4_K_M
   ```
   then:
   ```bash
   /Applications/Ollama.app/Contents/Resources/ollama cp hf.co/Qwen/Qwen3-8B-GGUF:Q4_K_M qwen3:8b
   ```
3. Build the model:
   ```bash
   /Applications/Ollama.app/Contents/Resources/ollama create codex-qwen -f infra/ollama/Modelfile
   ```
4. Do steps 3–7 of [Setup on the day](#setup-on-the-day-start-60-min-before-doors), with the gate allowing the same backend IP.
5. On event day, keep it running with the model loaded ("hot standby").

**To fail over:** Backend changes its base URL to `http://<backup-ip>:8080/v1`. Nothing else changes: same model name, same guard, same API. Chats in progress continue, because the history lives on the backend.

## Restart from scratch (≈3 min)

```bash
./scripts/ollama_env.sh apply
```

```bash
python3 infra/proxy/gate.py --allow <backend-ip> --allow 127.0.0.1
```

```bash
python3 scripts/healthcheck.py
```

After a reboot, also start `caffeinate -dimsu` again. The `launchctl` settings are lost on reboot, and `apply` puts them back.

## After the event

```bash
./scripts/ollama_env.sh reset
```

Stop the gate and `caffeinate` with Ctrl-C, and turn Ollama's auto-update back on if you want it.
