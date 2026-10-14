"""Public, immutable values. Secret-bearing objects intentionally suppress repr."""

from dataclasses import dataclass, field
from enum import StrEnum
from typing import Literal, Protocol


class Action(StrEnum):
    ALLOW = "allow"
    BLOCK = "block"
    LOG = "log"


class SecurityError(Exception):
    """Only stable public codes survive a boundary; never attach upstream messages."""

    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


@dataclass(frozen=True)
class InputClassification:
    score: float
    is_injection: bool
    category: Literal["prompt_injection"] = "prompt_injection"
    reason: str = "Binary prompt-injection model score (uncalibrated)"


@dataclass(frozen=True)
class OutputClassification:
    score: float
    contains_protected_information: bool
    deterministic_match: bool = False
    reason: str = "Zero-shot disclosure model score (uncalibrated)"


@dataclass(frozen=True)
class PolicyDecision:
    action: Action
    allowed: bool
    reason: str


@dataclass(frozen=True)
class TrustedSecurityContext:
    """Backend-only capability; mint through ContextAuthority, never deserialize from users."""

    authenticated_team_id: str = field(repr=False)
    challenge_id: int
    protected_flag: str = field(repr=False)
    binding: str = field(repr=False)


@dataclass(frozen=True)
class ModelMessage:
    role: Literal["system", "user"]
    content: str = field(repr=False)


@dataclass(frozen=True)
class InferenceResponse:
    content: str = field(repr=False)


@dataclass(frozen=True)
class SecurityResult:
    """Participant-safe result: no raw classification or protected context."""

    status: Literal["allowed", "blocked", "error"]
    response: str = field(repr=False)
    code: str


@dataclass(frozen=True)
class SecurityEvent:
    challenge_id: int
    stage: Literal["input", "output", "inference", "context", "request"]
    outcome: str
    elapsed_ms: float


class InputClassifier(Protocol):
    async def classify_input(self, message: str, challenge_id: int) -> InputClassification: ...


class OutputClassifier(Protocol):
    async def classify_output(
        self, response: str, context: TrustedSecurityContext
    ) -> OutputClassification: ...
