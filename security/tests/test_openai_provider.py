"""SDK transport and guardrail contracts. All network/model responses are simulated."""

import asyncio
import json

import httpx
import pytest

from security import PolicyEngine, SecurityPipeline, load_config
from security.adapters import OllamaClient, OpenAIClient, create_inference_client
from security.config.providers import OpenAISettings
from security.guardrails.prompt_security import build_messages
from security.runtime import load_environment_file
from security.tests.conftest import StubInput, StubOutput, configured
from security.types import SecurityError

pytest.importorskip("openai", reason="Install the openai extra for SDK transport tests")


@pytest.fixture(autouse=True)
def isolated_provider(monkeypatch):
    for key in (
        "LLM_PROVIDER",
        "OPENAI_API_KEY",
        "OPENAI_MODEL",
        "OPENAI_BASE_URL",
        "OPENAI_TIMEOUT_SECONDS",
        "OPENAI_MAX_RETRIES",
        "OPENAI_TOKEN_PARAMETER",
        "OPENAI_REASONING_EFFORT",
        "OLLAMA_MODEL",
    ):
        monkeypatch.delenv(key, raising=False)


def activate(monkeypatch, provider="openai"):
    monkeypatch.setenv("LLM_PROVIDER", provider)
    monkeypatch.setenv("OPENAI_API_KEY", "synthetic-api-key")
    monkeypatch.setenv("OPENAI_MODEL", "configured-model")
    monkeypatch.setenv("OPENAI_MAX_RETRIES", "0")


def payload(content="A safe final answer.", **message_fields):
    return {
        "id": "test",
        "object": "chat.completion",
        "created": 0,
        "model": "configured-model",
        "choices": [
            {
                "index": 0,
                "finish_reason": "stop",
                "message": {"role": "assistant", "content": content, **message_fields},
            }
        ],
    }


async def test_default_and_explicit_ollama_selection(monkeypatch):
    async with httpx.AsyncClient() as http:
        assert isinstance(create_inference_client(http), OllamaClient)
        monkeypatch.setenv("LLM_PROVIDER", "ollama")
        monkeypatch.setenv("OPENAI_API_KEY", "")
        assert isinstance(create_inference_client(http), OllamaClient)


async def test_openai_selection_model_and_policy_preserved(monkeypatch):
    before = {level: load_config(level).security for level in (7, 8)}
    activate(monkeypatch)
    monkeypatch.setenv("OLLAMA_MODEL", "irrelevant-ollama-model")
    async with httpx.AsyncClient() as http:
        assert isinstance(create_inference_client(http), OpenAIClient)
    for level in (7, 8):
        assert load_config(level).model == "configured-model"
        assert load_config(level).security == before[level]


@pytest.mark.parametrize(
    "key,value,code",
    [
        ("LLM_PROVIDER", "unknown", "invalid_llm_provider"),
        ("OPENAI_API_KEY", "", "missing_openai_api_key"),
        ("OPENAI_API_KEY", "bad key", "invalid_openai_api_key"),
        ("OPENAI_MODEL", "", "invalid_openai_model"),
        ("OPENAI_MODEL", "model\ninvalid", "invalid_openai_model"),
        ("OPENAI_BASE_URL", "https://user:private@example.test/v1", "invalid_openai_base_url"),
        ("OPENAI_BASE_URL", "http://remote.test/v1", "invalid_openai_base_url"),
        ("OPENAI_TIMEOUT_SECONDS", "nan", "invalid_openai_configuration"),
        ("OPENAI_TIMEOUT_SECONDS", "0", "invalid_openai_configuration"),
        ("OPENAI_MAX_RETRIES", "3", "invalid_openai_configuration"),
        ("OPENAI_MAX_RETRIES", "bad", "invalid_openai_configuration"),
        ("OPENAI_TOKEN_PARAMETER", "unsupported", "invalid_openai_configuration"),
        ("OPENAI_REASONING_EFFORT", "unsupported", "invalid_openai_configuration"),
    ],
)
async def test_invalid_startup_configuration(monkeypatch, key, value, code):
    activate(monkeypatch)
    monkeypatch.setenv(key, value)
    async with httpx.AsyncClient() as http:
        with pytest.raises(SecurityError) as caught:
            create_inference_client(http)
    assert str(caught.value) == code
    assert "synthetic-api-key" not in str(caught.value)


