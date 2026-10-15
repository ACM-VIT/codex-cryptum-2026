"""Trusted provider settings, independent of classifier and challenge policy."""

import math
import os
import re
from dataclasses import dataclass, field
from typing import Literal

import httpx

from security.types import SecurityError


def provider_name() -> Literal["ollama", "openai"]:
    value = os.environ.get("LLM_PROVIDER", "ollama")
    if value not in ("ollama", "openai"):
        raise SecurityError("invalid_llm_provider")
    return value


def selected_model(default: str) -> str:
    if provider_name() == "openai":
        value = os.environ.get("OPENAI_MODEL", "")
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}", value):
            raise SecurityError("invalid_openai_model")
        return value
    return os.environ.get("OLLAMA_MODEL", default)


@dataclass(frozen=True)
class OpenAISettings:
    """Never include keys or endpoints in repr, errors, or participant results."""

    model: str
    api_key: str = field(repr=False)
    base_url: str = field(default="https://api.openai.com/v1", repr=False)
    timeout_seconds: float = 60.0
    max_retries: int = 1
    token_parameter: str = "max_completion_tokens"
    reasoning_effort: str | None = None

    def __post_init__(self):
        if not isinstance(self.api_key, str) or not self.api_key.strip():
            raise SecurityError("missing_openai_api_key")
        if self.api_key != self.api_key.strip() or any(c.isspace() for c in self.api_key):
            raise SecurityError("invalid_openai_api_key")
        if not isinstance(self.model, str) or not re.fullmatch(
            r"[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}", self.model
        ):
            raise SecurityError("invalid_openai_model")
        try:
            url = httpx.URL(self.base_url)
            if (
                url.scheme not in ("http", "https")
                or not url.host
                or url.username
                or url.password
                or url.query
                or url.fragment
                or (url.scheme == "http" and url.host not in ("localhost", "127.0.0.1", "::1"))
            ):
                raise ValueError
        except (ValueError, TypeError, httpx.InvalidURL):
            raise SecurityError("invalid_openai_base_url") from None
        if (
            type(self.timeout_seconds) not in (int, float)
            or not math.isfinite(self.timeout_seconds)
            or not 0 < self.timeout_seconds <= 600
            or type(self.max_retries) is not int
            or not 0 <= self.max_retries <= 2
            or self.token_parameter not in ("max_completion_tokens", "max_tokens")
            or self.reasoning_effort
            not in (None, "none", "minimal", "low", "medium", "high", "xhigh")
        ):
            raise SecurityError("invalid_openai_configuration")

    @classmethod
    def from_environment(cls):
        try:
            return cls(
                model=os.environ.get("OPENAI_MODEL", ""),
                api_key=os.environ.get("OPENAI_API_KEY", ""),
                base_url=os.environ.get("OPENAI_BASE_URL") or "https://api.openai.com/v1",
                timeout_seconds=float(os.environ.get("OPENAI_TIMEOUT_SECONDS", "60")),
                max_retries=int(os.environ.get("OPENAI_MAX_RETRIES", "1")),
                token_parameter=os.environ.get("OPENAI_TOKEN_PARAMETER", "max_completion_tokens"),
                reasoning_effort=os.environ.get("OPENAI_REASONING_EFFORT") or None,
            )
        except (ValueError, TypeError):
            raise SecurityError("invalid_openai_configuration") from None
