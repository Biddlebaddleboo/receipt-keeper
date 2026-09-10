#!/usr/bin/env python3
"""Train the PP-OCRv6 receipt field selector offline.

The input is the ignored PP-OCRv6 browser cache.  Only five sets of logistic
coefficients and validation calibration/gates are exported; no OCR text or
images are written.  A tiny stump forest is trained for comparison, but the
browser artifact is logistic so inference is a handful of dot products.
"""

from __future__ import annotations

import argparse
import json
import math
import re
from functools import cmp_to_key
from pathlib import Path
from typing import Any


FIELDS = ("vendor", "purchase_date", "subtotal", "tax", "total")
FEATURE_NAMES = (
    "rank", "rank_fraction", "x0", "x1", "center_x", "y0", "y1", "center_y", "width", "height", "area",
    "left_margin", "right_margin", "top_margin", "bottom_margin", "line_confidence", "line_length",
    "alpha_ratio", "digit_ratio", "amount_count", "has_amount", "has_date", "has_currency", "field_label",
    "previous_field_label", "next_field_label", "line_keyword", "previous_keyword", "next_keyword",
    "previous_amount", "next_amount", "previous_date", "next_date", "amount_relative_x", "amount_right_half",
    "amount_near_right_edge", "gap_prev", "gap_next", "aligned_prev", "aligned_next", "repeated_value",
    "value_frequency", "explicit_label_strength", "candidate_bottom", "candidate_top", "candidate_right",
    "polygon_skew", "polygon_tilt",
)

AMOUNT_RE = re.compile(
    r"(?:[$€£]|\b(?:rm|usd|cad|gbp)\b)\s*\(?\s*-?\d{1,6}(?:[,.]\d{3})*(?:[,.]\d{2})\s*\)?"
    r"|\(?\s*-?\d{1,6}(?:[,.]\d{3})*(?:[,.]\d{2})\s*\)?",
    re.IGNORECASE,
)
DATE_RE = re.compile(
    r"\b(?:20\d{2}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.](?:20)?\d{2}|"
    r"\d{1,2}\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|"
    r"jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+20\d{2}|"
    r"(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|"
    r"sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:,\s*|\s+)20\d{2})\b",
    re.IGNORECASE,
)
KEYWORDS = (
    "total", "grand", "final", "due", "payable", "after", "adj", "adjustment", "incl", "inclusive",
    "excl", "excluding", "sales", "summary", "tax", "gst", "subtotal", "sub-total", "rounding", "round",
    "cash", "change", "tender", "paid", "payment", "qty", "quantity", "item", "price", "discount", "amount",
    "balance", "before", "invoice", "date", "time", "issued", "store", "receipt", "member", "address", "thank",
)
MONTHS = {
    "jan": 1, "january": 1, "feb": 2, "february": 2, "mar": 3, "march": 3, "apr": 4, "april": 4,
    "may": 5, "jun": 6, "june": 6, "jul": 7, "july": 7, "aug": 8, "august": 8, "sep": 9, "sept": 9,
    "september": 9, "oct": 10, "october": 10, "nov": 11, "november": 11, "dec": 12, "december": 12,
}
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


def normalize_line(value: str) -> str:
    return re.sub(r"\s+", " ", value.replace("|", " ").replace("¦", " ")).strip()


def parse_amount(raw: str) -> float | None:
    value = re.sub(r"\b(?:rm|usd|cad|gbp)\b", "", raw.lower())
    value = re.sub(r"[\s$€£()]", "", value)
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


def amount_key(raw: str) -> str | None:
    value = parse_amount(raw)
    return f"{value:.2f}" if value is not None else None


def valid_date(year: int, month: int, day: int) -> str | None:
    import datetime

    try:
        return datetime.date(year, month, day).isoformat()
    except ValueError:
        return None


