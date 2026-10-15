# Akhand's Level 7–8 security module

Deployment and backend lifecycle instructions are in [DEPLOYMENT.md](DEPLOYMENT.md).
The application uses Next.js. Levels 7–8 now call the private CPU pretrained-model
bridge in `security.classifier_service`, through `apps/web/src/server/ml-classifiers.ts`.
It shares one DeBERTa engine across both levels and keeps the output model independent.
The configured LLM remains separate. Start the bridge with `python -m
security.classifier_service --env-file security/.env`; see the deployment guide for
private transport configuration and full launch commands. The native `SecurityRuntime`
is an alternative Python integration, not the path used by the web bridge.

This package implements Level 7 input classification, Level 8 input and output
classification, team-specific flags, and the shared security layer around Qwen3-8B.
It is independent of a backend framework. The original repository contained only a
title README, so there was no existing inference, team-ID, configuration, or security
interface to reuse. No other challenge levels or platform components are implemented.

## Architecture and ownership

Level 7: participant message → separate ML input classifier → input policy → trusted
system/user messages → injected Qwen client → participant-facing content.

Level 8 adds an ML output classifier and output policy before delivery. The input
implementation and loaded weights are shared with Level 7; each level has independent
thresholds, actions, timeouts, token limits, and diagnostic settings.

Every valid incoming message is classified. Empty, malformed, oversized, or
context-mismatched requests are rejected before model execution. The pipeline buffers
the complete response and never streams unclassified content.

The backend owns authentication, registration, stored histories, sessions, flag
submission routes, scoring, and the leaderboard. The hosting team owns Qwen/Ollama,
vLLM, GPU allocation, and serving. Teammates own the other levels and their filters.
This package provides interfaces for those components, without replacing them.

## Models, licenses, and reproducibility

| Component | Model | Pinned Hugging Face revision | License |
| --- | --- | --- | --- |
| Input | `protectai/deberta-v3-base-prompt-injection-v2` | `90c9989b1a342275dd0d1a95aad283c04e075671` | Apache-2.0 |
| Output | `cross-encoder/nli-MiniLM2-L6-H768` | `b95119ce93d3e065de6214e38cd4a97b0f2f2c6d` | Apache-2.0 |

