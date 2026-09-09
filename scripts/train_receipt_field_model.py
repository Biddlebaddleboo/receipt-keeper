#!/usr/bin/env python3
"""Train the small, browser-side receipt field candidate model.

This file intentionally has no third-party dependency.  The training data is
the ignored local SROIE cache.  Only model coefficients and aggregate metrics
are exported; receipt images/OCR are never written to the repository.

The classifier is a one-vs-rest logistic candidate scorer.  A tiny depth-two
random forest is also trained for an offline comparison.  The browser export
uses logistic coefficients so inference is a few dot products and does not
need a ML runtime.
"""

from __future__ import annotations

import argparse
import csv
import difflib
import json
import math
import re
from pathlib import Path
from typing import Iterable


FIELDS = ("vendor", "purchase_date", "subtotal", "tax", "total")
FIELD_LABELS = {
    "vendor": r"never-match",
    "purchase_date": r"date|time|issued|invoice",
    "subtotal": r"sub[ -]?total|before tax",
    "tax": r"tax|gst|hst|vat|sales tax",
    "total": r"total|amount due|balance due|payable",
}
KEYWORDS = (
    "total", "grand", "due", "payable", "after", "adj", "adjustment", "incl",
    "inclusive", "excl", "excluding", "sales", "summary", "tax", "gst",
    "subtotal", "sub-total", "rounding", "round", "cash", "change", "tender",
    "paid", "payment", "qty", "quantity", "item", "price", "discount", "amount",
    "final", "balance", "before", "invoice", "date", "time", "issued", "store",
    "receipt", "member", "address", "thank",
)
FEATURE_NAMES = (
    "y", "x", "width", "height", "first", "last", "top_quarter", "bottom_quarter",
    "line_length", "alpha_ratio", "digit_ratio", "amount_count", "has_amount",
    "has_date", "has_currency", "ocr_confidence", "line_field_keyword",
    "previous_field_keyword", "next_field_keyword", "previous_amount", "next_amount",
    *(f"line_keyword_{word.replace('-', '_')}" for word in KEYWORDS),
    *(f"previous_keyword_{word.replace('-', '_')}" for word in KEYWORDS),
    *(f"next_keyword_{word.replace('-', '_')}" for word in KEYWORDS),
    "amount_relative_x", "amount_right_half",
)
AMOUNT_RE = re.compile(r"(?:[$€£]\s*)?\(?\s*\d{1,6}(?:[,.]\d{3})*(?:[,.]\d{2})\s*\)?")
DATE_RE = re.compile(
    r"\b(?:20\d{2}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.](?:20)?\d{2}|"
    r"(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|"
    r"aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+"
    r"\d{1,2}(?:,\s*|\s+)20\d{2})\b",
    re.IGNORECASE,
)
DUPLICATE_GROUP = {12: 12, 15: 12, 16: 12, 18: 12, 277: 277, 452: 277}


def split_for(index: int) -> str:
    representative = DUPLICATE_GROUP.get(index, index)
    if representative < 300:
        return "tuning"
    if representative < 400:
        return "validation"
    return "final"


