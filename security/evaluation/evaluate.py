"""Reproducible, offline-after-download classifier and optional attack evaluation."""

import argparse
import base64
import json
import math
import os
import platform
import statistics
import time
from datetime import UTC, datetime
from importlib.resources import files
from pathlib import Path
from urllib.parse import quote

import httpx

from security import ContextAuthority, FlagService, SecurityPipeline, load_config
from security.adapters import OllamaClient
from security.classifiers import MLInputClassifier, MLOutputClassifier
from security.runtime import load_environment_file, run_cli
from security.types import TrustedSecurityContext


def fixture_data(name: str) -> dict:
    return json.loads(files("security.evaluation").joinpath(name).read_text(encoding="utf-8"))


def render_output(template: str, flag: str) -> str:
    middle = len(flag) // 2
    return template.format(
        flag=flag,
        base64=base64.b64encode(flag.encode()).decode(),
        hex=flag.encode().hex(),
        reverse=flag[::-1],
        spaced=" ".join(flag),
        url=quote(flag, safe=""),
        prefix=flag[:12],
        suffix=flag[-12:],
        halves=f"{flag[:middle]} | {flag[middle:]}",
    )


def metrics(rows: list[dict], threshold: float, *, supplemented: bool = False) -> dict:
    tp = tn = fp = fn = 0
    false_positives, false_negatives = [], []
    for row in rows:
        positive = row["score"] >= threshold or (supplemented and row.get("match", False))
        if positive and row["label"]:
            tp += 1
        elif positive:
            fp += 1
            false_positives.append(row["id"])
        elif row["label"]:
            fn += 1
            false_negatives.append(row["id"])
        else:
            tn += 1
    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    latency = sorted(row["latency_ms"] for row in rows)
    return {
        "count": len(rows),
        "threshold": threshold,
        "accuracy": (tp + tn) / len(rows) if rows else 0.0,
        "precision": precision,
        "recall": recall,
        "f1": 2 * precision * recall / (precision + recall) if precision + recall else 0.0,
        "false_positive_rate": fp / (fp + tn) if fp + tn else 0.0,
        "false_negative_rate": fn / (fn + tp) if fn + tp else 0.0,
        "confusion_matrix": {"tn": tn, "fp": fp, "fn": fn, "tp": tp},
        "latency_ms": {
            "mean": statistics.mean(latency) if latency else 0,
            "p50": statistics.median(latency) if latency else 0,
            # Nearest-rank percentile: rank ceil(0.95 * N), converted to zero-based.
            "p95": latency[math.ceil(len(latency) * 0.95) - 1] if latency else 0,
        },
        "false_positive_ids": false_positives,
        "false_negative_ids": false_negatives,
    }


def sweep(rows: list[dict], initial: float, *, supplemented: bool = False) -> dict:
    candidates = sorted({0.5, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, initial})
    values = [metrics(rows, value, supplemented=supplemented) for value in candidates]
    # Equal FP/FN cost for the CTF; keep initial threshold if the tiny dev set ties.
    best = min(
        values,
        key=lambda m: (
            m["confusion_matrix"]["fp"] + m["confusion_matrix"]["fn"],
            abs(m["threshold"] - initial),
        ),
    )
    return {"recommended_threshold": best["threshold"], "results": values}


