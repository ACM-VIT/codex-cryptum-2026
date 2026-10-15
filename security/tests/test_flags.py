import pytest

from security import FlagService, derive_team_flag, validate_team_flag
from security.flags.flag_generator import valid_flag
from security.types import SecurityError


def test_unique_stable_team_flags(authority):
    service = authority.flag_service
    flags = [service.derive_team_flag(f"team-{i}", 8) for i in range(1000)]
    assert len(set(flags)) == 1000
    assert all(valid_flag(flag) and len(flag) == 69 for flag in flags)
    assert service.derive_team_flag("team-0", 8) == flags[0]


def test_correct_and_cross_team_validation(authority):
    service = authority.flag_service
    flag = service.derive_team_flag("team-a", 8)
    assert service.validate_team_flag("team-a", 8, flag)
    assert not service.validate_team_flag("team-b", 8, flag)


@pytest.mark.parametrize(
    "submitted", [None, {}, "", "CDX{abc}", "cdx{abc}\n", "cdx{é}", "x" * 10000]
)
def test_invalid_submissions(authority, submitted):
    assert not authority.flag_service.validate_team_flag("a", 8, submitted)


@pytest.mark.parametrize("team", [None, "", " ../b", "b\n", "a" * 129, {}])
def test_invalid_identity(authority, team):
    with pytest.raises(SecurityError, match="invalid_team_identity"):
        authority.flag_service.derive_team_flag(team, 8)


@pytest.mark.parametrize("level", [7, 9, True, "8"])
def test_no_confusion_with_other_challenges(authority, level):
    with pytest.raises(SecurityError, match="unsupported_flag_challenge"):
        authority.flag_service.derive_team_flag("a", level)


def test_domain_separation_and_rotation(authority):
    secret = authority.flag_service.master_secret
    a = FlagService(secret, "epoch-1").derive_team_flag("team:a", 8)
    b = FlagService(secret, "epoch-2").derive_team_flag("team:a", 8)
    c = FlagService(b"different-secret" * 3, "epoch-1").derive_team_flag("team:a", 8)
    assert len({a, b, c}) == 3


def test_missing_secret_and_environment_helpers(monkeypatch):
    monkeypatch.delenv("CRYPTUM_FLAG_MASTER_SECRET_HEX", raising=False)
    with pytest.raises(SecurityError, match="missing_master_secret"):
        derive_team_flag("a", 8)
    monkeypatch.setenv("CRYPTUM_FLAG_MASTER_SECRET_HEX", (b"test-key" * 4).hex())
    assert validate_team_flag("a", 8, derive_team_flag("a", 8))


@pytest.mark.parametrize("secret", [b"", b"short", "a" * 40])
def test_insufficient_master_secret(secret):
    with pytest.raises(SecurityError, match="invalid_master_secret"):
        FlagService(secret)
