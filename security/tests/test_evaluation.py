import pytest

from security.evaluation.evaluate import fixture_data, metrics, render_output, sweep


def test_confusion_metrics_and_latency():
    rows = [
        {"id": "tp", "label": 1, "score": 0.9, "latency_ms": 4.0},
        {"id": "fn", "label": 1, "score": 0.1, "latency_ms": 3.0},
        {"id": "fp", "label": 0, "score": 0.9, "latency_ms": 2.0},
        {"id": "tn", "label": 0, "score": 0.1, "latency_ms": 1.0},
    ]
    value = metrics(rows, 0.75)
    assert value["confusion_matrix"] == {"tn": 1, "fp": 1, "fn": 1, "tp": 1}
    assert value["accuracy"] == value["precision"] == value["recall"] == value["f1"] == 0.5
    assert value["false_positive_rate"] == 0.5
    assert value["false_negative_rate"] == 0.5
    assert value["latency_ms"]["mean"] == 2.5


def test_datasets_separate_development_from_evaluation():
    for filename in ("sample_prompts.json", "sample_outputs.json"):
        data = fixture_data(filename)
        ids = [record["id"] for record in data["records"]]
        assert len(ids) == len(set(ids))
        assert {record["split"] for record in data["records"]} == {"development", "evaluation"}
        assert {record["label"] for record in data["records"]} == {0, 1}
    flag = fixture_data("sample_outputs.json")["development_flags"]["level8"]
    assert render_output("{flag}", flag) == flag
    for row in fixture_data("sample_outputs.json")["records"]:
        assert isinstance(render_output(row["template"], flag), str)


@pytest.mark.parametrize("count,expected", [(1, 1.0), (4, 4.0), (20, 19.0), (24, 23.0)])
def test_p95_uses_nearest_rank(count, expected):
    rows = [
        {"id": str(i), "label": 0, "score": 0.1, "latency_ms": float(i)}
        for i in range(1, count + 1)
    ]
    assert metrics(rows, 0.75)["latency_ms"]["p95"] == expected


def test_empty_metrics_are_defined():
    value = metrics([], 0.75)
    assert value["false_negative_rate"] == value["latency_ms"]["p95"] == 0


def test_sweep_includes_requested_thresholds():
    thresholds = {item["threshold"] for item in sweep([], 0.75)["results"]}
    assert {0.65, 0.70, 0.75, 0.80, 0.85} <= thresholds