async def evaluate_classifiers() -> dict:
    configs = {i: load_config(i, resolve_inference_model=False) for i in (7, 8)}
    input_config = configs[7].security.input_classifier.model_copy(
        update={"timeout_seconds": 300.0}
    )
    output_config = configs[8].security.output_classifier.model_copy(
        update={"timeout_seconds": 300.0}
    )
    input_classifier = MLInputClassifier(input_config)
    output_classifier = MLOutputClassifier(output_config)
    output_data = fixture_data("sample_outputs.json")
    reference = output_data["development_flags"]["level8"]
    flags = {
        "reference_fixture": reference,
        "derived_fixture": FlagService(b"evaluation-only-key-" * 2).derive_team_flag(
            "eval-team", 8
        ),
    }
    # Separate startup/download time from measured, warmed inference latency.
    warmup = time.perf_counter()
    await input_classifier.classify_input("Explain neural networks.", 7)
    await output_classifier.classify_output(
        "Neural networks learn from data.", TrustedSecurityContext("eval", 8, reference, "fixture")
    )
    warmup_ms = (time.perf_counter() - warmup) * 1000
    input_rows = []
    for row in fixture_data("sample_prompts.json")["records"]:
        start = time.perf_counter()
        value = await input_classifier.classify_input(row["text"], 7)
        input_rows.append(
            {
                "id": row["id"],
                "label": row["label"],
                "split": row["split"],
                "score": value.score,
                "latency_ms": (time.perf_counter() - start) * 1000,
            }
        )
    development = [r for r in input_rows if r["split"] == "development"]
    evaluation = [r for r in input_rows if r["split"] == "evaluation"]
    input_report = {
        "model_id": input_config.model_id,
        "revision": input_config.revision,
        "rows": input_rows,
        "development_sweeps": {
            str(level): sweep(development, config.security.input_classifier.threshold)
            for level, config in configs.items()
        },
        "evaluation": {
            str(level): metrics(evaluation, config.security.input_classifier.threshold)
            for level, config in configs.items()
        },
    }
    output_report = {}
    for flag_name, flag in flags.items():
        context = TrustedSecurityContext("eval", 8, flag, "fixture")
        rows = []
        for row in output_data["records"]:
            start = time.perf_counter()
            value = await output_classifier.classify_output(
                render_output(row["template"], flag), context
            )
            rows.append(
                {
                    "id": row["id"],
                    "label": row["label"],
                    "split": row["split"],
                    "score": value.score,
                    "match": value.deterministic_match,
                    "latency_ms": (time.perf_counter() - start) * 1000,
                }
            )
        development = [r for r in rows if r["split"] == "development"]
        evaluation = [r for r in rows if r["split"] == "evaluation"]
        threshold = output_config.threshold
        output_report[flag_name] = {
            "rows": rows,
            "development_ml_sweep": sweep(development, threshold),
            "development_combined_sweep": sweep(development, threshold, supplemented=True),
            "evaluation_ml_only": metrics(evaluation, threshold),
            "evaluation_combined": metrics(evaluation, threshold, supplemented=True),
        }
    return {
        "created_at_utc": datetime.now(UTC).isoformat(),
        "device": "cpu",
        "platform": platform.system(),
        "python": platform.python_version(),
        "threads": int(os.environ.get("CRYPTUM_CLASSIFIER_THREADS", "2")),
        "warmup_ms": warmup_ms,
        "notes": (
            "Tiny hand-authored development and held-out evaluation splits; "
            "no training or probability calibration. "
            "Output fixtures are not independent across flag variants."
        ),
        "input": input_report,
        "output": {
            "model_id": output_config.model_id,
            "revision": output_config.revision,
            "strategy": "nli_disclosure_v2_three_hypotheses",
            **output_report,
        },
    }


async def evaluate_attacks(path: Path, base_url: str | None) -> list[dict]:
    attacks = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(attacks, list) or not all(isinstance(text, str) for text in attacks):
        raise ValueError("Candidate file must contain a JSON list of strings")
    development_flag = fixture_data("sample_outputs.json")["development_flags"]["level7"]
    authority = ContextAuthority(FlagService(b"local-attack-evaluation-key-" * 2), development_flag)
    pipeline = SecurityPipeline(authority)
    results = []
    async with httpx.AsyncClient() as http:
        client = OllamaClient(http, base_url)
        for level in (7, 8):
            context = authority.issue("local-evaluation-team", level)
            for index, attack in enumerate(attacks):
                start = time.perf_counter()
                result = await pipeline.secure_inference(
                    level, "local-evaluation-team", attack, context, client
                )
                results.append(
                    {
                        "challenge_id": level,
                        "attack_index": index,
                        "status": result.status,
                        "code": result.code,
                        "delivered_current_flag_exact": result.status == "allowed"
                        and context.protected_flag in result.response,
                        "elapsed_ms": (time.perf_counter() - start) * 1000,
                    }
                )
    return results


async def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", type=Path, default=Path("evaluation-local.json"))
    parser.add_argument("--candidate-attacks", type=Path)
    parser.add_argument("--ollama-url", default=None, help="Trusted URL; default OLLAMA_URL")
    parser.add_argument("--env-file", type=Path)
    args = parser.parse_args()
    if args.env_file is not None:
        load_environment_file(args.env_file)
    report = await evaluate_classifiers()
    if args.candidate_attacks:
        report["candidate_attacks"] = await evaluate_attacks(
            args.candidate_attacks, args.ollama_url
        )
    args.report.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(
        f"Wrote organizer-only metrics to {args.report}; "
        "no raw prompts, responses, or flags included."
    )
    for level, value in report["input"]["evaluation"].items():
        print(f"Level {level} input: accuracy={value['accuracy']:.3f}, F1={value['f1']:.3f}")
    for fixture in ("reference_fixture", "derived_fixture"):
        for mode in ("evaluation_ml_only", "evaluation_combined"):
            value = report["output"][fixture][mode]
            print(
                f"Output {fixture} {mode}: accuracy={value['accuracy']:.3f}, F1={value['f1']:.3f}"
            )


if __name__ == "__main__":
    run_cli(main)
