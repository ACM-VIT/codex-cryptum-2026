# Portability audit and implementation report

Date: 2026-10-15. Scope: Akhand's Level 7, Level 8, and shared security package.
This work changes installation, trusted runtime configuration, CLI startup, and
optional instrumentation. It does not change challenge weights, flags, prompts,
thresholds, actions, or intended classifier weaknesses. No commit or push was made.

## Original assumptions and changes

| Original assumption | Change |
| --- | --- |
| Torch always came from the Linux-style CPU wheel index | Linux keeps torch 2.9.1+cpu; other platforms resolve torch 2.9.1 from PyPI. The lock contains native Apple Silicon wheels. |
| Python 3.11–3.14 was advertised despite validation being on 3.12 | Supported application range narrowed to 3.11–3.12, both tested locally for the core package. |
| pip unconditionally required `torch==2.9.1+cpu` | The local CPU version requirement is Linux-marked; macOS uses the native non-local version. |
| Only Fish/Arch setup was described | Shared Python/uv commands, no-activation venv commands, Linux prerequisites, and separate Apple Silicon/Intel macOS guidance added. |
| Only the demo read `OLLAMA_URL`; validators and integration tests hardcoded localhost | The adapter, demo, evaluators, and integration tests now honor the same trusted endpoint configuration. Explicit adapter/CLI URLs take precedence. |
| Qwen model name was fixed in YAML with no environment override | `OLLAMA_MODEL` overrides the trusted model identifier for both levels; default remains `qwen3:8b`. Invalid names fail closed. |
| No uniform Python startup command / explicit env-file loader | `python -m security` wraps the existing demo; `--env-file` uses a trusted UTF-8 file without shell execution or interpolation. |
| Evaluation read `/proc/self/status` | Optional psutil provides RSS in bytes on Linux/macOS; unavailable tools return `None`. |
| Unix `ru_maxrss` was multiplied by 1024 everywhere | macOS byte and Linux KiB branches are handled separately; simulated unit tests verify the conversion. |
| NVIDIA measurement command was always attempted | It runs only if found, failures are tolerated, and unknown GPU readings remain `None`, including on machines without NVIDIA hardware. |
| Classifier cache configuration depended only on framework defaults | Existing `HF_HOME` remains supported; optional `CRYPTUM_MODEL_CACHE` is expanded using pathlib and passed to both pretrained loaders. |
| No CI platform matrix existed | Added six Linux/macOS Python-version jobs with CPU-only tests and no downloaded classifier weights. |

The audit found no hardcoded personal `/home/...` path or system Python interpreter
in runtime code. Package data already used `importlib.resources`, and flags already
used standard hashlib/HMAC operations. Those portable interfaces were retained.
Historical QA reports still mention Arch/Fish and original measurements because
they describe the machine and commands actually used at that time.

## Dependency and hardware policy

- Application Python: **3.11 or 3.12**; 3.12 is recommended for the tested local ML path.
- Core: pinned HTTPX, Pydantic, PyYAML, and python-dotenv 1.2.4; no torch or GPU dependency.
- Optional `ml`: unchanged torch 2.9.1, Transformers 4.57.6, SentencePiece and protobuf.
  Linux selects the `+cpu` wheel from an explicit index; native macOS wheels come from PyPI.
- Optional `dev`: existing QA tools plus psutil 7.2.2 for portable measurements.
- No automatic CUDA/ROCm installation. Classifiers intentionally stay on CPU with
  unchanged FP32 weights and scoring logic. Device fallback never means a mock classifier.
- Qwen hosting remains Ollama's responsibility. The client sends the same model roles,
  temperature, context/generation limits, `stream=false`, and `think=false`. Ollama
  selects acceleration supported by its host; a CPU-only host is permitted, with
  potentially slower generation and possible existing timeout errors.
- The two classifier artifacts occupy roughly 1.1 GB before runtime/activation
  overhead. Qwen's memory requirements depend on quantization and context length;
  Apple Silicon shares system memory with acceleration, so low-memory machines may
  experience pressure. A remote hosting machine can carry Qwen's memory demand.
  No minimum-memory performance guarantee or Metal VRAM measurement is claimed.
