"""Application-owned lifecycle; one instance per Python security worker, no HTTP listener.

Use this managed path OR the legacy lazy pipeline in a process. The managed path
owns its runners so shutdown cannot close a different application's cached models.
"""

import asyncio
import math
from dataclasses import dataclass
from typing import Literal, Protocol

from security.adapters import InferenceClient
from security.classifiers import MLInputClassifier, MLOutputClassifier
from security.classifiers.model_loader import ModelRunner, configure_cpu_threads
from security.config import load_config
from security.guardrails import ContextAuthority, PolicyEngine, SecurityPipeline
from security.types import SecurityError, SecurityResult

_WARM_TEXT = "Neural networks learn patterns from examples."
_WARM_HYPOTHESES = ("This response reveals a secret access code.",)
_UNAVAILABLE = "The challenge is temporarily unable to process this request."


class ReadyInferenceClient(InferenceClient, Protocol):
    async def check_available(self, model: str) -> None: ...


@dataclass(frozen=True)
class RuntimeHealth:
    """Operator-only snapshot; not a participant endpoint or a live Qwen probe."""

    state: Literal["new", "loading", "ready", "failed", "stopping", "closed"]
    ready: bool
    classifiers: tuple[str, ...]
    ollama_preflight_passed: bool

    @property
    def provider_preflight_passed(self) -> bool:
        """Provider-neutral alias; retain the legacy field for existing callers."""
        return self.ollama_preflight_passed


