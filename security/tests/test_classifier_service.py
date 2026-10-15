"""Real loopback HTTP contract, simulated ML engines; no external API or database."""

import asyncio
import threading
from types import SimpleNamespace

import httpx
import pytest

from security import PolicyEngine, load_config
from security import classifier_service as bridge
from security.classifiers.model_loader import ModelRunner
from security.tests.conftest import StubInput, StubOutput
from security.types import SecurityError

TOKEN = "synthetic-private-transport-token-" * 2
HEADERS = {"Authorization": f"Bearer {TOKEN}"}


@pytest.fixture
def server():
    service = bridge.ClassifierService.__new__(bridge.ClassifierService)
    service.ready = True
    service.runners = (SimpleNamespace(state="ready"), SimpleNamespace(state="ready"))
    service.policies = PolicyEngine({i: load_config(i) for i in (7, 8)})
    service.inputs = {7: StubInput(0.77), 8: StubInput(0.77)}
    service.output = StubOutput()
    server = bridge.PrivateClassifierServer(("127.0.0.1", 0), service, TOKEN)
    thread = threading.Thread(target=server.serve_forever)
    thread.start()
    try:
        yield server, service, f"http://127.0.0.1:{server.server_port}"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(2)
        assert not thread.is_alive()


def test_transport_auth_and_private_health(server):
    _, service, url = server
    assert httpx.get(url + "/health").status_code == 401
    assert httpx.get(url + "/health", headers=HEADERS).json() == {"ready": True}
    service.ready = False
    assert httpx.get(url + "/health", headers=HEADERS).status_code == 503


@pytest.mark.parametrize("level,allowed", [(7, False), (8, True)])
def test_threshold_decision_is_only_returned_field(server, level, allowed):
    _, service, url = server
    response = httpx.post(
        url + "/classify-input",
        headers=HEADERS,
        json={"challenge_id": level, "message": "ordinary fixture"},
    )
    assert response.status_code == 200 and response.json() == {"allowed": allowed}
    assert len(service.inputs[level].calls) == 1


@pytest.mark.parametrize(
    "payload",
    [
        [],
        {},
        {"challenge_id": True, "message": "hello"},
        {"challenge_id": 9, "message": "hello"},
        {"challenge_id": 7, "message": "hello", "threshold": 1},
    ],
)
def test_invalid_payloads_never_classify(server, payload):
    _, service, url = server
    response = httpx.post(url + "/classify-input", headers=HEADERS, json=payload)
    assert response.status_code == 400
    assert not service.inputs[7].calls and not service.inputs[8].calls


def test_errors_are_sanitized_and_no_secret_in_transport_logs(server, capsys):
    _, service, url = server
    marker = "private-test-marker"
    service.inputs[7].error = RuntimeError(marker)
    response = httpx.post(
        url + "/classify-input", headers=HEADERS, json={"challenge_id": 7, "message": marker}
    )
    assert response.status_code == 503
    assert marker not in response.text + str(capsys.readouterr())


def test_output_inspection_receives_only_request_local_flag(server):
    _, service, url = server
    service.output.match = True
    for suffix in ("alpha", "beta"):
        flag = f"cdx{{synthetic_{suffix}}}"
        response = httpx.post(
            url + "/classify-output",
            headers=HEADERS,
            json={"challenge_id": 8, "response": flag, "protected_flag": flag},
        )
        assert response.status_code == 200 and response.json() == {"allowed": False}
        assert flag not in response.text
        assert service.output.calls[-1][1].protected_flag == flag
    assert service.output.calls[0][1] is not service.output.calls[1][1]


@pytest.mark.parametrize(
    "path,payload,status",
    [
        (
            "/classify-output",
            {"challenge_id": 7, "response": "safe", "protected_flag": "cdx{test}"},
            400,
        ),
        (
            "/classify-output",
            {"challenge_id": 8, "response": "safe", "protected_flag": "invalid"},
            400,
        ),
        ("/unknown", {}, 404),
    ],
)
def test_invalid_output_context_or_route(server, path, payload, status):
    _, service, url = server
    assert httpx.post(url + path, headers=HEADERS, json=payload).status_code == status
    assert not service.output.calls


