"""Portable configuration and simulated platform branches; no downloaded models."""

import json
import subprocess
import sys
from types import SimpleNamespace

import httpx
import pytest

from security import load_config
from security.adapters import OllamaClient
from security.classifiers.model_loader import HFEngine, ModelRunner
from security.evaluation import resources
from security.runtime import load_environment_file
from security.types import SecurityError


def test_endpoint_environment_and_explicit_override(monkeypatch):
    monkeypatch.setenv("OLLAMA_URL", "https://inference.example.test:11434/proxy/")
    with httpx.Client():
        client = httpx.AsyncClient()
        assert OllamaClient(client).base_url == "https://inference.example.test:11434/proxy"
        assert OllamaClient(client, "http://127.0.0.1:11434").base_url == "http://127.0.0.1:11434"


@pytest.mark.parametrize(
    "url",
    [
        "",
        "localhost:11434",
        "file:///tmp/socket",
        "ftp://server",
        "http://",
        "http://user:synthetic-secret@example.test",
        "http://server?token=synthetic-secret",
        "http://server#fragment",
    ],
)
def test_invalid_endpoint_is_sanitized(url):
    with pytest.raises(SecurityError, match="^invalid_ollama_url$"):
        OllamaClient(httpx.AsyncClient(), url)


@pytest.mark.parametrize("level", [7, 8])
def test_model_environment_preserves_security(level, monkeypatch):
    monkeypatch.delenv("OLLAMA_MODEL", raising=False)
    before = load_config(level)
    monkeypatch.setenv("OLLAMA_MODEL", "team/qwen3:custom-tag")
    after = load_config(level)
    assert after.model == "team/qwen3:custom-tag"
    assert after.security == before.security
    assert after.allowed_roles == before.allowed_roles
    assert after.thinking_visibility == before.thinking_visibility


@pytest.mark.parametrize("model", ["", "  ", "model\nprivate", "model name", "../path", "x" * 129])
def test_invalid_model_environment_fails_closed(model, monkeypatch):
    monkeypatch.setenv("OLLAMA_MODEL", model)
    with pytest.raises(SecurityError, match="^invalid_configuration$"):
        load_config(7)


async def test_missing_ollama_is_safe():
    def unavailable(request):
        raise httpx.ConnectError("synthetic private details", request=request)

    async with httpx.AsyncClient(transport=httpx.MockTransport(unavailable)) as http:
        with pytest.raises(SecurityError, match="^ollama_unavailable$"):
            await OllamaClient(http).check_available("qwen3:8b")


async def test_missing_model_is_safe():
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda _: httpx.Response(200, json={"models": [{"name": "another-model:latest"}]})
        )
    ) as http:
        with pytest.raises(SecurityError, match="^ollama_model_unavailable$"):
            await OllamaClient(http).check_available("qwen3:8b")


@pytest.mark.parametrize("data", [{}, {"models": "broken"}, {"models": [None]}])
async def test_malformed_model_list_is_safe(data):
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda _: httpx.Response(200, json=data))
    ) as http:
        with pytest.raises(SecurityError, match="^ollama_unavailable$"):
            await OllamaClient(http).check_available("qwen3:8b")


async def test_remote_endpoint_request_and_model(monkeypatch):
    from security.guardrails.prompt_security import build_messages

    monkeypatch.setenv("OLLAMA_URL", "https://inference.example.test/proxy")
    monkeypatch.setenv("OLLAMA_MODEL", "team/qwen3:test")
    requests = []

    def handler(request):
        requests.append(request)
        if request.method == "GET":
            return httpx.Response(200, json={"models": [{"name": "team/qwen3:test"}]})
        return httpx.Response(
            200,
            json={
                "done": True,
                "message": {"role": "assistant", "content": "Safe reply", "thinking": "private"},
            },
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        client = OllamaClient(http)
        await client.check_available(load_config(7).model)
        value = await client.generate(build_messages("trusted fixture", "Hello"), load_config(7))
    assert value.content == "Safe reply"
    assert str(requests[0].url) == "https://inference.example.test/proxy/api/tags"
    assert str(requests[1].url) == "https://inference.example.test/proxy/api/chat"
    payload = json.loads(requests[1].content)
    assert payload["model"] == "team/qwen3:test"
    assert payload["stream"] is False and payload["think"] is False


async def test_default_tag_model_preflight():
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda _: httpx.Response(200, json={"models": [{"name": "qwen3:latest"}]})
        )
    ) as http:
        await OllamaClient(http).check_available("qwen3")


def test_explicit_environment_file_and_process_precedence(tmp_path, monkeypatch):
    monkeypatch.setenv("OLLAMA_URL", "http://existing.test:11434")
    monkeypatch.delenv("OLLAMA_MODEL", raising=False)
    monkeypatch.delenv("HF_HOME", raising=False)
    path = tmp_path / "environment with spaces.env"
    path.write_text(
        "# trusted fixture\nOLLAMA_URL=http://file.test:11434\n"
        'OLLAMA_MODEL="team/qwen3:tag"\nHF_HOME=${NO_INTERPOLATION}/models\n',
        encoding="utf-8",
    )
    # Restore process changes after the helper runs.
    monkeypatch.setenv("OLLAMA_MODEL", "temporary")
    monkeypatch.delenv("OLLAMA_MODEL")
    monkeypatch.setenv("HF_HOME", "temporary")
    monkeypatch.delenv("HF_HOME")
    load_environment_file(path)
    import os

    assert os.environ["OLLAMA_URL"] == "http://existing.test:11434"
    assert os.environ["OLLAMA_MODEL"] == "team/qwen3:tag"
    assert os.environ["HF_HOME"] == "${NO_INTERPOLATION}/models"