async def test_official_sdk_payload_normalization_and_preflight(monkeypatch):
    activate(monkeypatch)
    requests = []

    def handler(request):
        requests.append(request)
        if request.method == "GET":
            return httpx.Response(200, json={"id": "configured-model", "object": "model"})
        return httpx.Response(
            200,
            json=payload(
                reasoning_content="private reasoning",
                thinking="hidden",
                annotations=[{"secret": "hidden"}],
            ),
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        client = create_inference_client(http)
        await client.check_available("configured-model")
        result = await client.generate(
            build_messages("trusted secret context", "Hello /think"), load_config(7)
        )
        assert result.content == "A safe final answer."
        assert not http.is_closed
    body = json.loads(requests[1].content)
    assert body == {
        "model": "configured-model",
        "stream": False,
        "max_completion_tokens": 512,
        "messages": [
            {"role": "system", "content": "trusted secret context"},
            {"role": "user", "content": "Hello /think"},
        ],
    }
    assert "private" not in repr(result)
    assert "/no_think" not in requests[1].content.decode()


async def test_explicit_model_specific_parameters(monkeypatch):
    activate(monkeypatch)
    monkeypatch.setenv("OPENAI_TOKEN_PARAMETER", "max_tokens")
    monkeypatch.setenv("OPENAI_REASONING_EFFORT", "low")
    bodies = []

    def handler(request):
        bodies.append(json.loads(request.content))
        return httpx.Response(200, json=payload())

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        await create_inference_client(http).generate(
            build_messages("trusted", "Hello"), load_config(8)
        )
    assert bodies[0]["reasoning_effort"] == "low" and bodies[0]["max_tokens"] == 512
    assert "max_completion_tokens" not in bodies[0]


@pytest.mark.parametrize("status", [400, 401, 403, 404, 429, 500, 503])
async def test_api_failures_sanitized_no_fallback(monkeypatch, caplog, status):
    activate(monkeypatch)
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(status, json={"error": {"message": "private-flag-or-key"}})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        with pytest.raises(SecurityError, match="^inference_failed$"):
            await create_inference_client(http).generate(
                build_messages("trusted", "Hello"), load_config(7)
            )
    assert len(calls) == 1 and calls[0].url.host == "api.openai.com"
    assert "private-flag-or-key" not in caplog.text


@pytest.mark.parametrize("kind", ["transport_timeout", "connection", "deadline"])
async def test_timeout_and_connection_failure(monkeypatch, kind):
    activate(monkeypatch)
    monkeypatch.setenv("OPENAI_TIMEOUT_SECONDS", "0.01")

    async def handler(request):
        if kind == "deadline":
            await asyncio.sleep(0.2)
        elif kind == "connection":
            raise httpx.ConnectError("private endpoint", request=request)
        else:
            raise httpx.ReadTimeout("private input", request=request)
        return httpx.Response(200, json=payload())

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        with pytest.raises(SecurityError, match="^inference_failed$"):
            await create_inference_client(http).generate(
                build_messages("trusted", "Hello"), load_config(7)
            )


@pytest.mark.parametrize(
    "body",
    [
        payload(""),
        payload(None),
        payload("   "),
        {"choices": []},
        payload(
            "safe",
            tool_calls=[
                {"id": "test", "type": "function", "function": {"name": "x", "arguments": "{}"}}
            ],
        ),
        {
            "choices": [
                {"finish_reason": "tool_calls", "message": {"role": "assistant", "content": "safe"}}
            ]
        },
        payload([{"type": "text", "text": "uninspected structured response"}]),
    ],
)
async def test_invalid_and_empty_responses_fail_closed(monkeypatch, body):
    activate(monkeypatch)
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda r: httpx.Response(200, json=body))
    ) as http:
        with pytest.raises(SecurityError, match="^inference_failed$"):
            await create_inference_client(http).generate(
                build_messages("trusted", "Hello"), load_config(7)
            )


