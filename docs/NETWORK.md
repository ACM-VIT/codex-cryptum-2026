# Network exposure

## Why a gate instead of `OLLAMA_HOST=0.0.0.0`

Ollama has no authentication. Listening on `0.0.0.0` would give anyone on the Wi-Fi the full Ollama API, including `/api/delete`, `/api/create` and `/api/pull`. They could delete the model mid-event or flood it with requests.

Instead:

- **Ollama stays on `127.0.0.1:11434`.** That's the app's default; leave `OLLAMA_HOST` unset.
- **`infra/proxy/gate.py` listens on `0.0.0.0:8080`** and forwards to Ollama only when all of these hold:
  - the client IP is on the `--allow` list (anything else gets 403);
  - the route is `POST /v1/chat/completions`, `GET /v1/models` or `GET /api/tags` (anything else gets 404);
  - the request body is at most 256 KB and has `"model": "codex-qwen"` (otherwise 400 or 413).
- **Streaming responses pass through.** Every request is logged to stdout with the client IP, route, status and duration.

It uses only the Python standard library and needs no `sudo`.

## Running it

Find your own IP (for the backend team's base URL):

```bash
ipconfig getifaddr en0
```

Start the gate, allowing the backend machine (repeat `--allow` for each IP, e.g. a backup backend):

```bash
python3 infra/proxy/gate.py --allow <backend-ip>
```

To test from this Mac too, add `--allow 127.0.0.1`. Stop it with Ctrl-C.

On first start, macOS may ask whether Python may accept incoming network connections. Click **Allow**.

## Check before the event: can the machines reach each other?

Many campus networks isolate clients, so two laptops on the same Wi-Fi cannot connect to each other at all. Test with the real backend machine:

1. On the model Mac, start the gate with `--allow <backend-ip>`.
2. From the backend machine, run:
   ```bash
   curl http://<infra-host>:8080/api/tags
   ```
3. Read the result:
   - JSON listing `codex-qwen`: the network works.
   - `forbidden`: the network works, but the IP on the allow list is wrong. Check the backend's IP with `ipconfig getifaddr en0` (or `hostname -I` on Linux).
   - A timeout or connection refused: the network is blocking device-to-device traffic. Put both machines on a phone hotspot or a small travel router instead.

The backend's IP can change when it reconnects to Wi-Fi. Re-check it on event day, or reserve one on the router.
