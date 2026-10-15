# Event-day runbook

Only needed if we fall back to self-hosting Qwen. The event runs on OpenAI.

Run commands from the repo root on the model machine (macOS or Linux).

## How it's set up

- **Ollama** runs `qwen3:8b` on `127.0.0.1:11434`, so only this machine can reach it. It's Qwen3-8B with our settings: short replies, low temperature, 8192 context. The untouched original is kept as `qwen3:8b-base`.
- **The gate** (`infra/proxy/gate.py`) listens on port 8080. It only lets the backend's IP use the chat route, which stops anyone else from deleting or flooding the model.
- **Settings** (`scripts/ollama_env.sh`): 4 requests run at once, up to 32 more wait in a queue, and the model stays loaded all day.

**Capacity:** about **20 replies a minute**. That's fine for 10–15 active teams. With 20–30 teams chatting nonstop, waits reach 1–1.5 min. Level 9 uses 2 model calls per message.

## Day before

- [ ] Turn off auto-update in the Ollama app (macOS).
- [ ] Get the backend machine's IP.
- [ ] **Network test.** Start the gate (step 5 below). From the backend machine, run:
  ```bash
  curl http://<model-machine-ip>:8080/api/tags
  ```
  - A list of models means it works.
  - `forbidden` means the wrong IP is on the allow list.
  - A timeout means the Wi-Fi blocks device-to-device traffic. Use a phone hotspot or travel router.
- [ ] Set up the backup machine (below).

## Setup (1 hour before)

1. Plug in the charger, keep the lid open, and quit all other apps.
2. Keep the machine awake, and leave this terminal open. On macOS:
   ```bash
   caffeinate -dimsu
   ```
   On Linux:
   ```bash
   systemd-inhibit --what=sleep:idle sleep infinity
   ```
3. Apply the settings and load the model:
   ```bash
   ./scripts/ollama_env.sh apply
   ```
4. Check nothing leaks reasoning:
   ```bash
   python3 scripts/verify_no_think.py
   ```
5. Start the gate in its own terminal. Use real IPs; don't type the `< >` brackets:
   ```bash
   python3 infra/proxy/gate.py --allow 192.168.1.20 --allow 127.0.0.1
   ```
6. Check everything:
   ```bash
   python3 scripts/healthcheck.py
   ```
7. Put an HTTPS proxy in front of port 8080 and give Backend its `https://` URL ending in `/v1`. Get the IP with `ipconfig getifaddr en0` (macOS) or `hostname -I` (Linux).
8. Leave a monitor running:
   ```bash
   python3 scripts/healthcheck.py --watch 60
   ```

## When something breaks

| Problem | Fix |
|---|---|
| Backend can't connect | Is the gate terminal still running? Did the IP change? |
| Backend gets 403 | Their IP changed. Restart the gate with the new `--allow`. |
| Backend gets 502, or the health check says Ollama is down | `./scripts/ollama_env.sh apply` |
| First reply is slow, or the health check says "not in memory" | `./scripts/ollama_env.sh warm` |
| Health check "settings" FAIL | `./scripts/ollama_env.sh apply` |
| Everything is slow | Quit other apps. Ask Backend to lower `max_tokens` or allow one message at a time per team. |
| A reply shows reasoning or think tags | Backend isn't following the rules in [ENDPOINT.md](ENDPOINT.md) |
| Machine dies | Switch to the backup machine |

## Backup machine

A Mac with 16 GB+, or Linux with an 8 GB+ NVIDIA GPU.

1. Install Ollama and clone this repo.
2. Copy the model from the main machine on a USB drive rather than downloading on campus Wi-Fi. On the main machine:
   ```bash
   tar -C ~ -cf ollama-models.tar .ollama/models
   ```
   On the backup, with Ollama stopped:
   ```bash
   tar -C ~ -xf ollama-models.tar
   ```
3. Create the model:
   ```bash
   ollama create qwen3:8b -f infra/ollama/Modelfile
   ```
   If you downloaded instead of copying, first name the download `qwen3:8b-base`:
   ```bash
   ollama cp hf.co/Qwen/Qwen3-8B-GGUF:Q4_K_M qwen3:8b-base
   ```
4. Do setup steps 2–6 on it, and keep it running on the day.

**To switch:** Backend changes the URL to the backup's IP. Nothing else changes.

## After the event

```bash
./scripts/ollama_env.sh reset
```
