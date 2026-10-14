import asyncio
import threading

import pytest

from security import load_config
from security.classifiers import MLInputClassifier
from security.classifiers.model_loader import HFEngine, ModelRunner
from security.types import SecurityError


@pytest.mark.parametrize("text", ["", " ", None, 42, "x" * 16001])
async def test_direct_classifier_invalid_input(text):
    classifier = MLInputClassifier(load_config(7).security.input_classifier)
    with pytest.raises(SecurityError, match="invalid_input"):
        await classifier.classify_input(text, 7)


@pytest.mark.parametrize("value", [float("nan"), 2.0, None])
async def test_invalid_runner_response(value):
    class Engine:
        def __init__(self, config):
            pass

        def score(self, text, hypotheses, max_tokens):
            return value

    runner = ModelRunner(load_config(7).security.input_classifier, Engine)
    try:
        with pytest.raises(SecurityError, match="invalid_model_response"):
            await runner.score("hello")
    finally:
        runner.close()


async def test_concurrent_call_rejected_without_queue():
    ready, release = threading.Event(), threading.Event()

    class Engine:
        def __init__(self, config):
            pass

        def score(self, text, hypotheses, max_tokens):
            ready.set()
            release.wait(5)
            return 0.1

    runner = ModelRunner(load_config(7).security.input_classifier, Engine)
    first = asyncio.create_task(runner.score("first"))
    try:
        assert await asyncio.to_thread(ready.wait, 1)
        with pytest.raises(SecurityError, match="classifier_busy"):
            await runner.score("second")
    finally:
        release.set()
        assert await first == 0.1
        runner.close()


def test_token_windows_cover_tail_without_truncation():
    """Tiny stand-ins test window coverage; no torch or model weights required."""
    from contextlib import nullcontext
    from types import SimpleNamespace

    seen = []

    class Tensor:
        def __init__(self, tokens):
            self.tokens = tokens

        def reshape(self, *args):
            return self

    class Values:
        shape = (1, 2)

        def __getitem__(self, index):
            return SimpleNamespace(item=lambda: 0.9 if 999 in seen[-1] else 0.1)

    class Tokenizer:
        def encode(self, text, add_special_tokens):
            assert add_special_tokens is False
            return list(range(1000)) if text else []

        def num_special_tokens_to_add(self, pair):
            return 2

        def prepare_for_model(self, chunk, **kwargs):
            assert kwargs["truncation"] is False
            seen.append(chunk)
            return {"input_ids": Tensor(chunk)}

    engine = HFEngine.__new__(HFEngine)
    engine.tokenizer = Tokenizer()
    engine.labels = {"safe": 0, "injection": 1}
    engine.torch = SimpleNamespace(inference_mode=nullcontext, softmax=lambda *a, **k: Values())
    engine.model = lambda **kwargs: SimpleNamespace(logits=None)
    assert engine.score("long text", (), 128) == 0.9
    assert set().union(*[set(chunk) for chunk in seen]) == set(range(1000))
    assert max(map(len, seen)) <= 126


def test_unrecognized_model_labels_rejected():
    engine = HFEngine.__new__(HFEngine)
    engine.labels = {"label_0": 0, "label_1": 1}
    with pytest.raises(SecurityError, match="invalid_model_labels"):
        engine.score("text", (), 512)


def test_process_cache_shares_input_weights_between_levels(monkeypatch):
    import sys
    from types import SimpleNamespace

    from security.classifiers import model_loader

    calls = []
    monkeypatch.delenv("CRYPTUM_CLASSIFIER_THREADS", raising=False)
    monkeypatch.setitem(sys.modules, "torch", SimpleNamespace(set_num_threads=calls.append))
    monkeypatch.setattr(model_loader, "_cache", {})
    monkeypatch.setattr(model_loader, "_threads_configured", False)
    first = model_loader.get_model_runner(load_config(7).security.input_classifier)
    second = model_loader.get_model_runner(load_config(8).security.input_classifier)
    assert first is second and calls == [2]
    first.close()


@pytest.mark.parametrize("level", [7.0, 8.0, True, "7"])
async def test_standalone_classifier_rejects_non_integer_challenge(level):
    classifier = MLInputClassifier(load_config(7).security.input_classifier)
    with pytest.raises(SecurityError, match="configuration_unavailable"):
        await classifier.classify_input("Ordinary fixture", level)
