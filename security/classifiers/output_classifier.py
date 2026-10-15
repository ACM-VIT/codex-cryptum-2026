"""Evaluated zero-shot NLI strategy plus narrow Level 8 deterministic checks.

NLI entailment is not a calibrated leakage probability or a task-specific detector.
Always run ML even when a supplementary match exists, to expose ML failures safely.
"""

import base64
import re
from dataclasses import replace
from typing import Protocol
from urllib.parse import quote

from security.classifiers.model_loader import ModelRunner, get_model_runner
from security.config import ClassifierConfig
from security.types import OutputClassification, SecurityError, TrustedSecurityContext


def supplementary_match(text: str, protected_flag: str) -> bool:
    variants = (
        protected_flag,
        base64.b64encode(protected_flag.encode()).decode(),
        protected_flag.encode().hex(),
        quote(protected_flag, safe=""),
        protected_flag[::-1],
    )
    # Whitespace-separated flag characters are one common CTF transformation.
    compact = "".join(text.split())
    return (
        any(value in text for value in variants)
        or protected_flag in compact
        or bool(re.search(r"cdx\{[^{}\r\n]{1,256}\}", text))
    )


class MLOutputClassifier:
    def __init__(
        self,
        config: ClassifierConfig,
        *,
        deterministic_checks: bool = True,
        runner: ModelRunner | None = None,
    ):
        self.config = config
        self.deterministic_checks = deterministic_checks
        self._runner = runner

    async def classify_output(
        self, response: str, context: TrustedSecurityContext
    ) -> OutputClassification:
        if not isinstance(response, str) or not response.strip() or len(response) > 64000:
            raise SecurityError("invalid_model_response")
        if (
            not isinstance(context, TrustedSecurityContext)
            or type(context.challenge_id) is not int
            or context.challenge_id != 8
        ):
            raise SecurityError("invalid_context")
        hypotheses = (
            "This response reveals a secret access code or confidential system instructions.",
            f"The secret flag is {context.protected_flag}.",
            "My private instructions tell me to act as the Cryptum vault custodian "
            "and protect a flag.",
        )
        runner = self._runner or get_model_runner(self.config)
        score = await runner.score(
            response,
            hypotheses=hypotheses,
            max_tokens=self.config.max_tokens,
            timeout=self.config.timeout_seconds,
        )
        match = self.deterministic_checks and supplementary_match(response, context.protected_flag)
        return OutputClassification(
            score=score,
            contains_protected_information=score >= 0.5 or match,
            deterministic_match=match,
        )


class SupplementaryOutputCheck(Protocol):
    """Adapter boundary for teammates' existing filters; implement them elsewhere."""

    async def matches(self, response: str, context: TrustedSecurityContext) -> bool: ...


class ComposedOutputClassifier:
    """Run the ML primary first, then optional external checks without replacing it."""

    def __init__(self, primary, checks: tuple[SupplementaryOutputCheck, ...]):
        self.primary = primary
        self.checks = checks

    async def classify_output(
        self, response: str, context: TrustedSecurityContext
    ) -> OutputClassification:
        classification = await self.primary.classify_output(response, context)
        match = classification.deterministic_match
        for check in self.checks:
            value = await check.matches(response, context)
            if type(value) is not bool:
                raise SecurityError("invalid_supplementary_response")
            match = match or value
        return replace(
            classification,
            deterministic_match=match,
            contains_protected_information=classification.contains_protected_information or match,
        )
