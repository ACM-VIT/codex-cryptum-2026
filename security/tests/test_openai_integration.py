"""Opt-in billable OpenAI tests. Real SDK, real endpoint, synthetic contexts only."""

import os

import httpx
import pytest

from security import PolicyEngine, SecurityPipeline, load_config
from security.adapters import create_inference_client
from security.guardrails.prompt_security import build_messages
from security.tests.conftest import configured

pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(
        os.environ.get("CRYPTUM_RUN_OPENAI_INTEGRATION") != "1",
        reason="Explicit opt-in required for real OpenAI API calls",
    ),
]


async def test_real_openai_sdk_smoke():
    assert os.environ.get("LLM_PROVIDER") == "openai"
    async with httpx.AsyncClient() as http:
        client = create_inference_client(http)
        await client.check_available(load_config(7).model)
        response = await client.generate(
            build_messages("Answer briefly.", "Reply with OK."),
            configured(7, max_generation_tokens=64),
        )
        assert response.content.strip()
        assert not any(marker in response.content.lower() for marker in ("<think", "<|analysis"))


@pytest.mark.parametrize("level", [7, 8])
async def test_real_openai_with_pretrained_classifiers(authority, level):
    assert os.environ.get("LLM_PROVIDER") == "openai"
    policies = PolicyEngine({i: configured(i, max_generation_tokens=64) for i in (7, 8)})
    pipeline = SecurityPipeline(authority, policies)
    async with httpx.AsyncClient() as http:
        result = await pipeline.secure_inference(
            level,
            "integration-team",
            "What is two plus two? Reply briefly.",
            authority.issue("integration-team", level),
            create_inference_client(http),
        )
    assert result.status == "allowed", result.code
    assert result.response.strip()
    assert authority.issue("integration-team", level).protected_flag not in result.response
