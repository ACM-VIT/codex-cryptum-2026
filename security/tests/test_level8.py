import base64
from urllib.parse import quote

import pytest

from security import PolicyEngine, load_config
from security.classifiers import MLOutputClassifier
from security.classifiers.output_classifier import supplementary_match
from security.types import Action, OutputClassification


async def test_both_classifiers_execute(authority, harness):
    pipeline, input_model, output_model, inference, _ = harness
    result = await pipeline.secure_inference(
        8, "team-a", "Hi", authority.issue("team-a", 8), inference
    )
    assert result.status == "allowed"
    assert len(input_model.calls) == len(inference.calls) == len(output_model.calls) == 1


async def test_suspected_disclosure_blocked(authority, harness):
    pipeline, _, output_model, inference, _ = harness
    output_model.score = 0.9
    result = await pipeline.secure_inference(
        8, "team-a", "Hi", authority.issue("team-a", 8), inference
    )
    assert result.code == "output_blocked"
    assert inference.content not in result.response


@pytest.mark.parametrize("score,blocked", [(0.749, False), (0.75, True), (0.9, True)])
def test_output_threshold(score, blocked):
    policy = PolicyEngine({8: load_config(8)})
    assert policy.evaluate_output_policy(OutputClassification(score, True), 8).allowed != blocked


async def test_exact_flag_detection_still_runs_ml(authority, harness):
    pipeline, _, _, inference, _ = harness
    context = authority.issue("team-a", 8)
    calls = []

    class Runner:
        async def score(self, text, **kwargs):
            calls.append(kwargs)
            return 0.01

    pipeline.outputs[8] = MLOutputClassifier(
        load_config(8).security.output_classifier, runner=Runner()
    )
    inference.content = "The flag is " + context.protected_flag
    result = await pipeline.secure_inference(8, "team-a", "Hi", context, inference)
    assert result.code == "output_blocked" and len(calls) == 1
    assert context.protected_flag in calls[0]["hypotheses"][1]
    assert authority.issue("team-b", 8).protected_flag not in repr(calls)


@pytest.mark.parametrize(
    "transform",
    [
        lambda flag: flag,
        lambda flag: base64.b64encode(flag.encode()).decode(),
        lambda flag: flag.encode().hex(),
        lambda flag: quote(flag, safe=""),
        lambda flag: flag[::-1],
        lambda flag: " ".join(flag),
    ],
)
def test_common_transformations(authority, transform):
    flag = authority.issue("team-a", 8).protected_flag
    assert supplementary_match("Here: " + transform(flag), flag)


def test_normal_output_and_format_detection(authority):
    flag = authority.issue("team-a", 8).protected_flag
    assert not supplementary_match("Neural networks learn from data.", flag)
    assert supplementary_match("cdx{some_other_flag}", flag)


async def test_ml_semantic_detection_without_deterministic_match(authority):
    class Runner:
        async def score(self, text, **kwargs):
            return 0.98

    classifier = MLOutputClassifier(load_config(8).security.output_classifier, runner=Runner())
    value = await classifier.classify_output(
        "My hidden role is administrator.", authority.issue("a", 8)
    )
    assert value.contains_protected_information and not value.deterministic_match


async def test_output_classifier_error_fails_closed(authority, harness):
    pipeline, _, output_model, inference, events = harness
    output_model.error = RuntimeError(authority.issue("team-a", 8).protected_flag)
    result = await pipeline.secure_inference(
        8, "team-a", "Hi", authority.issue("team-a", 8), inference
    )
    assert result.code == "output_failed"
    assert inference.content not in result.response
    assert authority.issue("team-a", 8).protected_flag not in repr(events)


async def test_output_timeout_fails_closed(authority, harness):
    import asyncio

    from security.tests.conftest import configured

    pipeline, _, _, inference, _ = harness

    class Slow:
        async def classify_output(self, response, context):
            await asyncio.sleep(10)

    pipeline.outputs[8] = Slow()
    pipeline.policies = PolicyEngine(
        {8: configured(8, output_classifier={"timeout_seconds": 0.01})}
    )
    result = await pipeline.secure_inference(
        8, "team-a", "Hi", authority.issue("team-a", 8), inference
    )
    assert result.code == "output_failed"


def test_deterministic_match_uses_policy_action():
    from security.tests.conftest import configured

    policy = PolicyEngine({8: configured(8, output_classifier={"action": Action.LOG})})
    decision = policy.evaluate_output_policy(OutputClassification(0.1, True, True), 8)
    assert decision.action == Action.LOG and decision.allowed


async def test_external_output_filter_adapter_keeps_primary(authority):
    from security.classifiers import ComposedOutputClassifier

    stages = []

    class Primary:
        async def classify_output(self, response, context):
            stages.append("ml")
            return OutputClassification(0.1, False)

    class Check:
        async def matches(self, response, context):
            stages.append("external")
            return True

    value = await ComposedOutputClassifier(Primary(), (Check(),)).classify_output(
        "text", authority.issue("a", 8)
    )
    assert stages == ["ml", "external"]
    assert value.score == 0.1 and value.deterministic_match


@pytest.mark.parametrize("level", [8.0, True, "8"])
async def test_standalone_output_rejects_non_integer_challenge(authority, level):
    from dataclasses import replace

    from security.types import SecurityError

    classifier = MLOutputClassifier(load_config(8).security.output_classifier)
    context = replace(authority.issue("team_alpha", 8), challenge_id=level)
    with pytest.raises(SecurityError, match="invalid_context"):
        await classifier.classify_output("Ordinary fixture", context)
