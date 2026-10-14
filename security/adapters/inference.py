"""Small hosting adapter only: no listener, authentication, or chat routes."""

import os
from typing import Protocol

import httpx

from security.config import ChallengeConfig
from security.types import InferenceResponse, ModelMessage, SecurityError


class InferenceClient(Protocol):
    async def generate(
        self, messages: tuple[ModelMessage, ModelMessage], config: ChallengeConfig
    ) -> InferenceResponse: ...


class OllamaClient:
    """Reuse an application-owned AsyncClient; URL is trusted server configuration."""

    def __init__(self, client: httpx.AsyncClient, base_url: str | None = None):
        self.client = client
        try:
            url = httpx.URL(
                base_url
                if base_url is not None
                else os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434")
            )
            if (
                url.scheme not in ("http", "https")
                or not url.host
                or url.username
                or url.password
                or url.query
                or url.fragment
            ):
                raise ValueError("Invalid trusted endpoint")
            self.base_url = str(url).rstrip("/")
        except (ValueError, TypeError, httpx.InvalidURL):
            raise SecurityError("invalid_ollama_url") from None

    async def check_available(self, model: str) -> None:
        """Optional startup preflight. Never fetch weights or expose provider errors."""
        try:
            response = await self.client.get(f"{self.base_url}/api/tags", timeout=5)
            response.raise_for_status()
            data = response.json()["models"]
            if not isinstance(data, list) or not all(isinstance(item, dict) for item in data):
                raise ValueError("Invalid model list")
            names = {item.get("name", item.get("model")) for item in data}
            expected = model if ":" in model.rsplit("/", 1)[-1] else f"{model}:latest"
        except Exception:
            raise SecurityError("ollama_unavailable") from None
        if model not in names and expected not in names:
            raise SecurityError("ollama_model_unavailable")

    async def generate(
        self, messages: tuple[ModelMessage, ModelMessage], config: ChallengeConfig
    ) -> InferenceResponse:
        if tuple(message.role for message in messages) != config.allowed_roles:
            raise SecurityError("invalid_roles")
        try:
            response = await self.client.post(
                f"{self.base_url}/api/chat",
                json={
                    "model": config.model,
                    "messages": [{"role": m.role, "content": m.content} for m in messages],
                    "stream": False,
                    "think": False,
                    "options": {
                        "num_predict": config.max_generation_tokens,
                        "num_ctx": config.context_window,
                        "temperature": config.temperature,
                    },
                },
                timeout=config.inference_timeout_seconds,
            )
            response.raise_for_status()
            payload = response.json()
            message = payload["message"]
            if (
                payload.get("done") is not True
                or message.get("role") != "assistant"
                or message.get("tool_calls")
                or not isinstance(message.get("content"), str)
            ):
                raise ValueError("Malformed model response")
            # Deliberately discard thinking/reasoning and all provider metadata.
            return InferenceResponse(content=message["content"])
        except Exception:
            raise SecurityError("inference_failed") from None