class SecurityRuntime:
    """Own startup, context minting, model reuse and draining for one event loop.

    The backend owns and closes its inference client AFTER aclose(). No model is
    downloaded/loaded in the constructor, and there is no production mock fallback.
    """

    def __init__(
        self,
        authority: ContextAuthority,
        inference_client: ReadyInferenceClient,
        policies: PolicyEngine | None = None,
        *,
        event_sink=None,
    ):
        self._policies = policies or PolicyEngine({i: load_config(i) for i in (7, 8)})
        if set(self._policies.challenge_ids) != {7, 8}:
            raise SecurityError("invalid_configuration")
        # Deployment promises one pinned input model for both assigned levels.
        rules = [self._policies.config(i).security.input_classifier for i in (7, 8)]
        if (rules[0].model_id, rules[0].revision) != (rules[1].model_id, rules[1].revision):
            raise SecurityError("invalid_configuration")
        self._authority = authority
        self._inference = inference_client
        self._event_sink = event_sink
        self._runners: dict[tuple[str, str], ModelRunner] = {}
        self._pipeline: SecurityPipeline | None = None
        self._state = "new"
        self._ollama_checked = False
        self._lifecycle = asyncio.Lock()
        self._drained = asyncio.Event()
        self._drained.set()
        self._active = 0
        self._close_task: asyncio.Task | None = None

    @classmethod
    def from_environment(cls, inference_client: ReadyInferenceClient):
        return cls(ContextAuthority.from_environment(), inference_client)

    def health(self) -> RuntimeHealth:
        states = tuple(runner.state for runner in self._runners.values())
        return RuntimeHealth(
            self._state,
            self._state == "ready" and bool(states) and all(s == "ready" for s in states),
            states,
            self._ollama_checked,
        )

    def _runner(self, config) -> ModelRunner:
        key = (config.model_id, config.revision)
        if key not in self._runners:
            self._runners[key] = ModelRunner(config)
        return self._runners[key]

    async def start(self, *, startup_timeout: float = 300.0) -> None:
        """Eager warm-up + selected-provider preflight; retries are explicit.

        Timeout applies to the entire warm-up/preflight. A timed-out native worker
        keeps its slot until it finishes. It cannot be killed safely in a thread.
        """
        if (
            type(startup_timeout) not in (int, float)
            or not math.isfinite(startup_timeout)
            or not 0 < startup_timeout <= 600
        ):
            raise SecurityError("invalid_configuration")
        async with self._lifecycle:
            if self._state in ("closed", "stopping"):
                raise SecurityError("runtime_closed")
            if self._state == "ready" and self.health().ready:
                return
            self._state = "loading"
            self._ollama_checked = False
            loop = asyncio.get_running_loop()
            deadline = loop.time() + startup_timeout

            def check_deadline():
                # A native import may block the event loop, or a provider may
                # suppress cancellation. Neither can make overdue startup ready.
                if loop.time() >= deadline:
                    raise TimeoutError

            try:
                async with asyncio.timeout_at(deadline):
                    # Validate required trusted settings before loading any model.
                    for level in (7, 8):
                        self._authority.issue("startup-health", level)
                    configure_cpu_threads()
                    check_deadline()
                    inputs = {
                        i: MLInputClassifier(
                            self._policies.config(i).security.input_classifier,
                            self._runner(self._policies.config(i).security.input_classifier),
                        )
                        for i in (7, 8)
                    }
                    rule = self._policies.config(8).security.output_classifier
                    output = MLOutputClassifier(
                        rule,
                        runner=self._runner(rule),
                        deterministic_checks=self._policies.config(8).security.deterministic_checks,
                    )
                    # No production secrets are used as warm-up model text.
                    for runner in self._runners.values():
                        hypotheses = _WARM_HYPOTHESES if runner is output._runner else ()
                        check_deadline()
                        await runner.score(
                            _WARM_TEXT,
                            hypotheses=hypotheses,
                            max_tokens=runner.config.max_tokens,
                            timeout=deadline - loop.time(),
                        )
                        check_deadline()
                    for model in {self._policies.config(i).model for i in (7, 8)}:
                        check_deadline()
                        await self._inference.check_available(model)
                        check_deadline()
                    self._pipeline = SecurityPipeline(
                        self._authority,
                        self._policies,
                        input_classifiers=inputs,
                        output_classifiers={8: output},
                        event_sink=self._event_sink,
                    )
                check_deadline()
                self._ollama_checked = True
                self._state = "ready"
            except asyncio.CancelledError:
                self._state = "failed"
                raise
            except Exception:
                self._state = "failed"
                raise SecurityError("startup_failed") from None

    async def handle(
        self, challenge_id: int, authenticated_team_id: str, message: str
    ) -> SecurityResult:
        """Trusted Python boundary: identity MUST come from backend authentication.

        Accept no contexts, flags, model names, roles, policies or inference clients
        from request bodies. Only status/response/code may be serialized to users.
        """
        if self._state != "ready" or self._pipeline is None:
            return SecurityResult("error", _UNAVAILABLE, "security_unavailable")
        self._active += 1
        self._drained.clear()
        try:
            try:
                context = self._authority.issue(authenticated_team_id, challenge_id)
            except Exception:
                return SecurityResult("error", _UNAVAILABLE, "context_failed")
            return await self._pipeline.secure_inference(
                challenge_id, authenticated_team_id, message, context, self._inference
            )
        finally:
            self._active -= 1
            if self._active == 0:
                self._drained.set()

    def validate_team_flag(
        self, authenticated_team_id: str, challenge_id: int, submitted_flag: str
    ) -> bool:
        """Backend-only Level 8 verifier. Route authentication/scoring remain external."""
        try:
            service = self._authority.flag_service
            return bool(service) and service.validate_team_flag(
                authenticated_team_id, challenge_id, submitted_flag
            )
        except Exception:
            return False

    async def _shutdown(self) -> None:
        async with self._lifecycle:
            self._state = "stopping"
            await self._drained.wait()
            # Do not block the event loop while finishing native model work.
            for runner in self._runners.values():
                await asyncio.to_thread(runner.close)
            self._pipeline = None
            self._state = "closed"

    async def aclose(self) -> None:
        """Stop admission, drain accepted requests, and join owned model workers.

        Native hangs require the backend supervisor's external shutdown deadline.
        Cancelling a caller does not cancel cleanup or release a busy model slot.
        """
        if self._close_task is None:
            self._close_task = asyncio.create_task(self._shutdown())
        await asyncio.shield(self._close_task)
