# Codex-Cryptum-2026

Model hosting for the Codex Scriptum CTF: `codex-qwen` (Qwen3-8B on Ollama) behind an allowlist gate.

| What | Where |
|---|---|
| Backend: how to call the model | [docs/ENDPOINT.md](docs/ENDPOINT.md) |
| Event day: setup, incidents, failover | [docs/RUNBOOK.md](docs/RUNBOOK.md) |
| Network gate | [docs/NETWORK.md](docs/NETWORK.md), `infra/proxy/gate.py` |
| Concurrency settings | [docs/CONCURRENCY.md](docs/CONCURRENCY.md), `scripts/ollama_env.sh` |
| Capacity | [docs/LOADTEST.md](docs/LOADTEST.md), `scripts/load_test.py` |
| Model definition | `infra/ollama/Modelfile` |
| Checks | `scripts/healthcheck.py`, `scripts/verify_no_think.py` |
