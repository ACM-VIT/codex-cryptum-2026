"""Policy is distinct from binary model labels and never interprets attack categories."""

from security.config import ChallengeConfig, valid_score
from security.types import (
    Action,
    InputClassification,
    OutputClassification,
    PolicyDecision,
    SecurityError,
)


class PolicyEngine:
    def __init__(self, configs: dict[int, ChallengeConfig]):
        self._configs = {}
        try:
            for key, config in configs.items():
                # Revalidate even if a caller bypassed Pydantic's normal constructor.
                checked = ChallengeConfig.model_validate(config.model_dump())
                if type(key) is not int or key != checked.challenge_id:
                    raise ValueError("Mismatched configuration")
                self._configs[key] = checked
        except Exception:
            raise SecurityError("invalid_configuration") from None

    def config(self, challenge_id: int) -> ChallengeConfig:
        if type(challenge_id) is not int or challenge_id not in self._configs:
            raise SecurityError("configuration_unavailable")
        return self._configs[challenge_id]

    @property
    def challenge_ids(self) -> tuple[int, ...]:
        return tuple(self._configs)

    def evaluate_input_policy(
        self, classification: InputClassification, challenge_id: int
    ) -> PolicyDecision:
        rule = self.config(challenge_id).security.input_classifier
        if not isinstance(classification, InputClassification) or not valid_score(
            classification.score
        ):
            raise SecurityError("invalid_classification")
        suspicious = classification.score >= rule.threshold
        action = rule.action if suspicious else Action.ALLOW
        return PolicyDecision(action, action != Action.BLOCK, "input_policy")

    def evaluate_output_policy(
        self, classification: OutputClassification, challenge_id: int
    ) -> PolicyDecision:
        rule = self.config(challenge_id).security.output_classifier
        if (
            not rule.enabled
            or not isinstance(classification, OutputClassification)
            or not valid_score(classification.score)
            or type(classification.deterministic_match) is not bool
        ):
            raise SecurityError("invalid_classification")
        suspicious = classification.score >= rule.threshold or classification.deterministic_match
        action = rule.action if suspicious else Action.ALLOW
        return PolicyDecision(action, action != Action.BLOCK, "output_policy")
