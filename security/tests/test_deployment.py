"""Lifecycle/contract regressions with simulated model engines, not ML evidence."""

import asyncio
import subprocess
import sys
import threading
from dataclasses import asdict
from types import SimpleNamespace

import pytest

from security import ContextAuthority, PolicyEngine, deployment, load_config
from security.classifiers import model_loader
from security.classifiers.model_loader import ModelRunner
from security.examples.backend_integration import participant_message, start_security, stop_security
from security.tests.conftest import StubInference, configured
from security.types import SecurityError


class ReadyInference(StubInference):
    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.preflights = []
        self.unavailable = False

    async def check_available(self, model):
        self.preflights.append(model)
        if self.unavailable:
            raise RuntimeError("private-upstream-details")


@pytest.fixture
def managed(monkeypatch, authority):
    engines = []
    observed = []
    control = SimpleNamespace(
        factory_failures=0,
        score_failures=0,
        input_score=0.1,
        output_score=0.1,
        started=threading.Event(),
        release=threading.Event(),
    )

    class Engine:
        def __init__(self, config):
            if control.factory_failures:
                control.factory_failures -= 1
                raise OSError("private-model-path-or-secret")
            self.config = config
            engines.append(self)

        def score(self, text, hypotheses, max_tokens):
            observed.append((text, hypotheses))
            if text == "hold":
                control.started.set()
                control.release.wait(5)
            if control.score_failures:
                control.score_failures -= 1
                raise RuntimeError("private-model-error")
            return control.output_score if hypotheses else control.input_score

    monkeypatch.setattr(deployment, "configure_cpu_threads", lambda: None)
    monkeypatch.setattr(deployment, "ModelRunner", lambda config: ModelRunner(config, Engine))
    inference = ReadyInference()
    runtime = deployment.SecurityRuntime(authority, inference)
    return runtime, inference, engines, observed, control


async def test_eager_start_shares_input_and_is_idempotent(managed):
    runtime, inference, engines, observed, _ = managed
    try:
        assert runtime.health().state == "new" and not engines
        await asyncio.gather(runtime.start(), runtime.start())
        assert runtime.health().ready and len(engines) == 2
        assert len(observed) == 2 and len(inference.preflights) == 1
        pipeline = runtime._pipeline
        assert pipeline.inputs[7]._runner is pipeline.inputs[8]._runner
        assert pipeline.inputs[7]._runner is not pipeline.outputs[8]._runner
        assert pipeline.inputs[7].config.threshold == 0.75
        assert pipeline.inputs[8].config.threshold == 0.80
        assert pipeline.outputs[8].config.threshold == 0.75
    finally:
        await runtime.aclose()
    assert runtime.health().state == "closed"
    assert all(runner.engine is None for runner in runtime._runners.values())
    assert all(
        thread not in threading.enumerate()
        for runner in runtime._runners.values()
        for thread in runner._executor._threads
    )


async def test_loading_rejects_requests_without_touching_inference(managed):
    runtime, inference, _, _, _ = managed
    runtime._state = "loading"
    result = await runtime.handle(7, "team_alpha", "hello")
    assert result.code == "security_unavailable" and not inference.calls
    await runtime.aclose()


@pytest.mark.parametrize("level", [7, 8])
async def test_request_flow_and_sanitized_contract(managed, level):
    runtime, inference, engines, observed, _ = managed
    try:
        await runtime.start()
        observed.clear()
        result = await participant_message(
            runtime, authenticated_team_id="team_alpha", level=level, message="Explain neurons."
        )
        assert set(result) == {"status", "response", "code"} and result["status"] == "allowed"
        assert len(inference.calls) == 1
        assert [bool(hypotheses) for _, hypotheses in observed] == (
            [False, True] if level == 8 else [False]
        )
        assert len(engines) == 2  # No per-request reload.
        assert tuple(m.role for m in inference.calls[0][0]) == ("system", "user")
    finally:
        await runtime.aclose()