def date_value(raw: str) -> str | None:
    text = normalize_line(raw).replace(" ,", ",")
    match = re.fullmatch(r"(\d{1,2})[/. -](\d{1,2})[/. -](20\d{2}|\d{2})", text)
    if match:
        first, second = int(match.group(1)), int(match.group(2))
        year = int(match.group(3)) if len(match.group(3)) == 4 else 2000 + int(match.group(3))
        if first <= 12 and second <= 12:
            return None
        return valid_date(year, second, first) if first > 12 else valid_date(year, first, second)
    match = re.fullmatch(r"([A-Za-z]+)\s+(\d{1,2})(?:,\s*|\s+)(20\d{2})", text)
    if match:
        return valid_date(int(match.group(3)), MONTHS.get(match.group(1).lower(), 0), int(match.group(2)))
    match = re.fullmatch(r"(\d{1,2})\s+([A-Za-z]+)\s+(20\d{2})", text)
    if match:
        return valid_date(int(match.group(3)), MONTHS.get(match.group(2).lower(), 0), int(match.group(1)))
    match = re.fullmatch(r"(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})", text)
    if match:
        return valid_date(int(match.group(1)), int(match.group(2)), int(match.group(3)))
    return None


def label_date_value(raw: str) -> str | None:
    """SROIE labels are day-first even when the numeric date is ambiguous."""
    text = normalize_line(raw)
    match = re.fullmatch(r"(\d{1,2})[/. -](\d{1,2})[/. -](20\d{2}|\d{2})", text)
    if match:
        year = int(match.group(3)) if len(match.group(3)) == 4 else 2000 + int(match.group(3))
        return valid_date(year, int(match.group(2)), int(match.group(1)))
    return date_value(text)


def has_keyword(text: str) -> bool:
    lowered = text.lower()
    return any(word in lowered if "-" in word else re.search(rf"\b{re.escape(word)}\b", lowered) for word in KEYWORDS)


def label_score(field: str, text: str) -> float:
    lowered = text.lower()
    if field == "vendor":
        return 0.0
    patterns = {
        "purchase_date": r"\b(?:date|time|issued|invoice)\b",
        "subtotal": r"\b(?:sub[ -]?total|before\s+tax|total\s+sales\s+excluding)\b",
        "tax": r"\b(?:tax|gst|hst|vat|sales\s+tax|tax\s+amount)\b",
        "total": r"\b(?:grand\s+total|total\s+due|amount\s+due|balance\s+due|final\s+total|payable|total)\b",
    }
    if not re.search(patterns[field], lowered):
        return 0.0
    if field == "total":
        if re.search(r"\b(?:grand\s+total|total\s+due|amount\s+due|balance\s+due|final\s+total|payable)\b", lowered): return 1.0
        if re.search(r"\btotal\s+(?:sales\s+)?(?:inclusive|after|inc)", lowered): return 0.85
        return 0.7
    if field == "subtotal": return 1.0 if re.search(r"\bsub[ -]?total\b", lowered) else 0.8
    if field == "tax": return 1.0 if re.search(r"\b(?:tax|gst|hst|vat|sales\s+tax)\b", lowered) else 0.7
    return 1.0


def geometry(line: dict[str, Any], index: int) -> dict[str, Any]:
    bbox = line.get("bbox") or {"x0": 0, "y0": index, "x1": 1, "y1": index + 1}
    x0, x1 = sorted((float(bbox.get("x0", 0)), float(bbox.get("x1", 1))))
    y0, y1 = sorted((float(bbox.get("y0", index)), float(bbox.get("y1", index + 1))))
    points = line.get("polygon")
    if not isinstance(points, list) or len(points) < 4:
        points = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
    try:
        points = [[float(point[0]), float(point[1])] for point in points if len(point) >= 2]
    except (TypeError, ValueError):
        points = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
    if len(points) < 4:
        points = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
    height = max(1.0, max(point[1] for point in points) - min(point[1] for point in points))
    top = (points[0][1] + points[1][1]) / 2
    bottom = (points[2][1] + points[3][1]) / 2
    left = (points[0][0] + points[3][0]) / 2
    right = (points[1][0] + points[2][0]) / 2
    skew = max(-1.0, min(1.0, (points[1][1] - points[0][1] + points[2][1] - points[3][1]) / max(1.0, height * 2)))
    tilt = max(-1.0, min(1.0, (top - bottom) / height + (right - left) / max(1.0, height * 20)))
    return {
        "text": normalize_line(str(line.get("text", ""))), "x0": x0, "x1": x1, "y0": y0, "y1": y1,
        "center_x": (x0 + x1) / 2, "center_y": (y0 + y1) / 2, "width": x1 - x0, "height": y1 - y0,
        "area": max(0.0, x1 - x0) * max(0.0, y1 - y0), "confidence": float(line.get("confidence", 75) or 75),
        "skew": skew, "tilt": tilt, "sort_y": y0, "sort_height": y1 - y0,
    }