def test_non_json_and_oversized_body_rejected(server):
    _, _, url = server
    assert (
        httpx.post(url + "/classify-input", headers=HEADERS, content="private").status_code == 415
    )
    response = httpx.post(url + "/classify-input", headers=HEADERS, json={"message": "x" * 262144})
    assert response.status_code == 413


def test_invalid_token_cannot_create_listener():
    with pytest.raises(Exception, match="invalid_classifier_token"):
        bridge.PrivateClassifierServer(("127.0.0.1", 0), SimpleNamespace(), "short")


async def test_real_runner_lifecycle_with_simulated_weights(monkeypatch):
    engines = []

    class Engine:
        def __init__(self, config):
            engines.append(config.model_id)

        def score(self, text, hypotheses, max_tokens):
            return 0.1

    monkeypatch.setattr(bridge, "configure_cpu_threads", lambda: None)
    monkeypatch.setattr(bridge, "ModelRunner", lambda config: ModelRunner(config, Engine))
    service = bridge.ClassifierService()
    try:
        await service.start()
        assert service.ready and len(engines) == 2
        assert service.inputs[7]._runner is service.inputs[8]._runner
        results = await asyncio.gather(
            service.classify("/classify-input", {"challenge_id": 7, "message": "hello"}),
            service.classify("/classify-input", {"challenge_id": 8, "message": "hello"}),
            return_exceptions=True,
        )
        # A tiny engine may finish before the second caller is scheduled. Either
        # sequential success or an explicit busy error is valid; no model reload.
        assert any(value is True for value in results)
        assert all(value is True or isinstance(value, SecurityError) for value in results)
        assert all(
            value.code == "classifier_busy" for value in results if isinstance(value, SecurityError)
        )
        assert len(engines) == 2
    finally:
        service.close()
    assert not service.ready and all(runner.engine is None for runner in service.runners)


@pytest.mark.parametrize("message", ["", " ", None, [], 12, "bad\x00input", "x" * 6001])
def test_malformed_text_rejected_before_ml(server, message):
    _, service, url = server
    result = httpx.post(
        url + "/classify-input", headers=HEADERS, json={"challenge_id": 7, "message": message}
    )
    assert result.status_code == 400
    assert not service.inputs[7].calls


@pytest.mark.parametrize("level,threshold", [(7, 0.75), (8, 0.80)])
def test_exact_threshold_enforced(server, level, threshold):
    _, service, url = server
    for score, allowed in ((threshold - 0.0001, True), (threshold, False)):
        service.inputs[level].score = score
        result = httpx.post(
            url + "/classify-input",
            headers=HEADERS,
            json={"challenge_id": level, "message": "fixture"},
        )
        assert result.json() == {"allowed": allowed}


@pytest.mark.parametrize("provider", ["openai", "invalid-provider"])
async def test_local_models_independent_of_llm_configuration(monkeypatch, provider):
    monkeypatch.setenv("LLM_PROVIDER", provider)
    monkeypatch.delenv("OPENAI_MODEL", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)

    class Engine:
        def __init__(self, config):
            pass

        def score(self, text, hypotheses, max_tokens):
            return 0.1

    monkeypatch.setattr(bridge, "configure_cpu_threads", lambda: None)
    monkeypatch.setattr(bridge, "ModelRunner", lambda config: ModelRunner(config, Engine))
    service = bridge.ClassifierService()
    try:
        await service.start()
        assert service.healthy()
        assert await service.classify("/classify-input", {"challenge_id": 7, "message": "hello"})
        assert service.inputs[7]._runner is service.inputs[8]._runner
    finally:
        service.close()


