"""Lazy, process-cached CPU models with one bounded worker per model revision.

A timeout bounds the caller's wait, not native torch execution. A timed-out worker
retains its slot until completion; later callers fail closed instead of queuing.
"""

import asyncio
import os
import threading
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from security.config import ClassifierConfig, valid_score
from security.types import SecurityError


class HFEngine:
    def __init__(self, config: ClassifierConfig):
        # Optional ML dependencies are imported only when real inference is requested.
        import torch
        from transformers import AutoModelForSequenceClassification, AutoTokenizer

        self.torch = torch
        cache = os.environ.get("CRYPTUM_MODEL_CACHE")
        if cache is not None and not cache.strip():
            raise SecurityError("classifier_unavailable")
        cache_options = {"cache_dir": str(Path(cache).expanduser())} if cache is not None else {}
        self.tokenizer = AutoTokenizer.from_pretrained(
            config.model_id, revision=config.revision, trust_remote_code=False, **cache_options
        )
        self.model = AutoModelForSequenceClassification.from_pretrained(
            config.model_id,
            revision=config.revision,
            trust_remote_code=False,
            use_safetensors=True,
            **cache_options,
        ).to("cpu")
        self.model.eval()
        self.labels = {str(v).lower(): int(k) for k, v in self.model.config.id2label.items()}

    def score(self, text: str, hypotheses: tuple[str, ...], max_tokens: int) -> float:
        target = "entailment" if hypotheses else "injection"
        expected = (
            {"contradiction", "entailment", "neutral"} if hypotheses else {"safe", "injection"}
        )
        if set(self.labels) != expected:
            raise SecurityError("invalid_model_labels")
        hypotheses_or_empty = hypotheses or ("",)
        tokens = self.tokenizer.encode(text, add_special_tokens=False)
        scores = []
        for hypothesis in hypotheses_or_empty:
            hypothesis_tokens = self.tokenizer.encode(hypothesis, add_special_tokens=False)
            overhead = self.tokenizer.num_special_tokens_to_add(pair=bool(hypotheses))
            window = max_tokens - len(hypothesis_tokens) - overhead
            if window < 32:
                raise SecurityError("invalid_classifier_context")
            # Overlap catches boundary attacks; every token is scanned, including the tail.
            step = max(1, window - min(64, window // 2))
            for offset in range(0, len(tokens), step):
                chunk = tokens[offset : offset + window]
                inputs = self.tokenizer.prepare_for_model(
                    chunk,
                    pair_ids=hypothesis_tokens if hypotheses else None,
                    return_tensors="pt",
                    return_attention_mask=True,
                    truncation=False,
                )
                # prepare_for_model returns unbatched tensors on some tokenizer versions.
                inputs = {key: value.reshape(1, -1) for key, value in inputs.items()}
                with self.torch.inference_mode():
                    logits = self.model(**inputs).logits
                    values = self.torch.softmax(logits, dim=-1)
                if tuple(values.shape) != (1, len(expected)):
                    raise SecurityError("invalid_model_response")
                scores.append(float(values[0, self.labels[target]].item()))
                if offset + window >= len(tokens):
                    break
        if not scores or not all(valid_score(score) for score in scores):
            raise SecurityError("invalid_model_response")
        return max(scores)


class ModelRunner:
    def __init__(self, config: ClassifierConfig, factory: Callable = HFEngine):
        self.config = config
        self.factory = factory
        self.engine = None
        self._state = "cold"
        self._state_lock = threading.Lock()
        self._closed = False
        self._slot = threading.BoundedSemaphore(1)
        self._executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="cryptum-classifier")

    def _score(self, text: str, hypotheses: tuple[str, ...], max_tokens: int) -> float:
        try:
            if self.engine is None:
                with self._state_lock:
                    self._state = "loading"
                self.engine = self.factory(self.config)
            value = self.engine.score(text, hypotheses, max_tokens)
            if not valid_score(value):
                raise SecurityError("invalid_model_response")
            with self._state_lock:
                self._state = "ready"
            return value
        except Exception:
            with self._state_lock:
                self._state = "error"
            raise

    @property
    def state(self) -> str:
        """Fixed operator metadata, never exception strings or model content."""
        with self._state_lock:
            return "closed" if self._closed else self._state

    async def score(
        self,
        text: str,
        *,
        hypotheses: tuple[str, ...] = (),
        max_tokens: int = 512,
        timeout: float = 30,
    ) -> float:
        if self.state == "closed":
            raise SecurityError("classifier_unavailable")
        if not self._slot.acquire(blocking=False):
            raise SecurityError("classifier_busy")
        try:
            future = self._executor.submit(self._score, text, hypotheses, max_tokens)
        except Exception:
            self._slot.release()
            raise SecurityError("classifier_unavailable") from None
        future.add_done_callback(lambda _: self._slot.release())
        try:
            # Shield keeps the slot occupied if the native worker outlives the request.
            wrapped = asyncio.wrap_future(future)
            wrapped.add_done_callback(lambda done: None if done.cancelled() else done.exception())
            result = await asyncio.wait_for(asyncio.shield(wrapped), timeout)
            if not valid_score(result):
                raise SecurityError("invalid_model_response")
            return float(result)
        except TimeoutError:
            raise SecurityError("classifier_timeout") from None
        except SecurityError:
            raise
        except Exception:
            raise SecurityError("classifier_unavailable") from None

    def close(self):
        with self._state_lock:
            self._closed = True
        self._executor.shutdown(wait=True, cancel_futures=True)
        # Workers have finished: release references to model/activation memory.
        self.engine = None


_cache: dict[tuple[str, str], ModelRunner] = {}
_cache_lock = threading.Lock()
_threads_configured = False


def configure_cpu_threads() -> None:
    """Set the process-wide torch pool once, before classifiers begin serving."""
    global _threads_configured
    with _cache_lock:
        if not _threads_configured:
            try:
                import torch

                threads = int(os.environ.get("CRYPTUM_CLASSIFIER_THREADS", "2"))
                if not 1 <= threads <= 32:
                    raise ValueError("Invalid thread count")
                torch.set_num_threads(threads)
            except Exception:
                raise SecurityError("classifier_unavailable") from None
            _threads_configured = True


def get_model_runner(config: ClassifierConfig) -> ModelRunner:
    configure_cpu_threads()
    with _cache_lock:
        key = (config.model_id, config.revision)
        if key not in _cache or _cache[key].state == "closed":
            _cache[key] = ModelRunner(config)
        return _cache[key]
