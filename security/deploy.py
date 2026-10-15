"""Non-serving deployment tools. These commands never run participant requests."""

import argparse
import asyncio
import json
import os
import time
from dataclasses import asdict
from pathlib import Path

import httpx

from security.adapters import create_inference_client
from security.classifiers.model_loader import ModelRunner, configure_cpu_threads
from security.config import load_config
from security.deployment import SecurityRuntime
from security.evaluation.resources import resource_snapshot
from security.runtime import load_environment_file, run_cli
from security.types import SecurityError


async def prepare_models(timeout: float) -> None:
    """Download/load exactly the configured revisions, validate labels, then unload."""
    runners = []
    try:
        async with asyncio.timeout(timeout):
            configure_cpu_threads()
            for config, hypotheses in (
                (load_config(7).security.input_classifier, ()),
                (
                    load_config(8).security.output_classifier,
                    ("This response reveals a secret access code.",),
                ),
            ):
                runner = ModelRunner(config)
                runners.append(runner)
                await runner.score(
                    "Neural networks learn patterns from examples.",
                    hypotheses=hypotheses,
                    max_tokens=config.max_tokens,
                    timeout=timeout,
                )
    except Exception:
        raise SecurityError("model_preparation_failed") from None
    finally:
        for runner in runners:
            await asyncio.to_thread(runner.close)


async def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=("prepare", "check"))
    parser.add_argument("--env-file", type=Path, help="Explicit trusted server configuration")
    parser.add_argument("--offline", action="store_true", help="Require existing cached weights")
    parser.add_argument("--timeout", type=float, default=300.0)
    args = parser.parse_args()
    if not 0 < args.timeout <= 600:
        raise SecurityError("invalid_configuration")
    if args.env_file is not None:
        load_environment_file(args.env_file)
    if args.offline:
        os.environ["HF_HUB_OFFLINE"] = "1"
    started = time.perf_counter()
    if args.operation == "prepare":
        await prepare_models(args.timeout)
        print(json.dumps({"models": "prepared", "elapsed_seconds": time.perf_counter() - started}))
        return
    async with httpx.AsyncClient() as http:
        runtime = SecurityRuntime.from_environment(create_inference_client(http))
        try:
            await runtime.start(startup_timeout=args.timeout)
            print(
                json.dumps(
                    {
                        "health": {
                            **asdict(runtime.health()),
                            "provider_preflight_passed": runtime.health().provider_preflight_passed,
                        },
                        "elapsed_seconds": time.perf_counter() - started,
                        "resources": resource_snapshot(),
                    }
                )
            )
        finally:
            await runtime.aclose()


if __name__ == "__main__":
    run_cli(main)