@pytest.mark.parametrize(
    "body",
    [
        "OLLAMA_URL=http://new.test\nUNKNOWN_PRIVATE=synthetic-secret\n",
        'OLLAMA_MODEL="unterminated synthetic-secret\n',
        "OLLAMA_MODEL\n",
    ],
)
def test_invalid_environment_file_is_atomic_and_sanitized(tmp_path, monkeypatch, body):
    import os

    monkeypatch.setenv("OLLAMA_URL", "http://existing.test")
    path = tmp_path / "invalid.env"
    path.write_text(body, encoding="utf-8")
    with pytest.raises(SecurityError, match="^invalid_environment_file$"):
        load_environment_file(path)
    assert os.environ["OLLAMA_URL"] == "http://existing.test"


def test_missing_environment_file_is_safe(tmp_path):
    with pytest.raises(SecurityError, match="^invalid_environment_file$"):
        load_environment_file(tmp_path / "missing.env")


@pytest.mark.parametrize("system,multiplier", [("Linux", 1024), ("Darwin", 1)])
def test_resource_units_and_no_nvidia(system, multiplier, monkeypatch):
    monkeypatch.setattr(resources.platform, "system", lambda: system)
    monkeypatch.setattr(resources.shutil, "which", lambda _: None)
    monkeypatch.setitem(
        sys.modules,
        "psutil",
        SimpleNamespace(
            Process=lambda: SimpleNamespace(memory_info=lambda: SimpleNamespace(rss=2048))
        ),
    )
    monkeypatch.setitem(
        sys.modules,
        "resource",
        SimpleNamespace(RUSAGE_SELF=0, getrusage=lambda _: SimpleNamespace(ru_maxrss=3000)),
    )
    value = resources.resource_snapshot()
    assert value["rss_bytes"] == 2048
    assert value["process_max_rss_bytes"] == 3000 * multiplier
    assert value["gpu_global_sample"] is None


def test_resource_tools_are_optional(monkeypatch):
    monkeypatch.setitem(sys.modules, "psutil", None)
    monkeypatch.setitem(sys.modules, "resource", None)
    monkeypatch.setattr(resources.shutil, "which", lambda _: None)
    assert resources.resource_snapshot() == {
        "rss_bytes": None,
        "process_max_rss_bytes": None,
        "gpu_global_sample": None,
    }


@pytest.mark.parametrize("bad_output", ["unavailable", "GPU, invalid, 3", "GPU, 1, 2\nGPU2, 1, 2"])
def test_invalid_optional_gpu_measurements_are_ignored(bad_output, monkeypatch):
    monkeypatch.setattr(resources.shutil, "which", lambda _: "nvidia-smi")
    monkeypatch.setattr(
        resources.subprocess, "run", lambda *a, **k: SimpleNamespace(stdout=bad_output)
    )
    assert resources.resource_snapshot()["gpu_global_sample"] is None


def test_loader_preserves_cpu_weights_and_cache_path(tmp_path, monkeypatch):
    calls = []
    model = SimpleNamespace(
        config=SimpleNamespace(id2label={0: "SAFE", 1: "INJECTION"}), eval=lambda: None
    )

    def move(device):
        assert device == "cpu"
        return model

    model.to = move

    def load(kind):
        def loader(model_id, **kwargs):
            calls.append((kind, model_id, kwargs))
            return model if kind == "model" else SimpleNamespace()

        return SimpleNamespace(from_pretrained=loader)

    cache = tmp_path / "model cache"
    monkeypatch.setenv("CRYPTUM_MODEL_CACHE", str(cache))
    monkeypatch.setitem(sys.modules, "torch", SimpleNamespace())
    monkeypatch.setitem(
        sys.modules,
        "transformers",
        SimpleNamespace(
            AutoTokenizer=load("tokenizer"), AutoModelForSequenceClassification=load("model")
        ),
    )
    config = load_config(7).security.input_classifier
    HFEngine(config)
    assert len(calls) == 2
    for kind, model_id, kwargs in calls:
        assert model_id == config.model_id and kwargs["revision"] == config.revision
        assert kwargs["cache_dir"] == str(cache)
        assert kwargs["trust_remote_code"] is False
        if kind == "model":
            assert kwargs["use_safetensors"] is True


async def test_missing_classifier_runtime_never_substitutes_a_mock(monkeypatch):
    monkeypatch.setitem(sys.modules, "torch", None)
    runner = ModelRunner(load_config(7).security.input_classifier)
    try:
        with pytest.raises(SecurityError, match="^classifier_unavailable$"):
            await runner.score("Ordinary message")
    finally:
        runner.close()


def test_python_startup_from_another_working_directory(tmp_path):
    # Package is installed in the test environment; no project-relative imports needed.
    result = subprocess.run(
        [sys.executable, "-m", "security", "--mock-classifiers"],
        cwd=tmp_path,
        capture_output=True,
        text=True,
        timeout=20,
    )
    assert result.returncode == 0, result.stderr
    assert "EXPLICIT MOCK" in result.stdout and "output:allow" in result.stdout


def test_cli_environment_errors_do_not_print_secret(tmp_path):
    path = tmp_path / "bad.env"
    path.write_text("UNKNOWN_PRIVATE=synthetic-secret\n", encoding="utf-8")
    result = subprocess.run(
        [sys.executable, "-m", "security", "--mock-classifiers", "--env-file", str(path)],
        cwd=tmp_path,
        capture_output=True,
        text=True,
        timeout=20,
    )
    assert result.returncode == 2
    assert "invalid_environment_file" in result.stderr
    assert "synthetic-secret" not in result.stderr + result.stdout
