"""Environment-backed convenience API; dependency injection is preferred in servers."""

from security.flags.flag_generator import FlagService


def derive_team_flag(authenticated_team_id: str, challenge_id: int) -> str:
    return FlagService.from_environment().derive_team_flag(authenticated_team_id, challenge_id)


def validate_team_flag(authenticated_team_id: str, challenge_id: int, submitted_flag: str) -> bool:
    return FlagService.from_environment().validate_team_flag(
        authenticated_team_id, challenge_id, submitted_flag
    )
