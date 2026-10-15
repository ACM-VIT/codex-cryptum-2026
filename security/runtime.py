"""Trusted startup helpers. No shell execution, automatic .env discovery, or secrets in output."""

import asyncio
import io
import os
import sys
from pathlib import Path

from dotenv.parser import parse_stream

from security.types import SecurityError

ENVIRONMENT_KEYS = frozenset(
    {
        "CRYPTUM_CLASSIFIER_URL",
        "CRYPTUM_CLASSIFIER_TOKEN",
        "LLM_PROVIDER",
        "OPENAI_API_KEY",
        "OPENAI_MODEL",
        "OPENAI_BASE_URL",
        "OPENAI_TIMEOUT_SECONDS",
        "OPENAI_MAX_RETRIES",
        "OPENAI_TOKEN_PARAMETER",
        "OPENAI_REASONING_EFFORT",
        "OLLAMA_URL",
        "OLLAMA_MODEL",
        "HF_HOME",
        "HF_HUB_OFFLINE",
        "CRYPTUM_MODEL_CACHE",
        "CRYPTUM_CLASSIFIER_THREADS",
        "CRYPTUM_LEVEL7_FLAG",
        "CRYPTUM_FLAG_MASTER_SECRET_HEX",
        "CRYPTUM_FLAG_ROTATION",
    }
)


def load_environment_file(path: Path) -> None:
    """Explicit trusted file only. Existing process variables take precedence.

    Parse fully before modifying the process; disable variable interpolation and
    reject unsupported keys or malformed entries without logging their contents.
    """
    try:
        content = Path(path).expanduser().read_text(encoding="utf-8")
        parsed = {}
        for binding in parse_stream(io.StringIO(content)):
            if binding.error:
                raise ValueError("Malformed environment entry")
            if binding.key is None:
                continue
            if binding.key not in ENVIRONMENT_KEYS or binding.value is None:
                raise ValueError("Unsupported environment entry")
            parsed[binding.key] = binding.value
    except (OSError, ValueError, TypeError, RuntimeError):
        raise SecurityError("invalid_environment_file") from None
    for key, value in parsed.items():
        os.environ.setdefault(key, value)


def run_cli(main) -> None:
    """Uniform sanitized startup errors for the existing async CLIs."""
    try:
        asyncio.run(main())
    except SecurityError as error:
        print(f"Startup failed: {error.code}", file=sys.stderr)
        raise SystemExit(2) from None
