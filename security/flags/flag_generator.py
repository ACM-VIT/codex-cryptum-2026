"""Trusted internal HMAC derivation. There is intentionally no HTTP route."""

import hashlib
import hmac
import json
import os
import re
from dataclasses import dataclass, field

from security.config import valid_team_id
from security.types import SecurityError


def canonical_payload(*parts: object) -> bytes:
    return json.dumps(parts, ensure_ascii=True, separators=(",", ":")).encode("ascii")


def valid_flag(value: object) -> bool:
    return (
        isinstance(value, str) and re.fullmatch(r"cdx\{[A-Za-z0-9_-]{1,128}\}", value) is not None
    )


@dataclass(frozen=True)
class FlagService:
    master_secret: bytes = field(repr=False)
    rotation: str = "2026-event-v1"

    def __post_init__(self):
        if not isinstance(self.master_secret, bytes) or len(self.master_secret) < 32:
            raise SecurityError("invalid_master_secret")
        if not isinstance(self.rotation, str) or not 1 <= len(self.rotation) <= 128:
            raise SecurityError("invalid_rotation")

    @classmethod
    def from_environment(cls):
        try:
            secret = bytes.fromhex(os.environ["CRYPTUM_FLAG_MASTER_SECRET_HEX"])
        except (KeyError, ValueError):
            raise SecurityError("missing_master_secret") from None
        return cls(secret, os.environ.get("CRYPTUM_FLAG_ROTATION", "2026-event-v1"))

    def derive_team_flag(self, authenticated_team_id: str, challenge_id: int) -> str:
        if not valid_team_id(authenticated_team_id):
            raise SecurityError("invalid_team_identity")
        if type(challenge_id) is not int or challenge_id != 8:
            raise SecurityError("unsupported_flag_challenge")
        payload = canonical_payload(
            "cryptum/team-flag/v1", self.rotation, challenge_id, authenticated_team_id
        )
        digest = hmac.new(self.master_secret, payload, hashlib.sha256).hexdigest()
        return f"cdx{{{digest}}}"

    def validate_team_flag(
        self, authenticated_team_id: str, challenge_id: int, submitted_flag: str
    ) -> bool:
        expected = self.derive_team_flag(authenticated_team_id, challenge_id)
        if not valid_flag(submitted_flag):
            return False
        return hmac.compare_digest(expected.encode("ascii"), submitted_flag.encode("ascii"))