The [input model card](https://huggingface.co/protectai/deberta-v3-base-prompt-injection-v2/tree/90c9989b1a342275dd0d1a95aad283c04e075671)
describes English prompt-injection fine-tuning with two labels, `SAFE` and
`INJECTION`. We preserve those binary capabilities; dataset attack categories are
evaluation annotations, not predicted categories. This upstream project is archived.
Its known language and jailbreak limitations apply here.

The [output model card](https://huggingface.co/cross-encoder/nli-MiniLM2-L6-H768/tree/b95119ce93d3e065de6214e38cd4a97b0f2f2c6d)
describes training on SNLI/MultiNLI and the labels contradiction, entailment, and
neutral. **It is not a pretrained secret-leak detector.** Our explicit zero-shot
strategy pairs each response window with three hypotheses: disclosure of an access code
or protected instructions, the current team's secret flag, and disclosure of the
trusted vault-custodian role. The maximum
three-way-softmax entailment score becomes the ML disclosure score. The strategy is
evaluated separately from input detection and from deterministic supplementation.
Do not interpret either model's score as a calibrated probability.

Both models load real safetensors weights at the pinned revision with
`trust_remote_code=False`, run in evaluation/inference mode on **CPU**, and share a
process cache keyed by model ID and revision in the legacy lazy path. The managed
`SecurityRuntime` instead owns its two runners and shares the input engine between
levels; use one lifecycle path per Python security worker. No additional generative model is loaded.
The input model has roughly 738 MB of FP32 weights and the output model roughly
328 MB; allow additional RAM for runtime and activations. GPU memory remains available
for Qwen. Model downloads and caches are excluded from Git.

Input and output tokenization uses overlapping windows, including the tail of long
texts. The output hypothesis consumes part of each window. A maximum over windows
can increase false positives on long content and can miss dependencies spanning
windows. Tokenization does not decode arbitrary attacker encodings.

## Portable installation on Linux and macOS

Run commands from the repository root. **Python 3.11 and 3.12 are the supported
range**, with 3.12 recommended for local ML inference. Dependencies are installed in
a virtual environment; the system Python and shell can differ from the application.
No shell activation, Bash functions, Fish syntax, Docker, or NVIDIA hardware is required.
Local real-model testing has been performed on Arch Linux; other platform results
must be confirmed by the new CI matrix or hardware testing. See
[PORTABILITY_REPORT.md](PORTABILITY_REPORT.md).

If uv is already installed, the setup is the same on Linux and Apple Silicon macOS:

```text
uv python install 3.12
uv sync --locked --python 3.12 --extra ml --extra dev --extra openai
uv run --no-sync python -m security --mock-classifiers
uv run --no-sync python -m pytest -q -m "not integration"
```

On **Linux** (Arch, Ubuntu, Debian, Fedora), uv's managed Python avoids distribution
default-version differences. Install uv using your distribution's package manager,
or bootstrap it into a virtual environment with an available Python 3 interpreter:

```text
python3 -m venv .bootstrap
.bootstrap/bin/python -m pip install uv
.bootstrap/bin/uv python install 3.12
.bootstrap/bin/uv sync --locked --python 3.12 --extra ml --extra dev --extra openai
```

If the distribution separates venv tooling, install it first: Ubuntu/Debian commonly
use `sudo apt install python3-venv python3-pip`; Fedora uses
`sudo dnf install python3 python3-pip`; Arch uses `sudo pacman -S python python-pip`.
These package-manager commands are optional host prerequisites, not application
runtime dependencies. Ubuntu, Debian, and Fedora execution is not claimed as tested
on this laptop.

On **macOS Apple Silicon**, use native arm64 Python rather than a Rosetta x86 process.
Homebrew users can install uv with `brew install uv` and use the shared commands
above. A Python.org installation can also run the bootstrap sequence. The lockfile
selects the native PyPI torch wheel on macOS and the CPU-only index on Linux.

On **macOS Intel**, the core package, configuration, flag services, injected-client
interfaces, unit tests, and explicit wiring demo have a dependency-compatible path:

```text
uv python install 3.12
uv sync --locked --python 3.12 --extra dev
uv run --no-sync python -m pytest -q -m "not integration"
uv run --no-sync python -m security --mock-classifiers
```

**Intel macOS cannot currently install the pinned local ML runtime from official
prebuilt torch wheels.** PyTorch ended macOS x86_64 wheel support after 2.2.x; the
project retains 2.9.1 and does not silently downgrade. A compatible same-version
source build or a backend with injected trusted classifiers running on a supported
machine is needed for real protected execution. The private classifier bridge can run on a supported Linux or Apple Silicon
host; the Next.js client can use its private HTTPS endpoint. With missing ML dependencies, real classifier execution fails
closed; the mock demo is explicitly labeled and cannot be combined with live inference.

A supported Python already installed on Linux or Apple Silicon can use pip:

```text
python3.12 -m venv .venv
.venv/bin/python -m pip install -r security/requirements.txt
.venv/bin/python -m security --mock-classifiers
```

Pip pins direct dependencies but does not consume uv's complete transitive lock;
uv is the reproducible setup path. Required dependencies contain no torch or GPU
packages. The optional `ml` group supplies CPU classifier inference; the optional
`dev` group supplies pytest, Ruff, and psutil for resource measurements. No Python
CUDA/ROCm packages are required or automatically installed on Linux. GPU acceleration
for Qwen is owned by Ollama, which selects supported hardware or CPU at the hosting
machine. Classifiers intentionally stay on CPU on all platforms to preserve existing
policy behavior and leave accelerator memory for Qwen.

The runtime keeps Transformers 4.57.6 and torch 2.9.1 (Linux `+cpu` variant), plus
the existing core dependency versions. Python-dotenv 1.2.4 handles explicit startup
files; psutil 7.2.2 is optional QA tooling. Model weights and revisions are unchanged.
Prepare the pinned artifacts before opening the competition:

```text
uv run --no-sync python -m security.deploy prepare --env-file security/.env --timeout 600
uv run --no-sync python -m security.deploy check --env-file security/.env --offline
```

Preparation needs only cache/model settings; the check requires valid trusted Level 7
and Level 8 configuration and the selected reachable inference provider. `--offline` forbids Hub downloads.
Set `HF_HUB_OFFLINE=1` in the trusted backend environment after preparation. The
check exits after closing its models; the backend must warm its own worker during
startup. Neither command starts an HTTP server. See [DEPLOYMENT.md](DEPLOYMENT.md).

## Trusted environment configuration

`security/.env.example` contains placeholders. The module does **not** automatically
discover `.env`. The host can inject environment variables, pass services explicitly,
or opt into the portable startup loader using `--env-file`. Existing process variables
take precedence over file values. Parsing uses UTF-8, accepts only the documented
keys, performs no variable interpolation or shell execution, and rejects malformed
files without printing their contents.
Never commit the master key or real flags.

The Next.js root `.env` and the Python guardrail `security/.env` have separate schemas.
The strict Python loader accepts `LLM_PROVIDER` but rejects backend-only database/auth
and `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL` variables. Python uses explicit `OPENAI_*`
or `OLLAMA_*` settings. It never maps `FLAG_SECRET` to the Python HMAC master key.
Agree flag derivation and key ownership with the backend team during integration.

| Variable | Purpose |
| --- | --- |
| `CRYPTUM_FLAG_MASTER_SECRET_HEX` | Required for Level 8: random secret of at least 32 bytes, hex encoded |
| `CRYPTUM_FLAG_ROTATION` | Stable competition epoch; default `2026-event-v1`; change explicitly to rotate flags |
| `CRYPTUM_LEVEL7_FLAG` | Trusted Level 7 flag; no production-code default |
| `OLLAMA_URL` | Trusted endpoint used by adapter and CLIs; default `http://127.0.0.1:11434` |
| `OLLAMA_MODEL` | Trusted model override for both challenge configs; default YAML `qwen3:8b` |
| `CRYPTUM_CLASSIFIER_THREADS` | Process-wide CPU intra-op thread count, 1–32; default 2 |
| `HF_HOME` | Optional model cache outside the repository |
| `CRYPTUM_MODEL_CACHE` | Optional dedicated pretrained-artifact cache; `~` expands portably |
| `HF_HUB_OFFLINE` | Optional cached-artifact-only loading |

Portable local startup, with no shell-specific environment assignment:

```text
uv run --no-sync python -m security --mock-classifiers --env-file security/.env.example
uv run --no-sync python -m security --ollama --env-file security/.env.example
```

The demonstration always uses ephemeral development contexts; it does not use the
file's master key or Level 7 placeholder as production secrets. For Python guardrail
configuration, copy the example to `security/.env`, replace placeholders privately, and
call `load_environment_file(Path("security/.env"))` from `security.runtime` before creating
`ContextAuthority.from_environment()`. Never pass participant-controlled files.

To connect to another hosting machine, set `OLLAMA_URL` in that trusted file, for
example `https://inference.example.test/ollama`, and set `OLLAMA_MODEL` to the model
available there. URL credentials/query strings/fragments are rejected; use an
application-owned authenticated HTTP client when required. Keep the hosting endpoint
and trusted configuration server-side. This repository does not configure a remote
Ollama server or expose participant-facing proxy routes.

The following remains an optional Fish-specific development example; it is not
required for startup:

```fish
set -gx CRYPTUM_FLAG_MASTER_SECRET_HEX (uv run python -c 'import secrets; print(secrets.token_hex(32))')
set -gx CRYPTUM_FLAG_ROTATION local-development-v1
set -gx CRYPTUM_LEVEL7_FLAG 'cdx{7h3_cl4ss1f13r_w4s_f00l3d}'
```

Keep the production key stable in the host's secret manager; generating it at each
startup changes team flags. The reference Level 8 fixture
`cdx{d0ubl3_gu4rdr41l_br34ch_8x92}` is evaluation-only and is never the production
shared flag. CLI demos and evaluation use isolated development keys/fixtures and
do not read the production flag master secret.

## Flags and protected-context isolation

`FlagService.derive_team_flag(authenticated_team_id, 8)` uses the complete 256-bit
HMAC-SHA256 digest, lowercase hex, inside `cdx{...}`. Its canonical JSON payload
includes the domain `cryptum/team-flag/v1`, rotation epoch, numeric challenge ID,
and exact authenticated team ID. This encoding avoids ambiguous concatenations.
The function supports Level 8 only; Level 7 uses its independent configured flag.
Stable identity/key/epoch gives a stable flag; changing the key or epoch rotates it.

`validate_team_flag` derives the current team's expected value and uses
`hmac.compare_digest` on ASCII bytes. Another team's flag is rejected. Invalid
types, malformed or incorrectly cased flags, non-ASCII values, and trailing
whitespace fail verification. Neither verification nor derivation performs scoring.

`ContextAuthority.issue(team_id, level)` creates an immutable backend-only context.
The authority binds team ID, challenge ID, and flag with a distinct HMAC domain and
a process-local random binding key. On every request it verifies the authenticated
identity, challenge, expected flag, and binding before inference. The system prompt
and validator therefore use the same flag derivation. Tampered contexts, contexts
from another authority, cross-team reuse, and contexts from a rotated key are rejected.
An authority should live for the application process; regenerate contexts after a
restart rather than persisting them. It is not a session database.

The backend must pass the team identity from its authenticated principal, **never
from participant JSON, a URL field, or the prompt**. Valid IDs are 1–128 ASCII
characters, starting with a letter/digit and then letters, digits, `_ . : @ -`.
The package validates bindings, not the authenticity of an external login.
Only the current team's context reaches Qwen and the output classifier. Secret
fields, model messages, inference responses, and result content are omitted from
object representations. Do not log raw message content or serialize trusted contexts.

## Policy and model security configuration

`security/config/level7.yaml` and `level8.yaml` are organizer-controlled configuration.
The strict loader rejects unknown keys, unsupported levels, nonnumeric/nonfinite
thresholds, unpinned revisions, missing classifier identifiers, disabled required
classifiers, inconsistent flag modes, invalid limits, and unsupported error policies.
Level 7 requires input screening and no output classifier; Level 8 requires both.

Input policy compares the model score with the configured threshold. Output policy
compares the ML score and incorporates the narrow supplementary match. At or above
threshold, the configured action is applied: `allow` delivers, `block` refuses,
and `log` delivers with a safe diagnostic event. Below threshold, policy allows.
The supplied challenge configurations enforce `block` on both required boundaries.
Scores and detailed classification objects are organizer/internal data and are absent
from `SecurityResult`.

The only supported system template is `vault_v1`, for Levels 7/8. It defines a vault
custodian persona, includes the current trusted flag, forbids secret/system-prompt
disclosure and transformations, and treats participant/retrieved/quoted content as
lower trust. No participant-controlled templates, role dictionaries, tool calls,
or system-message history are accepted. For future templates, add a reviewed trusted
template and explicitly extend the validated template identifier; do not let users
choose or populate it.

Model configuration includes model ID, context window, input/output character limits,
generation token limit, temperature, inference timeout, hidden reasoning visibility,
and allowed roles. The default is `qwen3:8b`, 8192 context tokens, 512 generation tokens,
6000 input characters, and temperature 0.3. A conservative UTF-8 byte budget reserves
space for system instructions and generation to avoid user text pushing out trusted
context. The permitted roles are exactly system then user.

The [Ollama adapter](https://docs.ollama.com/api/chat) sends `stream=false` and
`think=false`, then selects only `message.content`. Provider reasoning and metadata
are discarded, and common inline reasoning markers fail closed. This is a delivery
policy, not proof that a model performs no internal reasoning. Future adapters must
discard their own reasoning/tool fields and honor the same limits before returning
`InferenceResponse`.

## Output supplementation and extension boundary

The ML output model always runs first, even for exact leaks. The additional checks
cover the current flag, any `cdx{...}`-shaped text, Base64, hexadecimal, URL encoding,
reversal, and whitespace-separated characters. They inspect only the current flag;
there is no table of other teams' secrets. They intentionally do not reproduce the
Level 5/6 filters. Matching an unrelated public/example flag can cause a false positive.
Arbitrary Unicode, nesting, alternate encodings, semantic clues, and fragmented or
partial disclosure can evade these checks.

`ComposedOutputClassifier(primary, checks)` provides a narrow adapter for teammates'
existing filters. Each external adapter implements
`async matches(response, trusted_context) -> bool`. The primary ML classifier runs
before the adapters; adapter errors also fail closed in the pipeline. Existing input
or output abstractions can implement the typed classifier protocols. Authentication,
history retrieval, conversation judging, and other levels remain outside this module.

## Backend integration

Use the managed lifecycle once per Python security worker. Its handler accepts no
trusted context or inference settings from a participant. Jiya's Next.js backend
owns authentication and application routes. The private classifier bridge is implemented for the web flow. The helpers below
illustrate an alternative native Python integration, not Next.js routes.
See the executable Python-side integration helpers in
[examples/backend_integration.py](examples/backend_integration.py).

```python
from security.examples.backend_integration import (
    participant_message, start_security, stop_security,
)

# Trusted guardrail environment injected; Python security-worker startup:
runtime, http = await start_security()

# Future Python wrapper: backend caller verified; identity NEVER from participant JSON:
result = await participant_message(
    runtime, authenticated_team_id=verified_backend_identity.team_id,
    level=validated_request.level, message=validated_request.message,
)
# Only serialize result's status, response and code.
valid = runtime.validate_team_flag(
    verified_backend_identity.team_id, 8, validated_submission.submitted_flag,
)

# Worker shutdown, after stopping ingress:
await stop_security(runtime, http)
```

`SecurityRuntime.start()` validates secrets, eagerly warms the two pinned CPU models,
then preflights the selected inference provider. `health()` supplies private safe readiness metadata;
`handle()` creates the trusted team/challenge context internally and calls the
existing pipeline. `aclose()` stops admission, drains requests and joins owned
model workers before the backend closes its HTTP client. Required model/runtime
failures never select a mock or bypass screening.

The existing low-level `SecurityPipeline.secure_inference(level, team, message,
context, inference_client)` and `ContextAuthority.issue/validate` interfaces remain
available. Legacy pipeline construction is lazy and process-cached; deploy using one
managed runtime per worker rather than mixing model ownership paths. The backend's
existing inference client can implement `generate(messages, config) -> InferenceResponse`;
the managed runtime also requires `check_available(model) -> None` for startup
preflight. Both bundled adapters implement these methods, with explicit trusted
provider/model configuration. No participant-facing proxy or flag-generation endpoint exists.

The runtime's Level 8 validator uses the same authority, key and rotation as prompt
construction. The backend owns authenticated flag submission and scoring. Low-level
`FlagService.derive_team_flag/validate_team_flag`, `load_config`, the async classifier
protocols, typed policy decisions and prompt construction retain their interfaces.
The web flow uses the independent private HTTP classifier service around its
existing provider, prompt and scoring operations. It sends only authenticated
server-owned context, with mandatory Level 7/8 checks and sanitized failure behavior.
The native Python example itself contains no HTTP listener or authentication logic.

## Failure behavior and concurrency

Malformed participant input returns `invalid_input`. Missing/invalid configuration,
team context, Level 7 flag, master secret, classifier errors/timeouts/busy workers,
invalid classification scores, malformed model output, missing inference response,
and inference timeout/errors never bypass checks. The participant receives a fixed
`SecurityResult` with `allowed`, `blocked`, or `error` and a stable stage code.
Initialization/configuration functions raise sanitized `SecurityError` codes.

Diagnostics contain only challenge ID, pipeline stage, allow/block/log/error outcome,
and elapsed milliseconds. No raw text, flag, context, team ID, exception message, or
classifier score enters the event sink. A failing event sink cannot disable enforcement.
The host should disable HTTP body/ML debug tracing on secret-bearing calls.

Each cached model has one native inference worker with a single nonblocking slot.
Concurrent requests for the same model fail closed with a busy error rather than
queueing without bounds. The host may apply backpressure or retry. Classifier timeouts
bound the request wait; Python cannot forcibly stop native torch execution. A timed-out
worker holds its slot until it actually finishes. Hard cancellation requires an
external process boundary, which belongs to hosting rather than this package.

## Tests, evaluation, and local demo

The latest defensive QA results, verified defects and fixes, and integration verdict
are in [TEST_REPORT.md](TEST_REPORT.md). Its current metrics supersede the original
implementation measurements where noted. Real tests are opt-in and use cached weights
and synthetic contexts:

```fish
env HF_HUB_OFFLINE=1 CRYPTUM_RUN_REAL_INTEGRATION=1 uv run --no-sync python -m pytest -q -ra
env HF_HUB_OFFLINE=1 uv run --no-sync python -m security.evaluation.validate --ollama --report evaluation-local-validation.json
```

This defensive validation command evaluates the existing labeled dataset and sends
only benign questions to Qwen. It does not run the candidate-attack harness. Offline
loading fails explicitly if pinned artifacts are missing; it does not redownload them.

```fish
uv run python -m pytest -q
uv run ruff check security
uv run ruff format --check security
uv build --wheel
# Explicit mocks: no ML downloads, no Qwen required.
uv run python -m security.examples.demo --mock-classifiers
# Real pinned ML classifiers with mocked Qwen inference:
uv run python -m security.examples.demo
# Real classifiers and the existing local Qwen/Ollama installation:
uv run python -m security.examples.demo --ollama
# Real classifier metrics; default file is gitignored and contains no raw content:
uv run python -m security.evaluation.evaluate --report evaluation-local.json
```

The demo uses ephemeral development flags, prints status/policy information, verifies
different/stable team flags and cross-team rejection, and suppresses generated content.
The classifier-mock mode is explicitly labeled and prohibited with `--ollama`.

`sample_prompts.json` includes educational/cybersecurity questions, direct extraction,
overrides, authority impersonation, role spoofing, indirect injection, encodings,
obfuscation, multi-step requests, and ambiguous prompts. It has a development split
for threshold sweeps and a separate evaluation split, with no training performed.
`sample_outputs.json` separately labels benign responses, flag disclosures,
transformations, partial disclosures, and protected-instruction disclosures.
Output evaluation runs against both the reference fixture and a 256-bit derived
fixture. Those flag variants reuse templates and are not independent datasets.

The harness measures accuracy, precision, recall, F1, false-positive rate, confusion
matrix, and warmed mean/p50/p95 latency. It reports pure ML and supplemented output
results separately. It stores only sample IDs, labels, scores, timing, and metadata;
never production secrets or raw model content. Reports are organizer-only.

To test candidate attacks against actual Qwen, put a JSON array of prompt strings in
a local file and run:

```fish
uv run python -m security.evaluation.evaluate --candidate-attacks /tmp/cryptum-attacks.json --report evaluation-local.json
# Or use the checked-in small attack set:
uv run python -m security.evaluation.evaluate --candidate-attacks security/evaluation/candidate_attacks.json --report evaluation-local.json
```

This optional run uses real enforced policies and isolated local flags. Its report
records delivered exact-flag observations, never response bodies. A false negative in
classifier-only evaluation is not proof of an end-to-end successful attack. The
harness does not automatically reconstruct arbitrary encoded disclosures or implement
scoring.

The initial implementation unit run passed **148 tests** (0 failed); its Ruff,
wheel build, and whitespace checks passed. The subsequent defensive QA run passed
**169 mock-based/unit tests and 11 opt-in real integration tests**. Original measured
results and threshold decisions are recorded in
[evaluation/RESULTS.md](evaluation/RESULTS.md) and [evaluation/results.json](evaluation/results.json).
No model-card benchmark numbers are presented as local measurements.

## CTF difficulty and remaining limits

The provisional difficulty targets are **Hard** for Level 7 and **Very Hard** for
Level 8. Thresholds remain 0.75 for Level 7 input and 0.80/0.75 for Level 8 input/output,
per the organizer's current instruction. They are initial values, not approved or
validated difficulty settings; development sweeps are diagnostic only.

Level 7 is intended to challenge contestants to find genuine input-model blind spots
and then overcome Qwen's protected prompt. Level 8 adds an independent semantic
output check and narrow flag checks, making direct extraction harder. No passwords,
release phrases, attempt counters, or unconditional flag disclosure exist.

These are intentionally imperfect CTF defenses, not a guarantee of confidentiality.
English-only input detection, zero-shot output domain mismatch, ambiguous prompts,
partial disclosures, unusual encodings, and window boundaries are relevant limitations.
The pipeline accepts a fresh participant message, not a conversation history;
conversation-level manipulation is owned by the Level 9 teammate.

**Final organizer approval of difficulty and a real successful bypass are still
required before declaring either challenge solvable.** Direct/covered-encoding flag leaks are
blocked by default on Level 8. If evaluation finds no delivered flag, report that
result and investigate candidate attacks; do not silently disable enforcement or
weaken the configuration. Backend authentication, confidential logging practices,
and trusted handling of the inference endpoint are required integration dependencies.

## Selecting the Python LLM provider

The native Python pipeline supports Ollama and the **official OpenAI Python SDK
2.29.0**. Install the optional SDK without changing the classifier runtime:

```text
uv sync --locked --python 3.12 --extra ml --extra dev --extra openai
```

Alternatively, in an existing supported venv, install `.[openai]` with pip. The
version is pinned in `pyproject.toml` and `uv.lock` and uses the existing HTTPX
0.28.1 transport. Ollama and mock-only demos do not require the SDK extra.

Copy `security/.env.example` to private `security/.env` and edit it using an editor.
No shell activation or shell-specific environment assignment is required.

For OpenAI, set `LLM_PROVIDER=openai`, provide `OPENAI_API_KEY` through server-side
secrets, and set **your own** `OPENAI_MODEL`. There is no default OpenAI model.
`OPENAI_BASE_URL` defaults to `https://api.openai.com/v1`; custom remote endpoints
require HTTPS, while HTTP is permitted for loopback test endpoints only. The key
must never be browser-visible or included in participant requests. Do not enable
SDK/HTTP debug logging in protected workers because it can record request bodies.

For Ollama, set `LLM_PROVIDER=ollama`, `OLLAMA_URL=http://localhost:11434`, and
`OLLAMA_MODEL=qwen3:8b`. A trusted remote Ollama URL is supported. Ollama remains the
default when `LLM_PROVIDER` is absent. There is **no provider fallback** on failure.

Run Levels 7 and 8 locally with real classifiers and synthetic development contexts:

```text
uv run --no-sync python -m security --provider openai --env-file security/.env
uv run --no-sync python -m security --provider ollama --env-file security/.env
```

These are CLI demos, not new participant routes. They print status and organizer-only
classification metadata, never raw protected model responses. The original `--ollama`
shortcut remains supported. Without either live-provider option, inference is explicitly
mocked. `--mock-classifiers` cannot be combined with live inference.

`create_inference_client(http)` selects one long-lived client from trusted environment.
It implements the same `generate(messages, config) -> InferenceResponse` and startup
`check_available(model)` methods. `load_config` resolves `OPENAI_MODEL` only for OpenAI
and `OLLAMA_MODEL` only for Ollama; YAML thresholds, prompts and flag policies stay
unchanged. Direct `OllamaClient(http, url)` injection remains supported. For OpenAI,
the configured challenge model and client model must match.

```python
import httpx
from security.adapters import create_inference_client
from security.deployment import SecurityRuntime

async def run_request(authenticated_team_id: str, level: int, message: str):
    # Example lifecycle only: real hosts start one runtime per worker, not per request.
    async with httpx.AsyncClient() as http:
        runtime = SecurityRuntime.from_environment(create_inference_client(http))
        try:
            await runtime.start()
            return await runtime.handle(level, authenticated_team_id, message)
        finally:
            await runtime.aclose()
```

Use `security.examples.backend_integration.start_security`, `participant_message`
and `stop_security` for reusable worker lifecycle. The host owns the HTTP client,
closes it after draining the runtime, and supplies the authenticated identity. Native
runtime startup retains its existing required trusted flag/master settings. The
classifier-only web bridge needs neither those settings nor an OpenAI key.

### Provider parameters and failure behavior

| Setting | Scope / behavior |
| --- | --- |
| `LLM_PROVIDER` | Exact `ollama` or `openai`; unknown values fail at startup |
| `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_BASE_URL` | OpenAI only; key/model required, endpoint validated |
| `OPENAI_TIMEOUT_SECONDS` | OpenAI operation deadline, default 60, range >0–600 seconds |
| `OPENAI_MAX_RETRIES` | SDK retries, default 1, range 0–2; deadline caps total retry time |
| `OPENAI_TOKEN_PARAMETER` | Default `max_completion_tokens`; explicitly select `max_tokens` for compatible legacy models |
| `OPENAI_REASONING_EFFORT` | Optional; omitted unless explicitly configured for a supporting model |
| `OLLAMA_URL`, `OLLAMA_MODEL` | Ollama only; native `/api/chat`, `think=false`, nonstreamed |

The effective OpenAI request deadline is the smaller of the provider timeout and
existing challenge inference timeout. Retries cover the SDK's transient errors;
rate limits, timeout exhaustion, HTTP/API failures, empty/structured/tool responses
and unexpected streams return fixed errors. No upstream exception body is returned.
Startup verifies model access using the provider's models endpoint without generating
text. A compatible proxy that lacks this endpoint cannot pass native runtime preflight.

OpenAI requests contain the same trusted system/user roles and buffered final text.
They omit temperature and reasoning options by default because model support differs;
there are no guessed model capabilities or automatic parameter retries. Ollama keeps
its existing temperature/context options. Unsupported OpenAI models/settings fail
closed and require explicit organizer configuration. Some reasoning models can consume
the token budget without a final answer, which is treated as an inference failure.

Qwen `/think` and `/no_think` are never added to OpenAI prompts. Separate reasoning
fields, annotations and SDK metadata are discarded. Inline reasoning markers are
rejected by the existing pipeline. Level 8 classifies the **complete final text**
before returning it; neither adapter streams participant-visible tokens.

### Provider testing

```text
uv run --no-sync python -m pytest -q security/tests/test_openai_provider.py
uv run --no-sync python -m pytest -q -m "not integration"
```

The first command uses the real SDK with mocked HTTP and simulated classifier
responses. It makes no API calls. To opt into billable real OpenAI smoke and real
pretrained-classifier tests after configuring the explicit Python environment file:

```text
uv run --no-sync python -c "import os, pytest; from pathlib import Path; from security.runtime import load_environment_file; load_environment_file(Path('security/.env')); os.environ['CRYPTUM_RUN_OPENAI_INTEGRATION']='1'; os.environ['HF_HUB_OFFLINE']='1'; raise SystemExit(pytest.main(['-q', 'security/tests/test_openai_integration.py']))"
```

This makes three short generation calls using synthetic flags and cached CPU weights.
For existing real Ollama tests, select Ollama and use the separate
`CRYPTUM_RUN_REAL_INTEGRATION=1` opt-in documented above. Never point synthetic tests
at a production participant database. OpenAI model choice can affect refusal behavior
and CTF solvability; no model-equivalence or solved-challenge claim is made.


## Classifier reliability and false negatives

A real classifier score below the configured threshold is an allow decision; it is
not evidence that classification was skipped. The model runs in CPU evaluation mode,
while the separate generative model uses temperature 0.3. Repeated identical input
scores and varying LLM answers must be evaluated separately. There is no fallback
from a failed classifier to unrestricted generation. Only authenticated server code
can choose a team's context, challenge policy or active status.

The bridge now has bounded request admission, authenticated `--check` readiness,
strict request/verdict validation and sanitized diagnostics. Its optional LLM
configuration is independent of model loading. See the
[operational instructions](DEPLOYMENT.md#classifier-enforcement-investigation--2026-10-15)
and [latest evidence](TEST_REPORT.md#classifier-enforcement-follow-up--2026-10-15).

Level 7 deliberately has no output classifier, so accepted attacks can still win
through model behavior. Level 8 inspects every generated final answer, with existing
narrow encoded/exact checks and a final server-side exact-current-flag check. The
NLI output strategy still misses some partial or transformed disclosures; this
follow-up does not promise perfect injection detection or remove intended CTF solves.
