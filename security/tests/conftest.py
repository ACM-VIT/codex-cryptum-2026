import pytest

from security import ContextAuthority, FlagService, PolicyEngine, SecurityPipeline, load_config
from security.config import ChallengeConfig
from security.types import InferenceResponse, InputClassification, OutputClassification

DEV_LEVEL7 = "cdx{7h3_cl4ss1f13r_w4s_f00l3d}"
DEV_LEVEL8 = "cdx{d0ubl3_gu4rdr41l_br34ch_8x92}"


class StubInput:
    def __init__(self, score=0.1, error=None):
        self.score = score
        self.error = error
        self.calls = []

    async def classify_input(self, message, challenge_id):
        self.calls.append((message, challenge_id))
        if self.error:
            raise self.error
        return InputClassification(self.score, self.score >= 0.5)


class StubOutput:
    def __init__(self, score=0.1, match=False, error=None):
        self.score = score
        self.match = match
        self.error = error
        self.calls = []

    async def classify_output(self, response, context):
        self.calls.append((response, context))
        if self.error:
            raise self.error
        return OutputClassification(self.score, self.score >= 0.5 or self.match, self.match)


class StubInference:
    def __init__(self, content="Neural networks learn patterns from examples.", error=None):
        self.content = content
        self.error = error
        self.calls = []

    async def generate(self, messages, config):
        self.calls.append((messages, config))
        if self.error:
            raise self.error
        return InferenceResponse(self.content)


def configured(level, **changes):
    data = load_config(level).model_dump()
    for key, value in changes.items():
        if key in ("input_classifier", "output_classifier"):
            data["security"][key].update(value)
        else:
            data[key] = value
    return ChallengeConfig.model_validate(data)


@pytest.fixture
def authority():
    return ContextAuthority(FlagService(b"test-master-key-" * 3), DEV_LEVEL7)


@pytest.fixture
def harness(authority):
    events = []
    input_model, output_model, inference = StubInput(), StubOutput(), StubInference()
    pipeline = SecurityPipeline(
        authority,
        PolicyEngine({7: load_config(7), 8: load_config(8)}),
        input_classifiers={7: input_model, 8: input_model},
        output_classifiers={8: output_model},
        event_sink=events.append,
    )
    return pipeline, input_model, output_model, inference, events