def normalized_lines(raw_lines: list[dict[str, Any]]) -> list[dict[str, Any]]:
    source = [geometry(line, index) for index, line in enumerate(raw_lines)]
    source = [line for line in source if line["text"]]
    min_x = min([line["x0"] for line in source] + [0.0])
    min_y = min([line["y0"] for line in source] + [0.0])
    max_x = max([line["x1"] for line in source] + [1.0])
    max_y = max([line["y1"] for line in source] + [1.0])
    page_width = max(1.0, max_x - min_x)
    page_height = max(1.0, max_y - min_y)
    for line in source:
        line["x0"] = (line["x0"] - min_x) / page_width
        line["x1"] = (line["x1"] - min_x) / page_width
        line["y0"] = (line["y0"] - min_y) / page_height
        line["y1"] = (line["y1"] - min_y) / page_height
        line["center_x"] = (line["center_x"] - min_x) / page_width
        line["center_y"] = (line["center_y"] - min_y) / page_height
        line["width"] /= page_width
        line["height"] /= page_height
        line["area"] = line["width"] * line["height"]
    def reading_order(left: dict[str, Any], right: dict[str, Any]) -> int:
        row_height = max(left["sort_y"] + left["sort_height"], right["sort_y"] + right["sort_height"]) - min(left["sort_y"], right["sort_y"])
        if abs(left["sort_y"] - right["sort_y"]) <= max(8.0, row_height * 0.4):
            return -1 if left["x0"] < right["x0"] else 1 if left["x0"] > right["x0"] else 0
        return -1 if left["sort_y"] < right["sort_y"] else 1 if left["sort_y"] > right["sort_y"] else 0

    source.sort(key=cmp_to_key(reading_order))
    return source


def feature_vector(lines: list[dict[str, Any]], index: int, field: str, raw_amount: str | None, frequency: int, repeated: bool) -> list[float]:
    line = lines[index]
    previous = lines[index - 1] if index else None
    following = lines[index + 1] if index + 1 < len(lines) else None
    text = line["text"]
    previous_text = previous["text"] if previous else ""
    following_text = following["text"] if following else ""
    amounts = AMOUNT_RE.findall(text)
    dates = DATE_RE.findall(text)
    label = label_score(field, text)
    previous_label = label_score(field, previous_text)
    next_label = label_score(field, following_text)
    position = max(0, text.find(raw_amount)) / max(1, len(text)) if raw_amount else 0.0
    confidence = line["confidence"] / 100 if line["confidence"] > 1 else line["confidence"]
    values = [
        index / max(1, len(lines) - 1), (index + 1) / max(1, len(lines)), line["x0"], line["x1"], line["center_x"],
        line["y0"], line["y1"], line["center_y"], line["width"], line["height"], min(1.0, line["area"] * 8),
        line["x0"], 1 - line["x1"], line["y0"], 1 - line["y1"], max(0.0, min(1.0, confidence)),
        min(len(text), 80) / 80, sum(character.isalpha() for character in text) / max(1, len(text)),
        sum(character.isdigit() for character in text) / max(1, len(text)), min(1.0, len(amounts) / 4),
        float(bool(amounts)), float(bool(dates)), float(bool(re.search(r"[$€£]|\b(?:rm|usd|cad|gbp)\b", text, re.I))),
        label, previous_label, next_label, float(has_keyword(text)), float(has_keyword(previous_text)), float(has_keyword(following_text)),
        float(bool(AMOUNT_RE.search(previous_text))), float(bool(AMOUNT_RE.search(following_text))),
        float(bool(DATE_RE.search(previous_text))), float(bool(DATE_RE.search(following_text))), position,
        float(position >= 0.5), float(bool(raw_amount and position >= 0.65)),
        max(0.0, line["y0"] - previous["y1"]) if previous else 0.0,
        max(0.0, following["y0"] - line["y1"]) if following else 0.0,
        float(bool(previous and abs(line["x0"] - previous["x0"]) <= 0.12)),
        float(bool(following and abs(line["x0"] - following["x0"]) <= 0.12)), float(repeated), min(1.0, frequency / 4),
        max(label, previous_label * 0.95, next_label * 0.9), float(line["center_y"] >= 0.8), float(line["center_y"] <= 0.22),
        float(bool(raw_amount and (position >= 0.5 or line["x1"] >= 0.8))), line["skew"], line["tilt"],
    ]
    if len(values) != len(FEATURE_NAMES):
        raise RuntimeError(f"feature schema mismatch: {len(values)} != {len(FEATURE_NAMES)}")
    return values


