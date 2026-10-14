"""Small hosting adapter only: no listener, authentication, or chat routes."""

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

    def __init__(self, client: httpx.AsyncClient, base_url: str = "http://127.0.0.1:11434"):
        self.client = client
        self.base_url = base_url.rstrip("/")

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
