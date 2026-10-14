import pytest
from pydantic import ValidationError

from security import PolicyEngine, load_config
from security.tests.conftest import configured
from security.types import SecurityError


@pytest.mark.parametrize(
    "field,value",
    [
        ("max_input_chars", 0),
        ("max_generation_tokens", 0),
        ("context_window", 4096),
        ("temperature", float("nan")),
        ("thinking_visibility", "visible"),
        ("allowed_roles", ("system", "assistant", "user")),
        ("prompt_template", "participant_template"),
    ],
)
def test_invalid_model_security_configuration(field, value):
    with pytest.raises(ValidationError):
        configured(7, **{field: value})


def test_required_output_cannot_be_disabled():
    with pytest.raises(ValidationError):
        configured(8, output_classifier={"enabled": False})


def test_impossible_hypothesis_budget_rejected():
    with pytest.raises(ValidationError):
        configured(8, output_classifier={"max_tokens": 64})


def test_bypassed_config_constructor_revalidated():
    data = load_config(8).model_dump()
    data["temperature"] = float("nan")
    bad = load_config(8).model_copy(update={"temperature": data["temperature"]})
    with pytest.raises(SecurityError, match="invalid_configuration"):
        PolicyEngine({8: bad})


def test_yaml_role_list_roundtrips(tmp_path):
    from importlib.resources import files

    import yaml

    data = yaml.safe_load(files("security.config").joinpath("level7.yaml").read_text())
    data["allowed_roles"] = ["system", "user"]
    path = tmp_path / "roles.yaml"
    path.write_text(yaml.safe_dump(data))
    assert load_config(7, path).allowed_roles == ("system", "user")


@pytest.mark.parametrize("security", [{"input_classifier": 1}, {"input_classifier": [1]}, None])
def test_malformed_classifier_config_sanitized(tmp_path, security):
    import yaml

    path = tmp_path / "bad.yaml"
    path.write_text(yaml.safe_dump({"security": security}))
    with pytest.raises(SecurityError, match="invalid_configuration"):
        load_config(7, path)


@pytest.mark.parametrize("challenge_id", [7.0, 8.0, True, "7"])
def test_configuration_rejects_non_integer_challenge_ids(tmp_path, challenge_id):
    from importlib.resources import files

    import yaml

    data = yaml.safe_load(files("security.config").joinpath("level7.yaml").read_text())
    data["challenge_id"] = challenge_id
    path = tmp_path / "noninteger.yaml"
    path.write_text(yaml.safe_dump(data))
    with pytest.raises(SecurityError, match="invalid_configuration"):
        load_config(7, path)
