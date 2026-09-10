#!/usr/bin/env python3
"""Compare tiny classical field selectors on the public band OCR cache.

This script intentionally has no third-party dependency.  It trains a small
weighted logistic model, a bagged stump forest, and an AdaBoost-style stump
ensemble on handcrafted OCR/layout features.  It writes only aggregate model
metrics; the input cache remains ignored and no OCR text is copied to the
output.  The browser keeps the already validated scalar logistic path unless a
model clears the conservative validation gate.
"""

from __future__ import annotations

import argparse
import json
import math
import re
from pathlib import Path
from typing import Any


FIELDS = ("vendor", "purchase_date", "subtotal", "tax", "total")
KNOWN_FIELDS = ("vendor", "purchase_date", "total")
DUPLICATE_GROUP = {12: 12, 15: 12, 16: 12, 18: 12, 277: 277, 452: 277}
AMOUNT_RE = re.compile(r"(?:[$€£]|\b(?:rm|usd|cad|gbp)\b)?\s*\(?\s*-?\d{1,6}(?:[,.]\d{3})*(?:[,.]\d{2})\s*\)?", re.I)
DATE_RE = re.compile(
    r"\b(?:20\d{2}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.](?:20)?\d{2}|"
    r"(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|"
    r"aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:,?\s+)20\d{2})\b",
    re.I,
)
KEYWORDS = ("total", "grand", "final", "due", "payable", "tax", "gst", "hst", "vat", "subtotal", "sub-total", "date", "invoice", "amount", "before", "excluding", "round", "adjustment", "cash", "change", "receipt", "store", "thank")
FEATURE_NAMES = (
    "rank_fraction", "x0", "x1", "center_x", "y0", "y1", "center_y", "width", "height", "confidence",
    "length", "alpha_ratio", "digit_ratio", "has_amount", "has_date", "field_label", "previous_label",
    "next_label", "previous_amount", "next_amount", "previous_date", "next_date", "amount_position",
    "amount_right_half", "support_count", "independent_band_count", "candidate_top", "candidate_bottom",
    "candidate_right",
)


def split_for(index: int) -> str:
    representative = DUPLICATE_GROUP.get(index, index)
    return "tuning" if representative < 300 else "validation" if representative < 400 else "final"