async def test_unexpected_stream_fails_closed(monkeypatch):
    activate(monkeypatch)
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda r: httpx.Response(
                200,
                headers={"content-type": "text/event-stream"},
                content=b'data: {"secret":"hidden"}\n\n',
            )
        )
    ) as http:
        with pytest.raises(SecurityError, match="^inference_failed$"):
            await create_inference_client(http).generate(
                build_messages("trusted", "Hello"), load_config(8)
            )


@pytest.mark.parametrize("provider", ["ollama", "openai"])
@pytest.mark.parametrize("level", [7, 8])
@pytest.mark.parametrize(
    "scenario", ["allowed", "input_blocked", "output_blocked", "inline_reasoning"]
)
async def test_both_providers_cannot_bypass_classifiers(
    monkeypatch, authority, provider, level, scenario
):
    activate(monkeypatch, provider)
    calls = []
    input_model = StubInput(0.99 if scenario == "input_blocked" else 0.1)
    output_model = StubOutput(0.99 if scenario == "output_blocked" else 0.1)
    content = (
        "<think>synthetic private context</think>Safe answer"
        if scenario == "inline_reasoning"
        else "Safe answer"
    )

    def handler(request):
        calls.append(json.loads(request.content))
        if provider == "openai":
            return httpx.Response(
                200, json=payload(content, reasoning_content="hidden provider field")
            )
        return httpx.Response(
            200,
            json={
                "done": True,
                "message": {
                    "role": "assistant",
                    "content": content,
                    "thinking": "hidden provider field",
                },
            },
        )

    pipeline = SecurityPipeline(
        authority,
        PolicyEngine({i: load_config(i) for i in (7, 8)}),
        input_classifiers={7: input_model, 8: input_model},
        output_classifiers={8: output_model},
    )
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        result = await pipeline.secure_inference(
            level,
            "team_alpha",
            "Hello /think",
            authority.issue("team_alpha", level),
            create_inference_client(http),
        )
    assert len(input_model.calls) == 1
    if scenario == "input_blocked":
        assert result.code == "input_blocked" and not calls and not output_model.calls
    elif scenario == "inline_reasoning":
        assert result.status == "error" and not output_model.calls
    else:
        assert len(calls) == 1
        assert "trusted" not in result.response and "hidden provider field" not in result.response
        assert len(output_model.calls) == (1 if level == 8 else 0)
        expected = "output_blocked" if scenario == "output_blocked" and level == 8 else "ok"
        assert result.code == expected
        if expected == "ok":
            assert result.response == "Safe answer"
        else:
            assert result.response != "Safe answer"
        assert (
            calls[0]["messages"][0]["content"].find(
                authority.issue("team_alpha", level).protected_flag
            )
            >= 0
        )


async def test_model_mismatch_and_role_escalation_rejected(monkeypatch):
    activate(monkeypatch)
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda r: pytest.fail("Network must not be called"))
    ) as http:
        client = create_inference_client(http)
        with pytest.raises(SecurityError, match="^invalid_openai_model$"):
            await client.check_available("different-model")
        with pytest.raises(SecurityError, match="^invalid_openai_model$"):
            await client.generate(
                build_messages("trusted", "Hello"), configured(7, model="other-model")
            )
        with pytest.raises(SecurityError, match="^invalid_roles$"):
            await client.generate(
                tuple(reversed(build_messages("trusted", "Hello"))), load_config(7)
            )


async def test_startup_api_failure_sanitized(monkeypatch):
    activate(monkeypatch)
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda r: httpx.Response(404, json={"error": {"message": "private"}})
        )
    ) as http:
        with pytest.raises(SecurityError, match="^openai_unavailable$"):
            await create_inference_client(http).check_available("configured-model")


