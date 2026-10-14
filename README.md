# Codex-Cryptum-2026

Collaborative ten-level LLM prompt-injection CTF. This repository currently implements
**only Akhand's Level 7, Level 8, and shared LLM security responsibilities**.
Other levels, the backend, authentication, scoring, persistence, and frontend remain
owned by their respective teammates.

The importable Python package and integration instructions are in
[security/README.md](security/README.md).

```text
security/
  classifiers/   Pinned, CPU-only input and output ML strategies
  flags/         Trusted internal HMAC derivation and team-aware verification
  guardrails/    Policies, context binding, protected prompts, inference pipeline
  config/        Validated Level 7 and Level 8 YAML configurations
  adapters/      Inference protocol and minimal non-streaming Ollama client
  tests/         Model-independent pytest suite
  evaluation/    Labeled datasets, evaluation harness, measured results
  examples/      Local CLI demonstration
pyproject.toml   Package, dependencies, lint and test configuration
uv.lock          Reproducible dependencies, including CPU PyTorch
```

From the repository root, using Arch Linux and fish:

```fish
uv sync --python 3.12 --extra ml --extra dev
uv run python -m pytest -q
uv run ruff check security
uv run ruff format --check security
uv build --wheel
uv run python -m security.examples.demo --mock-classifiers
```

The last command uses explicit classifier fixtures to test wiring without downloaded
models. Remove `--mock-classifiers` to use the real classifiers; add `--ollama` to use
the locally installed `qwen3:8b`. See the package README for evaluation and production
configuration. No commits or pushes are performed by these commands.