def normalize(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", value.lower())


def normalize_line(value: str) -> str:
    return re.sub(r"\s+", " ", value.replace("|", " ").replace("¦", " ")).strip()


def amount_value(raw: str) -> float | None:
    value = re.sub(r"\b(?:rm|usd|cad|gbp)\b", "", raw.lower())
    value = re.sub(r"[\s$€£()]", "", value)
    comma, dot = value.rfind(","), value.rfind(".")
    if comma > dot:
        value = value.replace(".", "").replace(",", ".")
    else:
        value = value.replace(",", "")
    try:
        parsed = float(value)
    except ValueError:
        return None
    return parsed if 0 <= parsed < 1_000_000 else None


def date_value(raw: str) -> str | None:
    text = normalize_line(raw)
    match = re.fullmatch(r"(\d{1,2})[/. -](\d{1,2})[/. -](20\d{2}|\d{2})", text)
    if match:
        first, second = int(match.group(1)), int(match.group(2))
        year = int(match.group(3)) if len(match.group(3)) == 4 else 2000 + int(match.group(3))
        if first <= 12 and second <= 12:
            return None
        day, month = (first, second) if first > 12 else (second, first)
        if 1 <= month <= 12 and 1 <= day <= 31:
            return f"{year:04d}-{month:02d}-{day:02d}"
    return None


def label_date(raw: str) -> str | None:
    text = normalize_line(raw)
    match = re.fullmatch(r"(\d{1,2})[/. -](\d{1,2})[/. -](20\d{2}|\d{2})", text)
    if match:
        year = int(match.group(3)) if len(match.group(3)) == 4 else 2000 + int(match.group(3))
        return f"{year:04d}-{int(match.group(2)):02d}-{int(match.group(1)):02d}"
    return date_value(text)


def field_label(field: str, text: str) -> float:
    value = text.lower()
    patterns = {
        "purchase_date": r"\b(?:date|time|issued|invoice)\b",
        "subtotal": r"\b(?:sub[ -]?total|before\s+tax)\b",
        "tax": r"\b(?:tax|gst|hst|vat|sales\s+tax)\b",
        "total": r"\b(?:grand\s+total|total\s+due|amount\s+due|balance\s+due|payable|total)\b",
        "vendor": r"$^",
    }
    return 1.0 if re.search(patterns[field], value, re.I) else 0.0


def has_keyword(text: str) -> float:
    value = text.lower()
    return 1.0 if any((word in value if "-" in word else re.search(rf"\b{re.escape(word)}\b", value)) for word in KEYWORDS) else 0.0


def line_geometry(line: dict[str, Any], index: int, total_lines: int) -> dict[str, Any]:
    bbox = line.get("bbox") or {"x0": 0, "y0": index, "x1": 1, "y1": index + 1}
    x0, x1 = sorted((float(bbox.get("x0", 0)), float(bbox.get("x1", 1))))
    y0, y1 = sorted((float(bbox.get("y0", index)), float(bbox.get("y1", index + 1))))
    return {
        "text": normalize_line(str(line.get("text", ""))),
        "x0": x0,
        "x1": x1,
        "y0": y0,
        "y1": y1,
        "width": max(0.0, x1 - x0),
        "height": max(1.0, y1 - y0),
        "confidence": max(0.0, min(1.0, float(line.get("confidence", 75) or 75) / 100)),
        "support_count": min(1.0, float(line.get("supportCount", 1) or 1) / 4),
        "independent_band_count": min(1.0, float(line.get("independentBandCount", 1) or 1) / 4),
        "rank_fraction": index / max(1, total_lines - 1),
        "candidate_top": 1.0 if index < max(2, total_lines * 0.15) else 0.0,
        "candidate_bottom": 1.0 if index >= max(1, total_lines * 0.8) else 0.0,
        "candidate_right": 1.0 if x1 >= 0.8 else 0.0,
    }


def line_feature(lines: list[dict[str, Any]], index: int, field: str, raw_amount: str | None) -> list[float]:
    line = lines[index]
    previous = lines[index - 1] if index else {"text": ""}
    following = lines[index + 1] if index + 1 < len(lines) else {"text": ""}
    text = line["text"]
    amounts = AMOUNT_RE.findall(text)
    dates = DATE_RE.findall(text)
    position = max(0, text.find(raw_amount)) / max(1, len(text)) if raw_amount else 0.0
    return [
        line["rank_fraction"], line["x0"], line["x1"], (line["x0"] + line["x1"]) / 2,
        line["y0"], line["y1"], (line["y0"] + line["y1"]) / 2, line["width"], line["height"], line["confidence"],
        min(1.0, len(text) / 80), sum(character.isalpha() for character in text) / max(1, len(text)),
        sum(character.isdigit() for character in text) / max(1, len(text)), float(bool(amounts)), float(bool(dates)),
        field_label(field, text), field_label(field, previous["text"]), field_label(field, following["text"]),
        float(bool(AMOUNT_RE.search(previous["text"]))), float(bool(AMOUNT_RE.search(following["text"]))),
        float(bool(DATE_RE.search(previous["text"]))), float(bool(DATE_RE.search(following["text"]))), position,
        float(position >= 0.5), line["support_count"], line["independent_band_count"], line["candidate_top"],
        line["candidate_bottom"], line["candidate_right"],
    ]


def candidate_rows(row: dict[str, Any], field: str, label: dict[str, Any]) -> list[dict[str, Any]]:
    raw_lines = row.get("mergedLines", [])
    lines = [line_geometry(line, index, len(raw_lines)) for index, line in enumerate(raw_lines) if str(line.get("text", "")).strip()]
    max_x = max([line["x1"] for line in lines] + [1.0])
    max_y = max([line["y1"] for line in lines] + [1.0])
    for line in lines:
        line["x0"] /= max_x
        line["x1"] /= max_x
        line["y0"] /= max_y
        line["y1"] /= max_y
        line["width"] /= max_x
        line["height"] /= max_y
        line["candidate_right"] = 1.0 if line["x1"] >= 0.8 else 0.0
    candidates: list[dict[str, Any]] = []
    if field == "vendor":
        expected = normalize(str(label.get("company", "")))
        for index, line in enumerate(lines[:14]):
            text = line["text"]
            letters = sum(character.isalpha() for character in text)
            if letters < 3 or letters / max(1, len(text)) < 0.35 or len(text) > 80 or AMOUNT_RE.search(text):
                continue
            if re.search(r"^(?:store|shop)$|\b(?:receipt|invoice|subtotal|total|tax|date|cashier|address|thank|change|tender)\b", text, re.I):
                continue
            candidates.append({"index": index, "value": text, "positive": bool(expected and (expected in normalize(text) or normalize(text) in expected)), "raw_amount": None})
    elif field == "purchase_date":
        expected = label_date(str(label.get("date", "")))
        for index, line in enumerate(lines):
            for raw in DATE_RE.findall(line["text"]):
                value = date_value(raw)
                if value:
                    candidates.append({"index": index, "value": value, "positive": value == expected, "raw_amount": None})
    else:
        expected = amount_value(str(label.get("total", ""))) if field == "total" else None
        for index, line in enumerate(lines):
            for raw in AMOUNT_RE.findall(line["text"]):
                value = amount_value(raw)
                if value is None:
                    continue
                label_near = any(field_label(field, lines[near]["text"]) > 0 for near in (index - 1, index, index + 1) if 0 <= near < len(lines))
                positive = bool(field == "total" and expected is not None and abs(value - expected) < 0.011)
                if field in ("subtotal", "tax"):
                    positive = label_near
                candidates.append({"index": index, "value": f"{value:.2f}", "positive": positive, "raw_amount": raw})
    for candidate in candidates:
        candidate["features"] = line_feature(lines, candidate["index"], field, candidate["raw_amount"])
    return candidates


def sigmoid(value: float) -> float:
    return 1.0 / (1.0 + math.exp(-max(-40.0, min(40.0, value))))


def logistic_train(rows: list[dict[str, Any]], epochs: int = 160) -> list[float]:
    dimension = len(FEATURE_NAMES)
    weights = [0.0] * (dimension + 1)
    if not rows:
        return weights
    positives = max(1, sum(bool(row["positive"]) for row in rows))
    negatives = max(1, len(rows) - positives)
    positive_weight = len(rows) / (2 * positives)
    negative_weight = len(rows) / (2 * negatives)
    for epoch in range(epochs):
        gradient = [0.0] * len(weights)
        for row in rows:
            values = [1.0] + row["features"]
            probability = sigmoid(sum(weight * value for weight, value in zip(weights, values)))
            target = float(bool(row["positive"]))
            error = (probability - target) * (positive_weight if target else negative_weight)
            for index, value in enumerate(values):
                gradient[index] += error * value
        rate = 0.10 * (1.0 - 0.4 * epoch / epochs)
        for index in range(len(weights)):
            weights[index] -= rate * (gradient[index] / len(rows) + (0.002 * weights[index] if index else 0))
    return weights


def logistic_probability(model: list[float], features: list[float]) -> float:
    return sigmoid(model[0] + sum(weight * value for weight, value in zip(model[1:], features)))


def gini(rows: list[dict[str, Any]]) -> float:
    if not rows:
        return 0.0
    rate = sum(bool(row["positive"]) for row in rows) / len(rows)
    return 1 - rate * rate - (1 - rate) * (1 - rate)


def stump_rate(rows: list[dict[str, Any]]) -> float:
    return (sum(bool(row["positive"]) for row in rows) + 1) / (len(rows) + 2)


def forest_train(rows: list[dict[str, Any]], trees: int = 16) -> list[dict[str, float | int]]:
    forest: list[dict[str, float | int]] = []
    if not rows:
        return forest
    choices = [(feature, threshold) for feature in range(len(FEATURE_NAMES)) for threshold in (0.2, 0.4, 0.6, 0.8)]
    for tree in range(trees):
        sampled = [rows[(position * 17 + tree * 31) % len(rows)] for position in range(len(rows))]
        feature, threshold = min(choices, key=lambda choice: (
            len([row for row in sampled if row["features"][choice[0]] < choice[1]]) * gini([row for row in sampled if row["features"][choice[0]] < choice[1]])
            + len([row for row in sampled if row["features"][choice[0]] >= choice[1]]) * gini([row for row in sampled if row["features"][choice[0]] >= choice[1]])
        ))
        left = [row for row in sampled if row["features"][feature] < threshold]
        right = [row for row in sampled if row["features"][feature] >= threshold]
        forest.append({"feature": feature, "threshold": threshold, "left": stump_rate(left), "right": stump_rate(right)})
    return forest


def forest_probability(model: list[dict[str, float | int]], features: list[float]) -> float:
    if not model:
        return 0.0
    return sum(float(tree["left"] if features[int(tree["feature"])] < float(tree["threshold"]) else tree["right"]) for tree in model) / len(model)


def boosted_train(rows: list[dict[str, Any]], rounds: int = 16) -> list[dict[str, float | int]]:
    if not rows:
        return []
    weights = [1.0 / len(rows)] * len(rows)
    model: list[dict[str, float | int]] = []
    choices = [(feature, threshold, polarity) for feature in range(len(FEATURE_NAMES)) for threshold in (0.2, 0.4, 0.6, 0.8) for polarity in (-1, 1)]
    for _ in range(rounds):
        best: tuple[float, int, float, int] | None = None
        for feature, threshold, polarity in choices:
            error = 0.0
            for index, row in enumerate(rows):
                prediction = 1 if (1 if row["features"][feature] >= threshold else -1) * polarity > 0 else -1
                target = 1 if row["positive"] else -1
                if prediction != target:
                    error += weights[index]
            if best is None or error < best[0]:
                best = (error, feature, threshold, polarity)
        assert best is not None
        error, feature, threshold, polarity = best
        error = min(0.499, max(1e-6, error))
        alpha = 0.5 * math.log((1 - error) / error)
        for index, row in enumerate(rows):
            prediction = 1 if (1 if row["features"][feature] >= threshold else -1) * polarity > 0 else -1
            target = 1 if row["positive"] else -1
            weights[index] *= math.exp(-alpha * target * prediction)
        total = sum(weights)
        weights = [value / total for value in weights]
        model.append({"feature": feature, "threshold": threshold, "polarity": polarity, "alpha": alpha})
    return model


def boosted_probability(model: list[dict[str, float | int]], features: list[float]) -> float:
    if not model:
        return 0.0
    total = sum(float(item["alpha"]) for item in model)
    margin = sum(float(item["alpha"]) * (1 if (1 if features[int(item["feature"])] >= float(item["threshold"]) else -1) * int(item["polarity"]) > 0 else -1) for item in model)
    return sigmoid(2 * margin / max(1e-6, total))


def document_scores(documents: list[list[dict[str, Any]]], model_type: str, model: Any) -> list[dict[str, Any]]:
    scores = []
    for candidates in documents:
        if not candidates:
            scores.append({"probability": 0.0, "margin": 0.0, "positive": False, "candidate_count": 0})
            continue
        scored = []
        for row in candidates:
            if model_type == "logistic":
                probability = logistic_probability(model, row["features"])
            elif model_type == "forest":
                probability = forest_probability(model, row["features"])
            else:
                probability = boosted_probability(model, row["features"])
            scored.append({**row, "probability": probability})
        scored.sort(key=lambda row: row["probability"], reverse=True)
        scores.append({"probability": scored[0]["probability"], "margin": scored[0]["probability"] - (scored[1]["probability"] if len(scored) > 1 else 0), "positive": bool(scored[0]["positive"]), "candidate_count": len(scored)})
    return scores


def gate(scores: list[dict[str, Any]], required_precision: float = 1.0) -> dict[str, float]:
    thresholds = sorted({0.5, 0.7, 0.8, 0.9, 0.95, 0.98, 0.99, 0.995} | {round(float(row["probability"]), 4) for row in scores})
    best = {"threshold": 0.995, "margin": 0.10, "trusted": 0.0, "coverage": 0.0, "precision": 0.0}
    for threshold in thresholds:
        for margin in (0.0, 0.02, 0.05, 0.10, 0.15):
            accepted = [row for row in scores if row["probability"] >= threshold and row["margin"] >= margin]
            if not accepted:
                continue
            precision = sum(bool(row["positive"]) for row in accepted) / len(accepted)
            coverage = len(accepted) / max(1, len(scores))
            if precision >= required_precision and (coverage > best["coverage"] or coverage == best["coverage"] and threshold < best["threshold"]):
                best = {"threshold": threshold, "margin": margin, "trusted": float(len(accepted)), "coverage": coverage, "precision": precision}
    return best


def evaluate(scores: list[dict[str, Any]], selected_gate: dict[str, float]) -> dict[str, Any]:
    accepted = [row for row in scores if row["probability"] >= selected_gate["threshold"] and row["margin"] >= selected_gate["margin"]]
    return {
        "documents": len(scores),
        "trusted": len(accepted),
        "correct": sum(bool(row["positive"]) for row in accepted),
        "wrongTrusted": sum(not bool(row["positive"]) for row in accepted),
        "coverage": len(accepted) / max(1, len(scores)),
        "precision": sum(bool(row["positive"]) for row in accepted) / len(accepted) if accepted else None,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--labels", type=Path, default=Path("benchmarks/sroie500/labels"))
    parser.add_argument("--output", type=Path, default=Path("benchmarks/receipt-band-model-comparison.json"))
    args = parser.parse_args()
    benchmark = json.loads(args.input.read_text())
    rows = benchmark["rows"]
    documents: dict[str, dict[str, list[list[dict[str, Any]]]]] = {field: {split: [] for split in ("tuning", "validation", "final")} for field in KNOWN_FIELDS}
    for row in rows:
        index = int(row["id"])
        label = json.loads((args.labels / f"{index:03d}.json").read_text())
        split = split_for(index)
        for field in KNOWN_FIELDS:
            documents[field][split].append(candidate_rows(row, field, label))

    output: dict[str, Any] = {"dataset": "SROIE public labels + PP-OCRv6 band cache", "sampleSize": len(rows), "models": {}, "rulesMlHybrid": None}
    for field in KNOWN_FIELDS:
        training = [candidate for document in documents[field]["tuning"] for candidate in document]
        trained = {
            "logistic": logistic_train(training),
            "stump-forest": forest_train(training),
            "boosted-stumps": boosted_train(training),
        }
        field_result: dict[str, Any] = {"trainingCandidates": len(training), "trainingPositiveCandidates": sum(bool(row["positive"]) for row in training), "models": {}}
        for model_name, model in trained.items():
            model_type = "logistic" if model_name == "logistic" else "forest" if model_name == "stump-forest" else "boosted"
            validation_scores = document_scores(documents[field]["validation"], model_type, model)
            selected_gate = gate(validation_scores, 1.0)
            final_scores = document_scores(documents[field]["final"], model_type, model)
            field_result["models"][model_name] = {
                "validationGate": selected_gate,
                "validation": evaluate(validation_scores, selected_gate),
                "final": evaluate(final_scores, selected_gate),
                "modelSizeBytes": len(json.dumps(model, separators=(",", ":"))),
            }
        output["models"][field] = field_result
    output["notes"] = [
        "Only the tuning split trains coefficients; validation selects gates; final is untouched until scoring.",
        "SROIE has no independent subtotal/tax labels, so those fields are excluded from supervised model comparison.",
        "Models are offline comparisons. The browser keeps the existing tiny logistic selector unless a frozen model clears the conservative safety gate.",
    ]
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, separators=(",", ":")) + "\n")
    print(json.dumps(output, indent=2))


if __name__ == "__main__":
    main()