async def test_thresholds_input_block_and_output_before_delivery(managed):
    runtime, inference, _, _, control = managed
    try:
        await runtime.start()
        control.input_score = 0.77
        assert (await runtime.handle(7, "team_alpha", "threshold fixture")).code == "input_blocked"
        assert not inference.calls
        assert (await runtime.handle(8, "team_alpha", "threshold fixture")).status == "allowed"
        control.output_score = 0.76
        assert (await runtime.handle(8, "team_alpha", "threshold fixture")).code == "output_blocked"
        control.output_score = 0.74
        assert (await runtime.handle(8, "team_alpha", "threshold fixture")).status == "allowed"
    finally:
        await runtime.aclose()


async def test_team_contexts_and_verification_stay_internal(managed, authority, caplog):
    runtime, inference, _, _, _ = managed
    teams = ("team_alpha", "team_beta", "team_gamma")
    flags = [authority.flag_service.derive_team_flag(team, 8) for team in teams]
    assert len(set(flags)) == 3
    try:
        await runtime.start()
        for team, flag in zip(teams, flags, strict=True):
            inference.content = flag
            result = await runtime.handle(8, team, "Explain neurons.")
            assert result.code == "output_blocked" and flag not in result.response
            system = inference.calls[-1][0][0].content
            assert flag in system and all(other not in system for other in flags if other != flag)
            assert runtime.validate_team_flag(team, 8, flag)
            for other in teams:
                assert runtime.validate_team_flag(other, 8, flag) == (other == team)
        assert not runtime.validate_team_flag("team_alpha", 7, flags[0])
        assert not runtime.validate_team_flag("team_alpha", 8, None)
        assert all(flag not in repr(runtime.health()) + caplog.text for flag in flags)
    finally:
        await runtime.aclose()


@pytest.mark.parametrize("level,team", [(9, "team_alpha"), (7, "../other"), (True, "team_alpha")])
async def test_bad_identity_or_level_cannot_select_context(managed, level, team):
    runtime, inference, _, _, _ = managed
    try:
        await runtime.start()
        assert (await runtime.handle(level, team, "hello")).code == "context_failed"
        assert not inference.calls
    finally:
        await runtime.aclose()


async def test_initialization_failure_retries_without_disclosing_details(managed, caplog):
    runtime, inference, _, _, control = managed
    control.factory_failures = 1
    try:
        with pytest.raises(SecurityError, match="^startup_failed$"):
            await runtime.start()
        assert not runtime.health().ready and not inference.preflights
        assert (await runtime.handle(7, "team_alpha", "hello")).status == "error"
        assert "private-model" not in repr(runtime.health()) + caplog.text
        await runtime.start()
        assert runtime.health().ready
    finally:
        await runtime.aclose()


async def test_ollama_outage_preflight_and_explicit_retry(managed):
    runtime, inference, engines, _, _ = managed
    inference.unavailable = True
    try:
        with pytest.raises(SecurityError, match="startup_failed"):
            await runtime.start()
        assert not runtime.health().ollama_preflight_passed
        inference.unavailable = False
        await runtime.start()
        assert runtime.health().ready and len(engines) == 2
        inference.error = RuntimeError("private-provider-error")
        assert (await runtime.handle(7, "team_alpha", "hello")).code == "inference_failed"
        inference.error = None
        assert (await runtime.handle(7, "team_alpha", "hello")).status == "allowed"
    finally:
        await runtime.aclose()


@pytest.mark.parametrize("level", [7, 8])
async def test_simultaneous_requests_busy_is_fail_closed_then_recovers(managed, level):
    runtime, inference, _, _, control = managed
    try:
        await runtime.start()
        first = asyncio.create_task(runtime.handle(level, "team_alpha", "hold"))
        assert await asyncio.to_thread(control.started.wait, 1)
        others = await asyncio.gather(
            runtime.handle(7, "team_beta", "second"), runtime.handle(8, "team_gamma", "third")
        )
        assert all(result.code == "input_failed" for result in others)
        assert not inference.calls
        control.release.set()
        assert (await first).status == "allowed"
        assert (await runtime.handle(8, "team_beta", "recovered")).status == "allowed"
    finally:
        control.release.set()
        await runtime.aclose()