def normalize(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", value.lower())


def parse_amount(raw: str) -> float | None:
    value = re.sub(r"[\s$€£()]", "", raw)
    comma = value.rfind(",")
    dot = value.rfind(".")
    if comma > dot:
        value = value.replace(".", "").replace(",", ".")
    else:
        value = value.replace(",", "")
    try:
        parsed = float(value)
    except ValueError:
        return None
    return parsed if 0 <= parsed < 1_000_000 else None


def read_lines(root: Path, index: int, browser_records: dict[int, dict[str, object]] | None = None) -> list[dict[str, float | str]]:
    if browser_records is not None and index in browser_records:
        cached_lines = browser_records[index].get("ocrLines")
        if isinstance(cached_lines, list) and cached_lines:
            rows = []
            for cached in cached_lines:
                if not isinstance(cached, dict):
                    continue
                bbox = cached.get("bbox")
                if not isinstance(bbox, dict):
                    continue
                try:
                    x0, y0 = float(bbox["x0"]), float(bbox["y0"])
                    x1, y1 = float(bbox["x1"]), float(bbox["y1"])
                except (KeyError, TypeError, ValueError):
                    continue
                rows.append({
                    "text": str(cached.get("text", "")).strip(),
                    "x": min(x0, x1), "y": min(y0, y1),
                    "right": max(x0, x1), "bottom": max(y0, y1),
                    "confidence": float(cached.get("confidence", 80) or 80),
                })
            if rows:
                rows.sort(key=lambda item: (float(item["y"]), float(item["x"])))
                max_right = max((float(item["right"]) for item in rows), default=1.0)
                max_bottom = max((float(item["bottom"]) for item in rows), default=1.0)
                for item in rows:
                    item["x_norm"] = float(item["x"]) / max_right
                    item["y_norm"] = float(item["y"]) / max_bottom
                    item["width_norm"] = (float(item["right"]) - float(item["x"])) / max_right
                    item["height_norm"] = (float(item["bottom"]) - float(item["y"])) / max_bottom
                return rows
    rows: list[dict[str, float | str]] = []
    with (root / "ocr" / f"{index:03d}.csv").open(newline="") as handle:
        for row in csv.reader(handle):
            if len(row) < 9:
                continue
            coordinates = [float(value) for value in row[:8]]
            rows.append({
                "text": row[8].strip(),
                "x": min(coordinates[0], coordinates[2], coordinates[4], coordinates[6]),
                "y": min(coordinates[1], coordinates[3], coordinates[5], coordinates[7]),
                "right": max(coordinates[0], coordinates[2], coordinates[4], coordinates[6]),
                "bottom": max(coordinates[1], coordinates[3], coordinates[5], coordinates[7]),
                "confidence": 80.0,
            })
    rows.sort(key=lambda item: (float(item["y"]), float(item["x"])))
    max_right = max((float(item["right"]) for item in rows), default=1.0)
    max_bottom = max((float(item["bottom"]) for item in rows), default=1.0)
    for item in rows:
        item["x_norm"] = float(item["x"]) / max_right
        item["y_norm"] = float(item["y"]) / max_bottom
        item["width_norm"] = (float(item["right"]) - float(item["x"])) / max_right
        item["height_norm"] = (float(item["bottom"]) - float(item["y"])) / max_bottom
    return rows


def has_keyword(text: str, word: str) -> bool:
    value = text.lower()
    if "-" in word:
        return word in value
    return bool(re.search(rf"\b{re.escape(word)}\b", value))


def feature_vector(
    lines: list[dict[str, float | str]],
    index: int,
    field: str,
    raw_amount: str | None = None,
) -> list[float]:
    item = lines[index]
    text = str(item["text"])
    previous = str(lines[index - 1]["text"]) if index else ""
    following = str(lines[index + 1]["text"]) if index + 1 < len(lines) else ""
    lowered = text.lower()
    previous_lower = previous.lower()
    following_lower = following.lower()
    amounts = AMOUNT_RE.findall(text)
    label_pattern = FIELD_LABELS[field]
    values = [
        float(item["y_norm"]), float(item["x_norm"]), float(item["width_norm"]),
        float(item["height_norm"]), float(index == 0), float(index == len(lines) - 1),
        float(float(item["y_norm"]) < 0.22), float(float(item["y_norm"]) > 0.78),
        min(len(text), 80) / 80.0,
        sum(character.isalpha() for character in text) / max(len(text), 1),
        sum(character.isdigit() for character in text) / max(len(text), 1),
        min(len(amounts), 4) / 4.0, float(bool(amounts)), float(bool(DATE_RE.search(text))),
        float(bool(re.search(r"[$€£]|\b(?:rm|usd|cad|gbp)\b", lowered))),
        min(max(float(item.get("confidence", 80.0)) / 100.0, 0.0), 1.0),
        float(bool(re.search(rf"\b(?:{label_pattern})\b", lowered))),
        float(bool(re.search(rf"\b(?:{label_pattern})\b", previous_lower))),
        float(bool(re.search(rf"\b(?:{label_pattern})\b", following_lower))),
        float(bool(AMOUNT_RE.search(previous))), float(bool(AMOUNT_RE.search(following))),
    ]
    values.extend(float(has_keyword(lowered, word)) for word in KEYWORDS)
    values.extend(float(has_keyword(previous_lower, word)) for word in KEYWORDS)
    values.extend(float(has_keyword(following_lower, word)) for word in KEYWORDS)
    if raw_amount is None:
        values.extend((0.0, 0.0))
    else:
        position = max(text.find(raw_amount), 0)
        values.extend((position / max(len(text), 1), float(position >= len(text) * 0.5)))
    if len(values) != len(FEATURE_NAMES):
        raise RuntimeError(f"feature schema mismatch: {len(values)} != {len(FEATURE_NAMES)}")
    return values


def candidate_rows(root: Path, index: int, field: str, browser_records: dict[int, dict[str, object]] | None = None) -> list[dict[str, object]]:
    lines = read_lines(root, index, browser_records)
    with (root / "labels" / f"{index:03d}.json").open() as handle:
        label = json.load(handle)
    rows: list[dict[str, object]] = []
    if field == "vendor":
        expected = normalize(label.get("company", ""))
        for line_index, item in enumerate(lines[:12]):
            text = str(item["text"])
            letters = sum(character.isalpha() for character in text)
            if (
                letters < 3
                or len(text) > 80
                or letters / max(len(text), 1) < 0.35
                or re.search(r"\b(?:receipt|invoice|subtotal|total|tax|gst|date|cashier|address|tel|phone|thank|change|tender)\b", text, re.IGNORECASE)
                or AMOUNT_RE.search(text)
            ):
                continue
            candidate = normalize(text)
            ratio = difflib.SequenceMatcher(None, expected, candidate).ratio()
            positive = bool(expected and (expected in candidate or candidate in expected or ratio >= 0.60))
            rows.append({"index": line_index, "value": text, "features": feature_vector(lines, line_index, field), "positive": positive})
        return rows
    if field == "purchase_date":
        expected = normalize(label.get("date", ""))
        for line_index, item in enumerate(lines):
            text = str(item["text"])
            for match in DATE_RE.finditer(text):
                raw = match.group(0)
                rows.append({"index": line_index, "value": raw, "features": feature_vector(lines, line_index, field), "positive": normalize(raw) == expected or expected in normalize(text)})
        return rows
    expected_total = parse_amount(str(label.get("total", ""))) if field == "total" else None
    for line_index, item in enumerate(lines):
        text = str(item["text"])
        for raw in AMOUNT_RE.findall(text):
            amount = parse_amount(raw)
            if amount is None:
                continue
            positive = bool(field == "total" and expected_total is not None and abs(amount - expected_total) < 0.011)
            if field == "subtotal":
                positive = bool(re.search(r"\bsub[ -]?total\b", text, re.IGNORECASE))
            if field == "tax":
                positive = bool(re.search(r"\b(?:tax|gst|hst|vat|sales tax)\b", text, re.IGNORECASE))
            rows.append({"index": line_index, "value": raw, "features": feature_vector(lines, line_index, field, raw), "positive": positive})
    return rows


def sigmoid(value: float) -> float:
    return 1.0 / (1.0 + math.exp(-max(-40.0, min(40.0, value))))


def train_logistic(rows: list[dict[str, object]], epochs: int = 160) -> list[float]:
    if not rows:
        return [0.0] * (len(FEATURE_NAMES) + 1)
    dimension = len(FEATURE_NAMES)
    weights = [0.0] * (dimension + 1)
    positives = sum(bool(row["positive"]) for row in rows)
    negatives = max(len(rows) - positives, 1)
    positive_weight = len(rows) / max(2.0 * positives, 1.0)
    negative_weight = len(rows) / (2.0 * negatives)
    for epoch in range(epochs):
        gradient = [0.0] * (dimension + 1)
        for row in rows:
            features = [1.0] + [float(value) for value in row["features"]]  # type: ignore[index]
            target = float(bool(row["positive"]))
            probability = sigmoid(sum(weight * value for weight, value in zip(weights, features)))
            error = (probability - target) * (positive_weight if target else negative_weight)
            for position, value in enumerate(features):
                gradient[position] += error * value
        learning_rate = 0.12 * (1.0 - 0.5 * epoch / epochs)
        for position in range(len(weights)):
            regularization = 0.002 * weights[position] if position else 0.0
            weights[position] -= learning_rate * (gradient[position] / len(rows) + regularization)
    return weights


def gini(rows: list[dict[str, object]]) -> float:
    if not rows:
        return 0.0
    positive = sum(bool(row["positive"]) for row in rows) / len(rows)
    return 1.0 - positive * positive - (1.0 - positive) * (1.0 - positive)


def train_stump_forest(rows: list[dict[str, object]], trees: int = 12) -> list[dict[str, object]]:
    """Train a deliberately tiny depth-two forest for candidate comparison."""
    if not rows:
        return []
    features = len(FEATURE_NAMES)
    forest: list[dict[str, object]] = []
    for tree in range(trees):
        sampled = [rows[(position * 17 + tree * 31) % len(rows)] for position in range(len(rows))]
        available = [(feature, threshold) for feature in range(features) for threshold in (0.25, 0.5, 0.75)]
        best = min(available, key=lambda item: _split_cost(sampled, item[0], item[1]))
        left = [row for row in sampled if float(row["features"][best[0]]) < best[1]]  # type: ignore[index]
        right = [row for row in sampled if float(row["features"][best[0]]) >= best[1]]  # type: ignore[index]
        forest.append({
            "feature": best[0],
            "threshold": best[1],
            "left": _smoothed_rate(left),
            "right": _smoothed_rate(right),
        })
    return forest


def _split_cost(rows: list[dict[str, object]], feature: int, threshold: float) -> float:
    left = [row for row in rows if float(row["features"][feature]) < threshold]  # type: ignore[index]
    right = [row for row in rows if float(row["features"][feature]) >= threshold]  # type: ignore[index]
    return len(left) * gini(left) + len(right) * gini(right)


def _smoothed_rate(rows: list[dict[str, object]]) -> float:
    return (sum(bool(row["positive"]) for row in rows) + 1.0) / (len(rows) + 2.0)


def logistic_probability(weights: list[float], features: list[float]) -> float:
    return sigmoid(weights[0] + sum(weight * value for weight, value in zip(weights[1:], features)))


def forest_probability(forest: list[dict[str, object]], features: list[float]) -> float:
    if not forest:
        return 0.0
    return sum(float(tree["left"] if features[int(tree["feature"])] < float(tree["threshold"]) else tree["right"]) for tree in forest) / len(forest)


def score_documents(
    rows_by_split: dict[str, list[tuple[int, list[dict[str, object]]]]],
    model_type: str,
    model: object,
    split: str,
) -> list[dict[str, object]]:
    output: list[dict[str, object]] = []
    for index, rows in rows_by_split.get(split, []):
        scored = []
        for row in rows:
            features = row["features"]  # type: ignore[assignment]
            probability = logistic_probability(model, features) if model_type == "logistic" else forest_probability(model, features)  # type: ignore[arg-type]
            scored.append({**row, "probability": probability})
        scored.sort(key=lambda row: float(row["probability"]), reverse=True)
        if not scored:
            continue
        top = scored[0]
        second = float(scored[1]["probability"]) if len(scored) > 1 else 0.0
        output.append({
            "index": index,
            "probability": float(top["probability"]),
            "margin": float(top["probability"]) - second,
            "positive": bool(top["positive"]),
            "candidate_count": len(scored),
        })
    return output


def calibration_points(scores: list[dict[str, object]]) -> list[dict[str, float]]:
    points = []
    for lower in (0.0, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 0.98, 0.99):
        upper = 0.5 if lower == 0.0 else (0.6 if lower == 0.5 else lower + 0.1 if lower < 0.9 else lower + 0.05 if lower < 0.99 else 1.01)
        bucket = [row for row in scores if lower <= float(row["probability"]) < upper]
        accuracy = (sum(bool(row["positive"]) for row in bucket) + 1.0) / (len(bucket) + 2.0)
        points.append({"max": min(1.0, upper), "accuracy": accuracy})
    return points


def choose_threshold(scores: list[dict[str, object]], required_precision: float = 0.995) -> dict[str, float]:
    """Choose the highest validation coverage observed at the safety target."""
    candidates = sorted({0.5, 0.6, 0.7, 0.8, 0.85, 0.9, 0.92, 0.94, 0.96, 0.98, 0.99, 0.995})
    margins = (0.02, 0.04, 0.06, 0.08, 0.10)
    best = {"threshold": 0.995, "margin": 0.10, "coverage": 0.0, "precision": 0.0, "trusted": 0.0}
    for threshold in candidates:
        for margin in margins:
            accepted = [row for row in scores if float(row["probability"]) >= threshold and float(row["margin"]) >= margin]
            precision = sum(bool(row["positive"]) for row in accepted) / len(accepted) if accepted else 0.0
            coverage = len(accepted) / 100.0
            if precision >= required_precision and (coverage > best["coverage"] or (coverage == best["coverage"] and threshold < best["threshold"])):
                best = {"threshold": threshold, "margin": margin, "coverage": coverage, "precision": precision, "trusted": float(len(accepted))}
    return best


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", default="benchmarks/sroie500", type=Path)
    parser.add_argument("--output", default="src/lib/receiptFieldModel.json", type=Path)
    parser.add_argument("--browser-cache", default="benchmarks/receipt-frontend-browser-ocr.jsonl", type=Path)
    args = parser.parse_args()
    root: Path = args.dataset
    browser_records: dict[int, dict[str, object]] | None = None
    if args.browser_cache.exists():
        browser_records = {}
        for line in args.browser_cache.read_text().splitlines():
            try:
                record = json.loads(line)
                browser_records[int(record["id"])] = record
            except (KeyError, TypeError, ValueError, json.JSONDecodeError):
                continue
    models: dict[str, dict[str, object]] = {}
    comparison: dict[str, dict[str, object]] = {}
    for field in FIELDS:
        print(f"training {field}", flush=True)
        cached_rows = {
            split: [(index, candidate_rows(root, index, field, browser_records)) for index in range(500) if split_for(index) == split]
            for split in ("tuning", "validation", "final")
        }
        training_rows = [row for _, rows in cached_rows["tuning"] for row in rows]
        logistic = train_logistic(training_rows)
        forest = train_stump_forest(training_rows)
        logistic_validation = score_documents(cached_rows, "logistic", logistic, "validation")
        forest_validation = score_documents(cached_rows, "forest", forest, "validation")
        logistic_threshold = choose_threshold(logistic_validation)
        forest_threshold = choose_threshold(forest_validation)
        comparison[field] = {
            "training_candidates": len(training_rows),
            "training_positive_candidates": sum(bool(row["positive"]) for row in training_rows),
            "logistic_validation": {**logistic_threshold, "candidates": len(logistic_validation)},
            "forest_validation": {**forest_threshold, "candidates": len(forest_validation)},
        }
        # The export is intentionally logistic only.  A forest made of a few
        # one-feature splits was a useful baseline but did not carry enough
        # layout information for the browser path.
        models[field] = {
            "type": "logistic",
            "weights": [round(weight, 8) for weight in logistic],
            "threshold": logistic_threshold["threshold"],
            "min_margin": logistic_threshold["margin"],
            "calibration": calibration_points(logistic_validation),
        }
    output = {
        "version": 1,
        "dataset": "ICDAR 2019 SROIE key labels with cached Tesseract.js line boxes when available",
        "feature_names": list(FEATURE_NAMES),
        "fields": models,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, separators=(",", ":")) + "\n")
    print(json.dumps({field: {"logistic": comparison[field]["logistic_validation"], "stump_forest": comparison[field]["forest_validation"]} for field in FIELDS}, indent=2))


if __name__ == "__main__":
    main()