async def test_missing_weights_fail_closed_without_private_path(monkeypatch, caplog):
    def unavailable(config):
        raise FileNotFoundError("private-cache-path-marker")

    monkeypatch.setattr(bridge, "configure_cpu_threads", lambda: None)
    monkeypatch.setattr(bridge, "ModelRunner", lambda config: ModelRunner(config, unavailable))
    service = bridge.ClassifierService()
    try:
        with pytest.raises(SecurityError, match="classifier_unavailable"):
            await service.start()
        assert not service.ready
        assert "private-cache-path-marker" not in caplog.text
    finally:
        service.close()


def test_auth_health_reflects_runner_error(server):
    _, service, url = server
    bridge.check_service(TOKEN, url)
    service.runners[0].state = "error"
    assert httpx.get(url + "/health", headers=HEADERS).status_code == 503
    with pytest.raises(SecurityError, match="classifier_not_ready"):
        bridge.check_service(TOKEN, url)
    service.runners[0].state = "ready"
    bridge.check_service(TOKEN, url)


def test_queue_saturation_errors_then_recovers(server):
    transport, service, url = server
    transport.queue_timeout = 0.01
    gate = transport._inference_slots["input"]
    gate.acquire()
    try:
        result = httpx.post(
            url + "/classify-input", headers=HEADERS, json={"challenge_id": 8, "message": "hello"}
        )
        assert result.status_code == 503 and not service.inputs[8].calls
    finally:
        gate.release()
    assert httpx.post(
        url + "/classify-input", headers=HEADERS, json={"challenge_id": 8, "message": "hello"}
    ).json() == {"allowed": True}


def test_concurrent_http_calls_serialized_and_all_classified(server):
    import time
    from concurrent.futures import ThreadPoolExecutor

    _, service, url = server
    active = maximum = 0
    lock = threading.Lock()

    class SlowInput(StubInput):
        async def classify_input(self, message, challenge_id):
            nonlocal active, maximum
            with lock:
                active += 1
                maximum = max(maximum, active)
            try:
                time.sleep(0.04)
                return await super().classify_input(message, challenge_id)
            finally:
                with lock:
                    active -= 1

    model = SlowInput()
    service.inputs = {7: model, 8: model}

    def request(level):
        return httpx.post(
            url + "/classify-input",
            headers=HEADERS,
            json={"challenge_id": level, "message": "hello"},
        ).json()

    with ThreadPoolExecutor(max_workers=3) as pool:
        assert list(pool.map(request, [7, 8, 7])) == [{"allowed": True}] * 3
    assert maximum == 1 and len(model.calls) == 3


@pytest.mark.parametrize("value", ["nan", "inf", "-1", "31", "invalid"])
def test_invalid_queue_config_rejected(monkeypatch, value):
    monkeypatch.setenv("CRYPTUM_CLASSIFIER_QUEUE_TIMEOUT_SECONDS", value)
    with pytest.raises(SecurityError, match="invalid_configuration"):
        bridge.PrivateClassifierServer(("127.0.0.1", 0), SimpleNamespace(), TOKEN)


def test_timeout_is_fail_closed_and_next_request_recovers(server, caplog):
    _, service, url = server
    config = service.policies.config(8).model_dump()
    config["security"]["input_classifier"]["timeout_seconds"] = 0.01
    from security.config import ChallengeConfig

    service.policies = PolicyEngine({8: ChallengeConfig.model_validate(config)})

    class SlowInput:
        async def classify_input(self, message, challenge_id):
            await asyncio.sleep(60)

    service.inputs[8] = SlowInput()
    result = httpx.post(
        url + "/classify-input", headers=HEADERS, json={"challenge_id": 8, "message": "hello"}
    )
    assert result.status_code == 503 and "classifier_timeout" in caplog.text
    service.inputs[8] = StubInput()
    assert httpx.post(
        url + "/classify-input", headers=HEADERS, json={"challenge_id": 8, "message": "hello"}
    ).json() == {"allowed": True}