def candidate_rows(raw_lines: list[dict[str, Any]], field: str, label: dict[str, Any]) -> list[dict[str, Any]]:
    lines = normalized_lines(raw_lines)
    candidates: list[dict[str, Any]] = []
    if field == "vendor":
        for index, line in enumerate(lines[:14]):
            text = line["text"]
            letters = sum(character.isalpha() for character in text)
            if letters < 3 or letters / max(1, len(text)) < 0.35 or len(text) > 80:
                continue
            if re.search(r"^(?:store|shop)$|\b(?:receipt|invoice|subtotal|sub-total|total|tax|gst|hst|date|cashier|address|tel|phone|thank|change|tender)\b", text, re.I) or AMOUNT_RE.search(text):
                continue
            expected = normalize(str(label.get("company", "")))
            candidate = normalize(text)
            # Autonomous vendor trust is intentionally stricter than fuzzy
            # retrieval.  A typo-tolerant candidate may be useful in review,
            # but it is not a positive for a high-precision browser gate.
            candidates.append({"index": index, "value": text, "canonical": candidate, "raw_amount": None, "positive": bool(expected and (expected in candidate or candidate in expected))})
    elif field == "purchase_date":
        expected = label_date_value(str(label.get("date", ""))) or None
        for index, line in enumerate(lines):
            for raw in DATE_RE.findall(line["text"]):
                value = date_value(raw)
                if value:
                    candidates.append({"index": index, "value": value, "canonical": value, "raw_amount": None, "positive": value == expected})
    else:
        expected = parse_amount(str(label.get("total", ""))) if field == "total" else None
        for index, line in enumerate(lines):
            for raw in AMOUNT_RE.findall(line["text"]):
                key = amount_key(raw)
                if key is None:
                    continue
                positive = bool(field == "total" and expected is not None and abs(float(key) - expected) < 0.011)
                if field == "subtotal": positive = label_score(field, line["text"]) >= 0.65 or label_score(field, lines[index - 1]["text"] if index else "") >= 0.65 or label_score(field, lines[index + 1]["text"] if index + 1 < len(lines) else "") >= 0.65
                if field == "tax": positive = label_score(field, line["text"]) >= 0.65 or label_score(field, lines[index - 1]["text"] if index else "") >= 0.65 or label_score(field, lines[index + 1]["text"] if index + 1 < len(lines) else "") >= 0.65
                candidates.append({"index": index, "value": raw.replace(" ", ""), "canonical": key, "raw_amount": raw, "positive": positive})
    frequencies: dict[str, int] = {}
    for candidate in candidates:
        frequencies[candidate["canonical"]] = frequencies.get(candidate["canonical"], 0) + 1
    for candidate in candidates:
        candidate["features"] = feature_vector(
            lines, candidate["index"], field, candidate["raw_amount"], frequencies[candidate["canonical"]], frequencies[candidate["canonical"]] > 1,
        )
        candidate.setdefault("positive", False)
    return candidates


def sigmoid(value: float) -> float:
    return 1.0 / (1.0 + math.exp(-max(-40.0, min(40.0, value))))


def logistic_probability(weights: list[float], features: list[float]) -> float:
    return sigmoid(weights[0] + sum(weight * value for weight, value in zip(weights[1:], features)))