def test_environment_file_supports_provider_settings(tmp_path, monkeypatch):
    path = tmp_path / "trusted.env"
    path.write_text(
        "LLM_PROVIDER=openai\nOPENAI_API_KEY=synthetic-api-key\nOPENAI_MODEL=configured-model\nOPENAI_MAX_RETRIES=0\n",
        encoding="utf-8",
    )
    for key in ("LLM_PROVIDER", "OPENAI_API_KEY", "OPENAI_MODEL", "OPENAI_MAX_RETRIES"):
        # Register restoration even when this key was initially absent. The loader
        # writes os.environ directly; it must not affect later Ollama tests.
        monkeypatch.setenv(key, "temporary-test-value")
        monkeypatch.delenv(key)
    load_environment_file(path)
    settings = OpenAISettings.from_environment()
    assert settings.model == "configured-model" and settings.max_retries == 0
    assert "synthetic-api-key" not in repr(settings)


async def test_retry_limit_and_recovery(monkeypatch):
    activate(monkeypatch)
    monkeypatch.setenv("OPENAI_MAX_RETRIES", "1")
    calls = []

    def handler(request):
        calls.append(request)
        if len(calls) <= 2:
            return httpx.Response(
                429, json={"error": {"message": "private"}}, headers={"retry-after-ms": "1"}
            )
        return httpx.Response(200, json=payload())

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        client = create_inference_client(http)
        with pytest.raises(SecurityError, match="^inference_failed$"):
            await client.generate(build_messages("trusted", "Hello"), load_config(7))
        assert len(calls) == 2
        assert (await client.generate(build_messages("trusted", "Hello"), load_config(7))).content
        assert len(calls) == 3


async def test_openai_team_contexts_not_reused(monkeypatch, authority):
    activate(monkeypatch)
    bodies = []

    def handler(request):
        bodies.append(json.loads(request.content))
        return httpx.Response(200, json=payload())

    pipeline = SecurityPipeline(
        authority,
        PolicyEngine({i: load_config(i) for i in (7, 8)}),
        input_classifiers={7: StubInput(), 8: StubInput()},
        output_classifiers={8: StubOutput()},
    )
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        client = create_inference_client(http)
        for team in ("team_alpha", "team_beta"):
            result = await pipeline.secure_inference(
                8, team, "Hello", authority.issue(team, 8), client
            )
            assert result.status == "allowed"
    alpha, beta = (authority.issue(team, 8).protected_flag for team in ("team_alpha", "team_beta"))
    assert alpha != beta
    assert alpha in bodies[0]["messages"][0]["content"]
    assert beta not in bodies[0]["messages"][0]["content"]
    assert beta in bodies[1]["messages"][0]["content"]
    assert alpha not in bodies[1]["messages"][0]["content"]


async def test_native_openai_runtime_startup_requests_and_shutdown(monkeypatch, authority):
    from security import deployment
    from security.classifiers.model_loader import ModelRunner

    activate(monkeypatch)
    engines = []
    requests = []

    class Engine:
        def __init__(self, config):
            engines.append(self)

        def score(self, text, hypotheses, max_tokens):
            return 0.1

    def handler(request):
        requests.append(request.method)
        if request.method == "GET":
            return httpx.Response(200, json={"id": "configured-model", "object": "model"})
        return httpx.Response(200, json=payload())

    monkeypatch.setattr(deployment, "configure_cpu_threads", lambda: None)
    monkeypatch.setattr(deployment, "ModelRunner", lambda config: ModelRunner(config, Engine))
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        runtime = deployment.SecurityRuntime(authority, create_inference_client(http))
        try:
            await runtime.start()
            assert runtime.health().provider_preflight_passed
            for level in (7, 8):
                assert (await runtime.handle(level, "team_alpha", "Hello")).status == "allowed"
            assert len(engines) == 2 and requests == ["GET", "POST", "POST"]
        finally:
            await runtime.aclose()
        assert runtime.health().state == "closed" and not http.is_closed


async def test_missing_optional_sdk_fails_closed(monkeypatch):
    import builtins

    activate(monkeypatch)
    original = builtins.__import__

    def unavailable(name, *args, **kwargs):
        if name == "openai":
            raise ImportError("private dependency details")
        return original(name, *args, **kwargs)

    async with httpx.AsyncClient() as http:
        monkeypatch.setattr(builtins, "__import__", unavailable)
        with pytest.raises(SecurityError, match="^openai_dependency_unavailable$"):
            create_inference_client(http)
