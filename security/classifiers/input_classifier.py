"""Separate binary ML classifier; policy thresholds remain organizer-controlled."""

from security.classifiers.model_loader import ModelRunner, get_model_runner
from security.config import ClassifierConfig
from security.types import InputClassification, SecurityError


class MLInputClassifier:
    def __init__(self, config: ClassifierConfig, runner: ModelRunner | None = None):
        self.config = config
        self._runner = runner

    async def classify_input(self, message: str, challenge_id: int) -> InputClassification:
        if type(challenge_id) is not int or challenge_id not in (7, 8):
            raise SecurityError("configuration_unavailable")
        if not isinstance(message, str) or not message.strip() or len(message) > 16000:
            raise SecurityError("invalid_input")
        runner = self._runner or get_model_runner(self.config)
        score = await runner.score(
            message, max_tokens=self.config.max_tokens, timeout=self.config.timeout_seconds
        )
        return InputClassification(score=score, is_injection=score >= 0.5)