def train_logistic(rows: list[dict[str, Any]], epochs: int = 180) -> list[float]:
    dimension = len(FEATURE_NAMES)
    if not rows:
        return [0.0] * (dimension + 1)
    weights = [0.0] * (dimension + 1)
    positives = max(1, sum(bool(row["positive"]) for row in rows))
    negatives = max(1, len(rows) - positives)
    positive_weight = len(rows) / (2 * positives)
    negative_weight = len(rows) / (2 * negatives)
    for epoch in range(epochs):
        gradient = [0.0] * (dimension + 1)
        for row in rows:
            values = [1.0] + row["features"]
            target = float(bool(row["positive"]))
            error = (logistic_probability(weights, row["features"]) - target) * (positive_weight if target else negative_weight)
            for position, value in enumerate(values):
                gradient[position] += error * value
        learning_rate = 0.10 * (1.0 - 0.45 * epoch / epochs)
        for position in range(len(weights)):
            regularization = 0.002 * weights[position] if position else 0.0
            weights[position] -= learning_rate * (gradient[position] / len(rows) + regularization)
    return weights


def gini(rows: list[dict[str, Any]]) -> float:
    if not rows:
        return 0.0
    positive = sum(bool(row["positive"]) for row in rows) / len(rows)
    return 1 - positive * positive - (1 - positive) * (1 - positive)


def stump_forest(rows: list[dict[str, Any]], trees: int = 12) -> list[dict[str, float | int]]:
    if not rows:
        return []
    forest: list[dict[str, float | int]] = []
    for tree in range(trees):
        sampled = [rows[(position * 17 + tree * 31) % len(rows)] for position in range(len(rows))]
        choices = [(feature, threshold) for feature in range(len(FEATURE_NAMES)) for threshold in (0.25, 0.5, 0.75)]
        feature, threshold = min(choices, key=lambda choice: _split_cost(sampled, choice[0], choice[1]))
        left = [row for row in sampled if row["features"][feature] < threshold]
        right = [row for row in sampled if row["features"][feature] >= threshold]
        forest.append({"feature": feature, "threshold": threshold, "left": _rate(left), "right": _rate(right)})
    return forest


def _split_cost(rows: list[dict[str, Any]], feature: int, threshold: float) -> float:
    left = [row for row in rows if row["features"][feature] < threshold]
    right = [row for row in rows if row["features"][feature] >= threshold]
    return len(left) * gini(left) + len(right) * gini(right)


def _rate(rows: list[dict[str, Any]]) -> float:
    return (sum(bool(row["positive"]) for row in rows) + 1) / (len(rows) + 2)


def forest_probability(forest: list[dict[str, float | int]], features: list[float]) -> float:
    if not forest:
        return 0.0
    return sum(float(tree["left"] if features[int(tree["feature"])] < float(tree["threshold"]) else tree["right"]) for tree in forest) / len(forest)


def scored_documents(documents: dict[str, list[list[dict[str, Any]]]], model_type: str, model: Any, split: str) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    for candidates in documents.get(split, []):
        scored = []
        for row in candidates:
            probability = logistic_probability(model, row["features"]) if model_type == "logistic" else forest_probability(model, row["features"])
            scored.append({**row, "probability": probability})
        if not scored:
            continue
        scored.sort(key=lambda row: row["probability"], reverse=True)
        output.append({
            "probability": scored[0]["probability"], "margin": scored[0]["probability"] - (scored[1]["probability"] if len(scored) > 1 else 0),
            "positive": bool(scored[0]["positive"]), "candidate_count": len(scored),
        })
    return output


def choose_gate(scores: list[dict[str, Any]], required_precision: float = 1.0) -> dict[str, float]:
    if not scores:
        return {"threshold": 0.995, "margin": 0.10, "coverage": 0.0, "precision": 0.0, "trusted": 0.0}
    thresholds = sorted({0.5, 0.6, 0.7, 0.8, 0.85, 0.9, 0.92, 0.94, 0.96, 0.98, 0.99, 0.995} | {round(float(row["probability"]), 4) for row in scores})
    margins = (0.0, 0.01, 0.02, 0.04, 0.06, 0.08, 0.10, 0.15)
    best = {"threshold": 0.995, "margin": 0.10, "coverage": 0.0, "precision": 0.0, "trusted": 0.0}
    for threshold in thresholds:
        for margin in margins:
            accepted = [row for row in scores if row["probability"] >= threshold and row["margin"] >= margin]
            if not accepted:
                continue
            precision = sum(bool(row["positive"]) for row in accepted) / len(accepted)
            coverage = len(accepted) / max(1, len(scores))
            if precision >= required_precision and (coverage > best["coverage"] or coverage == best["coverage"] and threshold < best["threshold"]):
                best = {"threshold": threshold, "margin": margin, "coverage": coverage, "precision": precision, "trusted": float(len(accepted))}
    return best


