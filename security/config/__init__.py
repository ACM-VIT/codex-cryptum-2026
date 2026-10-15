"""Validated organizer configuration, never participant-supplied configuration."""

import math
import re
from importlib.resources import files
from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from security.config.providers import selected_model
from security.types import Action, SecurityError

INPUT_MODEL = "protectai/deberta-v3-base-prompt-injection-v2"
INPUT_REVISION = "90c9989b1a342275dd0d1a95aad283c04e075671"
OUTPUT_MODEL = "cross-encoder/nli-MiniLM2-L6-H768"
OUTPUT_REVISION = "b95119ce93d3e065de6214e38cd4a97b0f2f2c6d"


class StrictConfig(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)


class ClassifierConfig(StrictConfig):
    enabled: bool = True
    action: Action = Action.BLOCK
    threshold: float = Field(default=0.75, ge=0, le=1, allow_inf_nan=False)
    timeout_seconds: float = Field(default=30.0, gt=0, le=300, allow_inf_nan=False)
    max_tokens: int = Field(default=512, ge=64, le=512)
    model_id: str = Field(min_length=1, max_length=256)
    revision: str = Field(pattern=r"^[0-9a-f]{40}$")
    event_logging: bool = True


class SecurityConfig(StrictConfig):
    input_classifier: ClassifierConfig
    output_classifier: ClassifierConfig
    system_prompt_protection: Literal[True] = True
    team_specific_flags: bool
    deterministic_checks: bool = True
    failure_action: Literal["block"] = "block"


class ChallengeConfig(StrictConfig):
    challenge_id: Literal[7, 8]
    model: str = Field(default="qwen3:8b", pattern=r"^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$")
    prompt_template: Literal["vault_v1"] = "vault_v1"
    max_input_chars: int = Field(default=6000, ge=1, le=16000)
    max_output_chars: int = Field(default=16000, ge=1, le=64000)
    max_generation_tokens: int = Field(default=512, ge=1, le=4096)
    context_window: int = Field(default=8192, ge=4096, le=32768)
    temperature: float = Field(default=0.3, ge=0, le=2, allow_inf_nan=False)
    inference_timeout_seconds: float = Field(default=120.0, gt=0, le=600, allow_inf_nan=False)
    thinking_visibility: Literal["hidden"] = "hidden"
    allowed_roles: tuple[Literal["system", "user"], ...] = ("system", "user")
    security: SecurityConfig

    @model_validator(mode="before")
    @classmethod
    def strict_challenge_id(cls, data):
        # Pydantic Literal validation otherwise coerces 7.0/8.0 to integer literals.
        if isinstance(data, dict) and type(data.get("challenge_id")) is not int:
            raise ValueError("Challenge ID must be an integer")
        return data

    @model_validator(mode="after")
    def consistent(self):
        policy = self.security
        if not policy.input_classifier.enabled:
            raise ValueError("Input screening is required")
        if self.allowed_roles != ("system", "user"):
            raise ValueError("Only system followed by user is supported")
        if self.challenge_id == 7 and (
            policy.team_specific_flags or policy.output_classifier.enabled
        ):
            raise ValueError("Level 7 uses input screening and a configured flag")
        if self.challenge_id == 8 and not (
            policy.team_specific_flags and policy.output_classifier.enabled
        ):
            raise ValueError("Level 8 requires both classifiers and team flags")
        if policy.output_classifier.enabled and policy.output_classifier.max_tokens < 128:
            raise ValueError("Output classifier needs room for its trusted hypothesis")
        if self.context_window < self.max_input_chars + self.max_generation_tokens + 1024:
            raise ValueError("Insufficient context budget for worst-case input and system prompt")
        return self


def load_config(
    challenge_id: int, path: Path | None = None, *, resolve_inference_model: bool = True
) -> ChallengeConfig:
    if type(challenge_id) is not int or challenge_id not in (7, 8):
        raise SecurityError("configuration_unavailable")
    source = path or files(__package__).joinpath(f"level{challenge_id}.yaml")
    try:
        data = yaml.safe_load(source.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            raise ValueError("Expected configuration mapping")
        # Explicit conversion only for enum values written as YAML strings.
        for stage in ("input_classifier", "output_classifier"):
            rule = data["security"][stage]
            if "action" in rule:
                rule["action"] = Action(rule["action"])
        if "allowed_roles" in data:
            data["allowed_roles"] = tuple(data["allowed_roles"])
        if resolve_inference_model:
            data["model"] = selected_model(data.get("model", "qwen3:8b"))
        config = ChallengeConfig.model_validate(data)
        if config.challenge_id != challenge_id:
            raise ValueError("Mismatched challenge")
        return config
    except (
        OSError,
        ValueError,
        TypeError,
        KeyError,
        AttributeError,
        yaml.YAMLError,
        ValidationError,
    ):
        raise SecurityError("invalid_configuration") from None


def valid_score(score: object) -> bool:
    return type(score) in (float, int) and math.isfinite(score) and 0 <= score <= 1


def valid_team_id(team_id: object) -> bool:
    return (
        isinstance(team_id, str)
        and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.:@-]{0,127}", team_id) is not None
    )