async def test_shutdown_drains_active_requests_and_rejects_new_requests(managed):
    runtime, _, _, _, control = managed
    await runtime.start()
    request = asyncio.create_task(runtime.handle(8, "team_alpha", "hold"))
    try:
        assert await asyncio.to_thread(control.started.wait, 1)
        shutdown = asyncio.create_task(runtime.aclose())
        for _ in range(20):
            if runtime.health().state == "stopping":
                break
            await asyncio.sleep(0)
        assert runtime.health().state == "stopping" and not shutdown.done()
        assert (await runtime.handle(7, "team_beta", "new")).code == "security_unavailable"
        control.release.set()
        assert (await request).status == "allowed"
        await shutdown
        await runtime.aclose()
        with pytest.raises(SecurityError, match="runtime_closed"):
            await runtime.start()
    finally:
        control.release.set()
        await runtime.aclose()


async def test_classifier_request_timeout_keeps_worker_slot_and_recovers(managed):
    runtime, inference, _, _, control = managed
    runtime._policies = PolicyEngine(
        {7: configured(7, input_classifier={"timeout_seconds": 0.01}), 8: load_config(8)}
    )
    try:
        await runtime.start()
        assert (await runtime.handle(7, "team_alpha", "hold")).code == "input_failed"
        assert (await runtime.handle(8, "team_beta", "second")).code == "input_failed"
        assert not inference.calls
        control.release.set()
        # Await native completion without assuming a platform's thread scheduling.
        await asyncio.to_thread(
            next(iter(runtime._runners.values()))._executor.submit(lambda: None).result, 1
        )
        assert (await runtime.handle(8, "team_beta", "recovered")).status == "allowed"
    finally:
        control.release.set()
        await runtime.aclose()


async def test_startup_timeout_prevents_admission_and_can_retry(managed):
    runtime, inference, _, _, _ = managed
    original = inference.check_available

    async def slow(model):
        await asyncio.sleep(1)

    inference.check_available = slow
    try:
        with pytest.raises(SecurityError, match="startup_failed"):
            await runtime.start(startup_timeout=0.03)
        assert runtime.health().state == "failed"
        inference.check_available = original
        await runtime.start()
        assert runtime.health().ready
    finally:
        await runtime.aclose()


async def test_transient_score_error_recovers_on_next_request(managed):
    runtime, _, engines, _, control = managed
    try:
        await runtime.start()
        control.score_failures = 1
        assert (await runtime.handle(7, "team_alpha", "first")).code == "input_failed"
        assert not runtime.health().ready
        assert (await runtime.handle(7, "team_alpha", "second")).status == "allowed"
        assert runtime.health().ready and len(engines) == 2
    finally:
        await runtime.aclose()


@pytest.mark.parametrize("timeout", [0, -1, float("nan"), float("inf"), True, "30"])
async def test_invalid_startup_configuration(managed, timeout):
    runtime, _, engines, _, _ = managed
    with pytest.raises(SecurityError, match="invalid_configuration"):
        await runtime.start(startup_timeout=timeout)
    assert not engines
    await runtime.aclose()


def test_mismatched_shared_input_model_rejected(authority):
    other = configured(8, input_classifier={"revision": "a" * 40})
    with pytest.raises(SecurityError, match="invalid_configuration"):
        deployment.SecurityRuntime(
            authority, ReadyInference(), PolicyEngine({7: load_config(7), 8: other})
        )


async def test_missing_trusted_flags_fail_before_loading(managed):
    runtime, _, engines, _, _ = managed
    runtime._authority = ContextAuthority()
    try:
        with pytest.raises(SecurityError, match="startup_failed"):
            await runtime.start()
        assert not engines
    finally:
        await runtime.aclose()