def calibration(scores: list[dict[str, Any]]) -> list[dict[str, float]]:
    points = []
    bounds = (0.0, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 0.98, 0.99)
    for position, lower in enumerate(bounds):
        upper = bounds[position + 1] if position + 1 < len(bounds) else 1.01
        bucket = [row for row in scores if lower <= row["probability"] < upper]
        accuracy = sum(bool(row["positive"]) for row in bucket) / len(bucket) if bucket else 0.0
        points.append({"max": min(1.0, upper), "accuracy": accuracy})
    return points


def accepted_region_calibration(gate: dict[str, float], scores: list[dict[str, Any]]) -> list[dict[str, float]]:
    """Calibrate the only region the browser may trust.

    Raw logistic probabilities are intentionally not exposed as confidence:
    the candidate scorer is trained on a highly imbalanced candidate set and
    is overconfident outside the accepted region.  The final interval is the
    empirical validation precision of the frozen threshold/margin gate.
    """
    accepted = [row for row in scores if row["probability"] >= gate["threshold"] and row["margin"] >= gate["margin"]]
    accepted_precision = sum(bool(row["positive"]) for row in accepted) / len(accepted) if accepted else 0.0
    return [
        {"max": min(1.0, gate["threshold"]), "accuracy": 0.0},
        {"max": 1.0, "accuracy": accepted_precision},
    ]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, default=Path("benchmarks/receipt-modern-ocr-sroie-all-v6.json"))
    parser.add_argument("--labels", type=Path, default=Path("benchmarks/sroie500/labels"))
    parser.add_argument("--output", type=Path, default=Path("src/lib/receiptPpocrV6FieldModel.json"))
    args = parser.parse_args()
    benchmark = json.loads(args.input.read_text())
    rows = benchmark["engines"]["paddleocr-js-ppocrv6-tiny"]["rows"]
    documents: dict[str, dict[str, list[dict[str, Any]]]] = {field: {split: [] for split in ("tuning", "validation", "final")} for field in FIELDS}
    labels: dict[int, dict[str, Any]] = {}
    for row in rows:
        index = int(row["id"])
        with (args.labels / f"{index:03d}.json").open() as handle:
            labels[index] = json.load(handle)
        for field in FIELDS:
            documents[field][split_for(index)].append(candidate_rows(row.get("lines", []), field, labels[index]))

    models: dict[str, dict[str, Any]] = {}
    comparison: dict[str, Any] = {}
    for field in FIELDS:
        training = [candidate for document in documents[field]["tuning"] for candidate in document]
        logistic = train_logistic(training)
        forest = stump_forest(training)
        logistic_scores = scored_documents(documents[field], "logistic", logistic, "validation")
        forest_scores = scored_documents(documents[field], "forest", forest, "validation")
        gate = choose_gate(logistic_scores, 1.0 if field in ("vendor", "purchase_date", "total") else 0.95)
        comparison[field] = {
            "training_candidates": len(training), "training_positive_candidates": sum(bool(row["positive"]) for row in training),
            "logistic_validation": {**gate, "candidates": len(logistic_scores)},
            "stump_forest_validation": {**choose_gate(forest_scores, 1.0 if field in ("vendor", "purchase_date", "total") else 0.95), "candidates": len(forest_scores)},
        }
        models[field] = {
            "type": "logistic", "weights": [round(weight, 8) for weight in logistic],
            "threshold": gate["threshold"], "min_margin": gate["margin"],
            "min_confidence": 0.95 if field in ("subtotal", "tax") else 0.98,
            "calibration": accepted_region_calibration(gate, logistic_scores),
        }

    output = {
        "version": 1, "engine": "paddleocr-js-ppocrv6-tiny",
        "dataset": "ICDAR 2019 SROIE labels with PP-OCRv6 tiny polygon-line cache; tuning split only for coefficients",
        "feature_names": list(FEATURE_NAMES), "fields": models, "training_comparison": comparison,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, separators=(",", ":")) + "\n")
    print(json.dumps(comparison, indent=2))


if __name__ == "__main__":
    main()