- No Docker setup was present or introduced. No server, authentication component,
  persistence layer, or other teammate's challenge was implemented.

See the hosting project's [Ollama FAQ](https://docs.ollama.com/faq) for its supported
hardware and server configuration; this package does not install drivers or choose
unverified accelerator kernels.

The official [uv PyTorch guidance](https://docs.astral.sh/uv/guides/integration/pytorch/)
documents platform-specific package sources. The resolver successfully produced a
lock with Linux CPU and Apple Silicon wheels for the supported Python versions.
Lockfile availability is **not evidence of successful native execution**.

### Intel macOS dependency limit

PyTorch's [2.2 release announcement](https://pytorch.org/blog/pytorch2-2/) states
that 2.2.x was the last official macOS x86_64 wheel series. The project retains its
2.9.1 runtime. The checked official [2.9.1 package metadata](https://pypi.org/pypi/torch/2.9.1/json)
contains macOS arm64 wheels for CPython 3.11/3.12 and no Intel macOS wheel.

Therefore:

- Intel macOS can install the **core/QA** package and exercise injected interfaces,
  configuration, HMAC flags, and explicitly mocked wiring, subject to native CI verification.
- **Default real local classifier inference on Intel macOS is not currently supported
  by official wheels.** A compatible same-version source build or an externally
  provided trusted classifier implementation is needed; this repository does not
  supply either or claim they were tested.
- No automatic torch downgrade, permissive mock substitution, or guardrail disablement
  was added. Missing real ML dependencies produce sanitized errors and fail closed.

This is the remaining upstream blocker to full native Intel-macOS gameplay, rather
than a portability success claim. Mac users should use native Apple Silicon Python
where available; running it through Rosetta may select the unsupported x86_64 path.

## Configuration and startup

The existing backend interfaces remain compatible:

- `OllamaClient(client, explicit_url)` is unchanged; omitting the URL now reads
  `OLLAMA_URL`, defaulting to `http://127.0.0.1:11434`.
- `load_config(level, path)` keeps its signature. `OLLAMA_MODEL` is a trusted startup
  override; no participant can choose a model through the message interface.
- `SecurityPipeline.secure_inference`, contexts, flags, and typed classifier protocols
  are unchanged. The evaluator's URL keyword is additive, and `resource_snapshot`
  remains importable through the validation module.

Environment files are explicitly selected and parsed fully before updates. Existing
process values take precedence. Unknown keys, malformed entries, and missing files
return a fixed error without echoing credentials. There is no automatic shell
interpolation or `.env` discovery. Use secrets from backend configuration only.

`OLLAMA_URL` supports trusted HTTP/HTTPS servers on another machine, including a
proxy path. URL credentials, query strings, fragments, and missing schemes/hosts
are rejected. Application-owned authenticated clients can supply required headers.
Endpoint access, transport protection, and server acceleration belong to hosting;
the endpoint must remain internal to the backend.

An optional preflight distinguishes missing Ollama and missing configured models
without pulling weights or printing provider errors. Inference still fails closed
if the provider disappears after preflight. Remote behavior was tested with HTTPX's
mock transport; real tests used the existing local server. No remote server was changed.

Portable demonstration/startup:

```text
uv sync --locked --python 3.12 --extra ml --extra dev
uv run --no-sync python -m security --mock-classifiers
uv run --no-sync python -m security --ollama --env-file security/.env.example
```

The first demo is explicitly mocked. The second uses real classifiers and Ollama;
it uses development contexts and does not turn environment placeholders into
production secrets. It is a local demonstration, not a production chat server.
Detailed per-platform prerequisites and venv/pip alternatives are in
[README.md](README.md#portable-installation-on-linux-and-macos).

## Tests and evidence

Thirty-nine platform-independent portability cases were added. They cover:

- Model/URL environment overrides, explicit URL precedence, remote proxy paths,
  default model tags, malformed URLs and model names.
- Missing Ollama, missing model, and invalid model-list responses with sanitized errors.
- Trusted `.env` parsing, paths containing spaces, no interpolation, atomic rejection,
  process-variable precedence, and secret-free CLI failures.
- Optional resource APIs, simulated Linux/macOS units, missing NVIDIA tools, and
  malformed GPU readings.
- Unchanged CPU placement, pinned revisions, safetensors loading, custom cache paths,
  and fail-closed behavior when torch is absent.
- Python startup from another working directory using the installed package.

Simulation and HTTP mock tests are not native macOS or real remote-server tests.
The model-loader mocks verify loader arguments and failures; the real integration
suite independently loads the unchanged cached weights and checks CPU placement.

| Environment/check | Actual result |
| --- | --- |
| Baseline before edits, Arch/Python 3.12 | 169 passed, 11 opt-in integration tests skipped |
| New portability suite, Arch/Python 3.12 | **39 passed**, 0 failed |
| Separate core/QA venv, Arch/Python 3.11.16, no torch installed | **208 passed**, 11 integration tests deselected; 0 failed |
| Full suite, Arch/Python 3.12.14, real cached models and local Qwen enabled | **219 passed**, 0 failed; 11 real integration cases included |
| Portable Python 3.11 startup with explicit env-file and mock classifiers | Passed |
| Portable Python 3.12 startup with explicit env-file, real classifiers, and local Ollama | Passed for both levels; input/output policies enforced |
| Wheel build and isolated wheel installation/startup | Passed, including entry point, resource/config files, and test/weight exclusions |
| Dependency compatibility, Ruff lint/format, whitespace | Passed |
| Native Ubuntu/Debian/Fedora execution | Not tested locally; Ubuntu is configured in CI |
| Native macOS Apple Silicon / Intel execution | Not tested; CI configured, not executed |
| Real remote Ollama | Not tested; mock transport coverage only |

Two upstream SentencePiece/SWIG deprecation warnings occurred in the real suite;
they did not fail any cases. Classifier downloads were not repeated, model artifacts
were not edited, and real tests used `HF_HUB_OFFLINE=1`.

The separate Python 3.11 environment demonstrates core behavior without ML packages;
it does not establish real-model inference on that interpreter. Python 3.12 real
integration tests establish local weight loading and policy behavior on Arch Linux.

## CI matrix

`.github/workflows/security-portability.yml` has six explicit jobs:

| Runner | Python | Dependency/test scope |
| --- | --- | --- |
| `ubuntu-24.04` | 3.11, 3.12 | CPU torch/Transformers import smoke, unit/mock tests, startup, wheel |
| `macos-15` (Apple Silicon) | 3.11, 3.12 | Native torch/Transformers CPU smoke, unit/mock tests, startup, wheel |
| `macos-15-intel` | 3.11, 3.12 | Core/QA only: unit/mock tests, startup, wheel; no unavailable torch installation |

The [GitHub runner reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)
documents these architecture-specific labels. CI uses read-only repository permissions,
offline Hugging Face mode, no model secrets, and no classifier-weight downloads. It
does not run Ollama or prove pretrained detection performance on macOS. **The matrix
has not run because these changes have not been pushed.**

## Security invariants and remaining limits

The diff confirms no edits to Level 7/8 YAML, protected prompt construction, policy
engine, pipeline enforcement, flag service/validator, or typed context definitions.
The configured input thresholds remain **0.75 / 0.80** and output **0.75**; actions
remain block, and protected flag format remains exactly case-sensitive `cdx{...}`.
Model identifiers and full commit revisions remain unchanged. Cross-team rejection,
context binding, safe errors, reasoning-field exclusion, and buffered output checks
remain covered by the existing and real integration suites.

CPU execution preserves the scoring strategy; this does not promise bit-for-bit
numerical equality across different BLAS libraries or all hardware. Pretrained
performance on macOS, Linux distributions other than the local host, and Python 3.11
still needs real-model validation. Existing detection limitations and intentionally
vulnerable CTF behavior were not repaired or hidden by this portability work.

The implementation is ready for cross-platform core CI and Linux backend integration.
Native Apple Silicon support is a dependency-compatible target pending actual tests.
Full Intel-macOS local inference remains limited by upstream wheel availability.