def test_missing_master_secret_rejected(monkeypatch):
    monkeypatch.delenv("CRYPTUM_FLAG_MASTER_SECRET_HEX", raising=False)
    with pytest.raises(SecurityError, match="missing_master_secret"):
        deployment.SecurityRuntime.from_environment(ReadyInference())


async def test_offline_missing_weights_no_mock_fallback(tmp_path, monkeypatch):
    """Real loader entry point; simulated missing cache file, no network or torch."""
    monkeypatch.setenv("HF_HUB_OFFLINE", "1")
    monkeypatch.setenv("CRYPTUM_MODEL_CACHE", str(tmp_path / "empty-model-cache"))
    monkeypatch.setitem(sys.modules, "torch", SimpleNamespace())

    def missing(*args, **kwargs):
        assert kwargs["revision"] == load_config(7).security.input_classifier.revision
        raise OSError("private-missing-weight-path")

    monkeypatch.setitem(
        sys.modules,
        "transformers",
        SimpleNamespace(
            AutoTokenizer=SimpleNamespace(from_pretrained=missing),
            AutoModelForSequenceClassification=SimpleNamespace(from_pretrained=missing),
        ),
    )
    runner = ModelRunner(load_config(7).security.input_classifier)
    try:
        with pytest.raises(SecurityError, match="^classifier_unavailable$"):
            await runner.score("hello")
        assert runner.state == "error" and runner.engine is None
    finally:
        runner.close()


async def test_close_before_start_and_closed_cache_replacement(managed, monkeypatch):
    runtime, _, _, _, _ = managed
    await runtime.aclose()
    assert asdict(runtime.health())["ready"] is False
    monkeypatch.setattr(model_loader, "configure_cpu_threads", lambda: None)
    monkeypatch.setattr(model_loader, "_cache", {})
    config = load_config(7).security.input_classifier
    first = model_loader.get_model_runner(config)
    first.close()
    second = model_loader.get_model_runner(config)
    assert first is not second
    second.close()


async def test_backend_startup_and_shutdown_example(managed, monkeypatch):
    runtime, _, _, _, _ = managed
    http = httpx_client = SimpleNamespace(aclose=None)
    calls = []

    async def close():
        calls.append("http_closed")

    http.aclose = close
    import security.examples.backend_integration as example

    monkeypatch.setattr(example.httpx, "AsyncClient", lambda: httpx_client)
    monkeypatch.setattr(example, "create_inference_client", lambda client: ReadyInference())
    monkeypatch.setattr(example.SecurityRuntime, "from_environment", lambda client: runtime)
    returned, client = await start_security()
    assert returned is runtime and client is http
    await stop_security(returned, client)
    assert calls == ["http_closed"] and runtime.health().state == "closed"


def test_deployment_cli_invalid_file_sanitized(tmp_path):
    path = tmp_path / "bad.env"
    path.write_text("UNSUPPORTED=private-marker", encoding="utf-8")
    result = subprocess.run(
        [sys.executable, "-m", "security.deploy", "check", "--env-file", str(path)],
        capture_output=True,
        text=True,
        timeout=10,
    )
    assert result.returncode == 2 and "invalid_environment_file" in result.stderr
    assert "private-marker" not in result.stdout + result.stderr


async def test_model_prepare_uses_pinned_runners_and_closes_them(managed, monkeypatch):
    from security import deploy

    runtime, _, engines, _, _ = managed
    runners = []

    def capture(config):
        runner = deployment.ModelRunner(config)
        runners.append(runner)
        return runner

    monkeypatch.setattr(deploy, "ModelRunner", capture)
    monkeypatch.setattr(deploy, "configure_cpu_threads", lambda: None)
    await deploy.prepare_models(1)
    assert len(engines) == 2 and len(runners) == 2
    assert {runner.config.revision for runner in runners} == {
        load_config(7).security.input_classifier.revision,
        load_config(8).security.output_classifier.revision,
    }
    assert all(runner.state == "closed" and runner.engine is None for runner in runners)
    await runtime.aclose()


