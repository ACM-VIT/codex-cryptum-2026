"""Operator-only classifier metadata. Never accept prompts, flags, keys or exceptions."""

import json
import logging
import math

from security.types import SecurityError

LOGGER = logging.getLogger("cryptum.classifiers")
PUBLIC_CODES = frozenset(
    {
        "classifier_unavailable",
        "classifier_timeout",
        "classifier_busy",
        "invalid_model_response",
        "invalid_model_labels",
        "invalid_classification",
        "invalid_classifier_context",
        "invalid_classifier_token",
        "invalid_configuration",
        "invalid_environment_file",
        "invalid_classifier_configuration",
        "classifier_authentication_failed",
        "classifier_not_ready",
        "classifier_unreachable",
        "classifier_invalid_response",
    }
)


def error_code(error: Exception) -> str:
    if isinstance(error, SecurityError) and error.code in PUBLIC_CODES:
        return error.code
    if isinstance(error, TimeoutError):
        return "classifier_timeout"
    return "classifier_unavailable"


def record(
    event: str,
    *,
    stage: str = "startup",
    challenge_id: int = 0,
    outcome: str = "",
    code: str = "",
    elapsed_ms: float = 0.0,
    port: int = 0,
) -> None:
    """Call sites supply fixed strings and numeric metadata only; no upstream text."""
    payload = {
        "event": event,
        "stage": stage,
        "challenge_id": challenge_id,
        "outcome": outcome,
        "code": code if code in PUBLIC_CODES else "",
        "elapsed_ms": round(elapsed_ms, 2) if math.isfinite(elapsed_ms) else 0.0,
    }
    if port:
        payload["port"] = port
    try:
        LOGGER.log(logging.WARNING if code else logging.INFO, json.dumps(payload))
    except Exception:
        pass  # Diagnostics must never change a classification or disclose exception text.
