"""Stateless framework-independent input/model/output orchestration."""

import asyncio
import time
from collections.abc import Callable, Mapping

from security.adapters import InferenceClient
from security.classifiers import MLInputClassifier, MLOutputClassifier
from security.config import load_config
from security.guardrails.policy_engine import PolicyEngine
from security.guardrails.prompt_security import (
    ContextAuthority,
    build_messages,
    build_secure_system_prompt,
)
from security.types import (
    InferenceResponse,
    InputClassifier,
    OutputClassifier,
    SecurityEvent,
    SecurityResult,
    TrustedSecurityContext,
)

_REFUSAL = "That request or response was blocked by the challenge security policy."
_ERROR = "The challenge is temporarily unable to process this request."


class SecurityPipeline:
    def __init__(
        self,
        authority: ContextAuthority,
        policies: PolicyEngine | None = None,
        *,
        input_classifiers: Mapping[int, InputClassifier] | None = None,
        output_classifiers: Mapping[int, OutputClassifier] | None = None,
        event_sink: Callable[[SecurityEvent], None] | None = None,
    ):
        self.authority = authority
        self.policies = policies or PolicyEngine({i: load_config(i) for i in (7, 8)})
        self.event_sink = event_sink
        self.inputs = (
            dict(input_classifiers)
            if input_classifiers is not None
            else {
                i: MLInputClassifier(self.policies.config(i).security.input_classifier)
                for i in self.policies.challenge_ids
            }
        )
        self.outputs = (
            dict(output_classifiers)
            if output_classifiers is not None
            else {
                i: MLOutputClassifier(
                    self.policies.config(i).security.output_classifier,
                    deterministic_checks=self.policies.config(i).security.deterministic_checks,
                )
                for i in self.policies.challenge_ids
                if self.policies.config(i).security.output_classifier.enabled
            }
        )

    def _event(self, challenge_id, stage, outcome, start, *, enabled=True):
        if self.event_sink is not None and enabled:
            try:
                self.event_sink(
                    SecurityEvent(
                        challenge_id, stage, outcome, (time.perf_counter() - start) * 1000
                    )
                )
            except Exception:
                # Observability failures neither disclose data nor disable guardrails.
                pass

    async def secure_inference(
        self,
        challenge_id: int,
        authenticated_team_id: str,
        message: str,
        trusted_context: TrustedSecurityContext,
        inference_client: InferenceClient,
    ) -> SecurityResult:
        start = time.perf_counter()
        stage = "request"
        log_enabled = True
        # Only emit a validated numeric challenge ID, even on malformed requests.
        event_challenge = (
            challenge_id if type(challenge_id) is int and challenge_id in (7, 8) else 0
        )
        try:
            config = self.policies.config(challenge_id)
            if (
                not isinstance(message, str)
                or not message.strip()
                or len(message) > config.max_input_chars
                or len(message.encode("utf-8"))
                > config.context_window - config.max_generation_tokens - 1024
                or "\x00" in message
            ):
                self._event(event_challenge, stage, "invalid_input", start)
                return SecurityResult("error", "Invalid participant message.", "invalid_input")
            stage = "context"
            self.authority.validate(trusted_context, authenticated_team_id, challenge_id)
            stage = "input"
            rule = config.security.input_classifier
            log_enabled = rule.event_logging
            classification = await asyncio.wait_for(
                self.inputs[challenge_id].classify_input(message, challenge_id),
                timeout=rule.timeout_seconds,
            )
            decision = self.policies.evaluate_input_policy(classification, challenge_id)
            self._event(challenge_id, stage, decision.action.value, start, enabled=log_enabled)
            if not decision.allowed:
                return SecurityResult("blocked", _REFUSAL, "input_blocked")
            system = build_secure_system_prompt(
                challenge_id,
                trusted_context,
                authority=self.authority,
                authenticated_team_id=authenticated_team_id,
            )
            stage = "inference"
            log_enabled = True
            generated = await asyncio.wait_for(
                inference_client.generate(build_messages(system, message), config),
                timeout=config.inference_timeout_seconds,
            )
            if not isinstance(generated, InferenceResponse):
                raise ValueError("Invalid response type")
            text = generated.content
            if (
                not isinstance(text, str)
                or not text.strip()
                or len(text) > config.max_output_chars
                or any(marker in text.lower() for marker in ("<think", "</think", "<|analysis"))
            ):
                raise ValueError("Invalid participant-facing response")
            if config.security.output_classifier.enabled:
                stage = "output"
                rule = config.security.output_classifier
                log_enabled = rule.event_logging
                output = await asyncio.wait_for(
                    self.outputs[challenge_id].classify_output(text, trusted_context),
                    timeout=rule.timeout_seconds,
                )
                decision = self.policies.evaluate_output_policy(output, challenge_id)
                self._event(challenge_id, stage, decision.action.value, start, enabled=log_enabled)
                if not decision.allowed:
                    return SecurityResult("blocked", _REFUSAL, "output_blocked")
            return SecurityResult("allowed", text, "ok")
        except Exception:
            self._event(event_challenge, stage, "error", start, enabled=log_enabled)
            # Never return exception messages, prompts, scores, model outputs, or flags.
            return SecurityResult("error", _ERROR, f"{stage}_failed")