async def test_prepare_failure_closes_workers_and_returns_safe_error(managed, monkeypatch):
    from security import deploy

    runtime, _, _, _, control = managed
    control.factory_failures = 1
    monkeypatch.setattr(deploy, "ModelRunner", deployment.ModelRunner)
    monkeypatch.setattr(deploy, "configure_cpu_threads", lambda: None)
    with pytest.raises(SecurityError, match="^model_preparation_failed$"):
        await deploy.prepare_models(1)
    await runtime.aclose()


async def test_failed_backend_startup_closes_owned_resources(managed, monkeypatch):
    import security.examples.backend_integration as example

    runtime, _, _, _, control = managed
    control.factory_failures = 1
    closed = []

    async def close():
        closed.append(True)

    http = SimpleNamespace(aclose=close)
    monkeypatch.setattr(example.httpx, "AsyncClient", lambda: http)
    monkeypatch.setattr(example, "create_inference_client", lambda client: ReadyInference())
    monkeypatch.setattr(example.SecurityRuntime, "from_environment", lambda client: runtime)
    with pytest.raises(SecurityError, match="startup_failed"):
        await start_security()
    assert closed == [True] and runtime.health().state == "closed"


async def test_cancelled_shutdown_waiter_does_not_cancel_cleanup(managed):
    runtime, _, _, _, control = managed
    await runtime.start()
    request = asyncio.create_task(runtime.handle(7, "team_alpha", "hold"))
    try:
        assert await asyncio.to_thread(control.started.wait, 1)
        waiter = asyncio.create_task(runtime.aclose())
        await asyncio.sleep(0)
        waiter.cancel()
        with pytest.raises(asyncio.CancelledError):
            await waiter
        control.release.set()
        await request
        await runtime.aclose()
        assert runtime.health().state == "closed"
    finally:
        control.release.set()
        await runtime.aclose()


async def test_startup_cannot_admit_after_preflight_suppresses_deadline(managed, monkeypatch):
    runtime, inference, _, _, _ = managed
    await runtime.start()
    runtime._state = "failed"  # Simulate an explicit restart of the warmed worker.
    cancelled = asyncio.Event()
    loop = asyncio.get_running_loop()
    real_clock = loop.time
    clock_offset = 0.0

    async def suppress_cancellation(model):
        nonlocal clock_offset
        # Expire only after preflight starts, independent of runner/OS speed.
        clock_offset = 61.0
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            cancelled.set()

    original = inference.check_available
    inference.check_available = suppress_cancellation
    try:
        with monkeypatch.context() as clock:
            clock.setattr(loop, "time", lambda: real_clock() + clock_offset)
            with pytest.raises(SecurityError, match="^startup_failed$"):
                await runtime.start(startup_timeout=60.0)
        assert cancelled.is_set()
        assert not runtime.health().ready and not runtime.health().provider_preflight_passed
        assert (await runtime.handle(7, "team_alpha", "hello")).code == "security_unavailable"
        inference.check_available = original
        await runtime.start()
        assert runtime.health().ready
    finally:
        await runtime.aclose()


async def test_startup_deadline_includes_synchronous_initialization(managed, monkeypatch):
    import time

    runtime, inference, _, _, _ = managed

    def delayed_initialization():
        # Native initialization can occupy the loop until its deadline is overdue.
        time.sleep(0.03)

    async def immediately_ready(self, *args, **kwargs):
        return 0.1

    monkeypatch.setattr(deployment, "configure_cpu_threads", delayed_initialization)
    monkeypatch.setattr(ModelRunner, "score", immediately_ready)
    try:
        with pytest.raises(SecurityError, match="^startup_failed$"):
            await runtime.start(startup_timeout=0.01)
        assert runtime.health().state == "failed" and not inference.preflights
        assert not runtime.health().provider_preflight_passed
    finally:
        await runtime.aclose()
