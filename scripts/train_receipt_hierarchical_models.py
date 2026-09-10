#!/usr/bin/env python3
"""Train the privacy-safe hierarchical PP-OCRv6 router and specialists.

The input is the existing local PP-OCRv6 band cache.  It is intentionally
ignored by git.  SROIE receipt ids are split as groups before any crop or band
is made, so overlapping OCR observations cannot leak across train/validation/
final.  The output contains only tiny logistic models and aggregate metrics.

SROIE labels expose vendor/date/total.  Subtotal/tax, receipt-id, and item
labels are weak labels derived from explicit OCR labels/shape signals and are
reported as such; they are not used to claim field accuracy that the corpus
cannot establish.
"""

from __future__ import annotations

import argparse
import json
import math
import re
from pathlib import Path
from typing import Any


CATEGORIES = ("vendor", "purchase_date", "subtotal", "tax", "total", "receipt_id", "item", "other")
SPECIALISTS = CATEGORIES[:-1]
FIELDS = ("vendor", "purchase_date", "subtotal", "tax", "total")
KNOWN_FIELDS = ("vendor", "purchase_date", "total")
DUPLICATE_GROUP = {12: 12, 15: 12, 16: 12, 18: 12, 277: 277, 452: 277}

ROUTER_FEATURE_NAMES = (
    "band_top", "band_bottom", "band_center", "band_height", "line_count", "line_count_density",
    "mean_confidence", "min_confidence", "mean_line_height", "mean_line_width", "text_density",
    "alpha_ratio", "digit_ratio", "amount_line_fraction", "date_line_fraction", "currency_line_fraction",
    "keyword_vendor", "keyword_date", "keyword_subtotal", "keyword_tax", "keyword_total",
    "keyword_receipt_id", "keyword_item", "top_line_fraction", "bottom_line_fraction",
    "right_aligned_fraction", "wide_line_fraction", "sparse_gap_fraction", "non_empty_fraction",
    "candidate_vendor", "candidate_date", "candidate_subtotal", "candidate_tax", "candidate_total",
    "candidate_receipt_id", "candidate_item",
)

EXPERT_FEATURE_NAMES = (
    "rank_fraction", "relative_top", "relative_bottom", "x0", "x1", "center_x", "width", "height",
    "line_confidence", "text_length", "alpha_ratio", "digit_ratio", "amount_count", "date_count",
    "currency", "category_keyword", "previous_category_keyword", "next_category_keyword",
    "previous_amount", "next_amount", "previous_date", "next_date", "amount_position",
    "amount_right_half", "right_aligned", "gap_previous", "gap_next", "router_probability",
    "top_region", "bottom_region", "long_text", "strong_label",
)

AMOUNT_RE = re.compile(r"(?:[$€£]|\b(?:rm|usd|cad|gbp)\b)?\s*\(?\s*-?\d{1,6}(?:[,.]\d{3})*(?:[,.]\d{2})\s*\)?", re.I)
DATE_RE = re.compile(
    r"\b(?:20\d{2}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.](?:20)?\d{2}|"
    r"(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|"
    r"aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:,?\s+)20\d{2})\b",
    re.I,
)
KEYWORDS = {
    "vendor": re.compile(r"\b(?:store|shop|market|mart|inc|ltd|llc|corp|co|berhad|sdn)\b", re.I),
    "purchase_date": re.compile(r"\b(?:date|time|issued|invoice)\b|\b\d{1,2}[/. -]\d{1,2}[/. -](?:20)?\d{2}\b", re.I),
    "subtotal": re.compile(r"\b(?:sub[ -]?total|before\s+tax|excluding)\b", re.I),
    "tax": re.compile(r"\b(?:tax|gst|hst|vat|sales\s+tax)\b", re.I),
    "total": re.compile(r"\b(?:grand\s+total|total\s+due|amount\s+due|balance\s+due|payable|final\s+total|total)\b", re.I),
    "receipt_id": re.compile(r"\b(?:invoice|receipt|order|transaction|trans|reference|ref|id|no\.?|number)\b", re.I),
    "item": re.compile(r"\b(?:item|qty|quantity|price|sku|product|description|unit)\b", re.I),
    "other": re.compile(r"$^"),
}


def split_for(index: int) -> str:
    representative = DUPLICATE_GROUP.get(index, index)
    return "tuning" if representative < 300 else "validation" if representative < 400 else "final"


def normalize(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", value.lower())


def text(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "").replace("|", " ").replace("¦", " ")).strip()


def amount_value(raw: str) -> float | None:
    value = re.sub(r"\b(?:rm|usd|cad|gbp)\b", "", raw.lower())
    value = re.sub(r"[\s$€£()]", "", value)
    comma, dot = value.rfind(","), value.rfind(".")
    value = value.replace(".", "").replace(",", ".") if comma > dot else value.replace(",", "")
    try:
        parsed = float(value)
    except ValueError:
        return None
    return parsed if 0 <= parsed < 1_000_000 else None


def amount_key(raw: str) -> str | None:
    value = amount_value(raw)
    return f"{value:.2f}" if value is not None else None


def date_key(raw: str) -> str | None:
    value = text(raw)
    match = re.fullmatch(r"(\d{1,2})[/. -](\d{1,2})[/. -](20\d{2}|\d{2})", value)
    if match:
        first, second = int(match.group(1)), int(match.group(2))
        year = int(match.group(3)) if len(match.group(3)) == 4 else 2000 + int(match.group(3))
        if first <= 12 and second <= 12:
            return None
        day, month = (first, second) if first > 12 else (second, first)
        if 1 <= month <= 12 and 1 <= day <= 31:
            return f"{year:04d}-{month:02d}-{day:02d}"
    months = {"jan": 1, "january": 1, "feb": 2, "february": 2, "mar": 3, "march": 3, "apr": 4, "april": 4, "may": 5, "jun": 6, "june": 6, "jul": 7, "july": 7, "aug": 8, "august": 8, "sep": 9, "sept": 9, "september": 9, "oct": 10, "october": 10, "nov": 11, "november": 11, "dec": 12, "december": 12}
    match = re.fullmatch(r"([A-Za-z]+)\s+(\d{1,2})(?:,\s*|\s+)(20\d{2})", value)
    if match and match.group(1).lower() in months:
        return f"{int(match.group(3)):04d}-{months[match.group(1).lower()]:02d}-{int(match.group(2)):02d}"
    return None


def label_date(raw: str) -> str | None:
    value = text(raw)
    match = re.fullmatch(r"(\d{1,2})[/. -](\d{1,2})[/. -](20\d{2}|\d{2})", value)
    if not match:
        return date_key(value)
    year = int(match.group(3)) if len(match.group(3)) == 4 else 2000 + int(match.group(3))
    return f"{year:04d}-{int(match.group(2)):02d}-{int(match.group(1)):02d}"


def confidence(line: dict[str, Any]) -> float:
    value = float(line.get("confidence", 75) or 75)
    return max(0.0, min(1.0, value / 100 if value > 1 else value))


def box(line: dict[str, Any], index: int) -> dict[str, float]:
    raw = line.get("bbox") or {"x0": 0, "y0": index, "x1": 1, "y1": index + 1}
    x0, x1 = sorted((float(raw.get("x0", 0)), float(raw.get("x1", 1))))
    y0, y1 = sorted((float(raw.get("y0", index)), float(raw.get("y1", index + 1))))
    return {"x0": x0, "y0": y0, "x1": x1, "y1": y1, "width": max(1.0, x1 - x0), "height": max(1.0, y1 - y0), "cx": (x0 + x1) / 2, "cy": (y0 + y1) / 2}


def dimensions(lines: list[dict[str, Any]], groups: list[dict[str, Any]] | None = None) -> tuple[float, float]:
    boxes = [box(line, index) for index, line in enumerate(lines)]
    return max([1.0] + [item["x1"] for item in boxes] + [float(group.get("width", 0)) for group in (groups or [])]), max([1.0] + [item["y1"] for item in boxes] + [float(group.get("bottom", 0)) for group in (groups or [])])


def stats(lines: list[dict[str, Any]], width: float, height: float) -> dict[str, Any]:
    lines = [line for line in lines if text(line.get("text"))]
    boxes = [box(line, index) for index, line in enumerate(lines)]
    heights = sorted(item["height"] for item in boxes)
    median_height = heights[len(heights) // 2] if heights else 1.0
    values = [confidence(line) for line in lines]
    amount_lines = sum(bool(AMOUNT_RE.search(text(line.get("text")))) for line in lines)
    date_lines = sum(bool(DATE_RE.search(text(line.get("text")))) for line in lines)
    currency_lines = sum(bool(re.search(r"[$€£]|\b(?:rm|usd|cad|gbp)\b", text(line.get("text")), re.I)) for line in lines)
    sorted_y = sorted(item["cy"] for item in boxes)
    gaps = [right - left for left, right in zip(sorted_y, sorted_y[1:])]
    return {
        "lines": lines, "boxes": boxes, "median_height": median_height,
        "mean_confidence": sum(values) / len(values) if values else 0.0,
        "min_confidence": min(values) if values else 0.0,
        "amount_lines": amount_lines, "date_lines": date_lines, "currency_lines": currency_lines,
        "sorted_y": sorted_y, "gaps": gaps,
        "text_length": sum(len(text(line.get("text"))) for line in lines),
        "top_lines": sum(item["cy"] / height < 0.24 for item in boxes),
        "bottom_lines": sum(item["cy"] / height > 0.76 for item in boxes),
        "right_aligned": sum(item["x1"] / width >= 0.78 for item in boxes),
        "wide_lines": sum(item["width"] / width > 0.72 for item in boxes),
        "sparse_gaps": sum(gap > median_height * 2.5 for gap in gaps),
    }


def router_features(group: dict[str, Any], width: float, height: float) -> list[float]:
    s = stats(group["lines"], width, height)
    lines, count = s["lines"], len(s["lines"])
    mean_width = sum(item["width"] / width for item in s["boxes"]) / count if count else 0
    alpha = sum(sum(ch.isalpha() for ch in text(line.get("text"))) / max(1, len(text(line.get("text")))) for line in lines) / count if count else 0
    digit = sum(sum(ch.isdigit() for ch in text(line.get("text"))) / max(1, len(text(line.get("text")))) for line in lines) / count if count else 0
    keyword = lambda category: sum(bool(KEYWORDS[category].search(text(line.get("text")))) for line in lines) / max(1, count)
    candidate = lambda category: (
        any(index < 8 and sum(char.isalpha() for char in text(line.get("text"))) >= 3 and sum(char.isalpha() for char in text(line.get("text"))) / max(1, len(text(line.get("text")))) >= 0.35 and not AMOUNT_RE.search(text(line.get("text"))) for index, line in enumerate(lines)) if category == "vendor" else
        bool(s["date_lines"]) if category == "purchase_date" else
        (bool(KEYWORDS[category].search(" ".join(text(line.get("text")) for line in lines))) and bool(s["amount_lines"])) if category in ("subtotal", "tax", "total") else
        any(KEYWORDS[category].search(text(line.get("text"))) and re.search(r"[A-Z0-9]{3,}", text(line.get("text")), re.I) for line in lines) if category == "receipt_id" else
        bool(KEYWORDS[category].search(" ".join(text(line.get("text")) for line in lines)) or s["amount_lines"] >= 3) if category == "item" else False
    )
    density = count / max(1.0, (float(group["height"]) / max(1.0, s["median_height"])))
    return [
        float(group["top"]) / height, float(group["bottom"]) / height, (float(group["top"]) + float(group["bottom"])) / 2 / height,
        float(group["height"]) / height, min(1.0, count / 16), min(1.0, density), s["mean_confidence"], s["min_confidence"],
        min(1.0, s["median_height"] / height * 25), min(1.0, mean_width * 2), min(1.0, s["text_length"] / max(1.0, float(group["width"]) * float(group["height"])) * 1800),
        alpha, digit, s["amount_lines"] / max(1, count), s["date_lines"] / max(1, count), s["currency_lines"] / max(1, count),
        keyword("vendor"), keyword("purchase_date"), keyword("subtotal"), keyword("tax"), keyword("total"), keyword("receipt_id"), keyword("item"),
        s["top_lines"] / max(1, count), s["bottom_lines"] / max(1, count), s["right_aligned"] / max(1, count), s["wide_lines"] / max(1, count),
        s["sparse_gaps"] / max(1, len(s["gaps"])), 1.0 if count else 0.0,
        float(candidate("vendor")), float(candidate("purchase_date")), float(candidate("subtotal")), float(candidate("tax")), float(candidate("total")), float(candidate("receipt_id")), float(candidate("item")),
    ]


def category_label(category: str, lines: list[dict[str, Any]], label: dict[str, Any]) -> bool:
    joined = " ".join(text(line.get("text")) for line in lines)
    if category == "vendor":
        expected = normalize(str(label.get("company", "")))
        return bool(expected and any(expected in normalize(text(line.get("text"))) or normalize(text(line.get("text"))) in expected for line in lines if text(line.get("text"))))
    if category == "purchase_date":
        expected = label_date(str(label.get("date", "")))
        return bool(expected and any(expected == date_key(raw) for line in lines for raw in DATE_RE.findall(text(line.get("text")))))
    if category == "total":
        expected = amount_value(str(label.get("total", "")))
        return expected is not None and any(abs((amount_value(raw) or -999999) - expected) < 0.011 for line in lines for raw in AMOUNT_RE.findall(text(line.get("text"))))
    if category in ("subtotal", "tax"):
        return bool(KEYWORDS[category].search(joined) and AMOUNT_RE.search(joined))
    if category == "receipt_id":
        return bool(KEYWORDS[category].search(joined) and re.search(r"[A-Z0-9]{3,}", joined, re.I))
    if category == "item":
        amount_count = sum(bool(AMOUNT_RE.search(text(line.get("text")))) for line in lines)
        return bool(KEYWORDS[category].search(joined) or amount_count >= 3)
    return not any(category_label(other, lines, label) for other in SPECIALISTS)


def row_groups(row: dict[str, Any]) -> list[dict[str, Any]]:
    groups: dict[str, list[dict[str, Any]]] = {}
    for line in row.get("observations", []):
        key = str(line.get("observationKey", ""))
        groups.setdefault(key, []).append(line)
    all_lines = [line for lines in groups.values() for line in lines]
    width, height = dimensions(all_lines)
    result = []
    for key, lines in groups.items():
        top = min([float(line.get("bandTop", 0)) for line in lines] or [0.0])
        bottom = max([float(line.get("bandBottom", height)) for line in lines] + [1.0])
        result.append({"key": key, "band_index": int(lines[0].get("bandIndex", -1)), "top": top, "bottom": bottom, "height": max(1.0, bottom - top), "width": width, "lines": lines})
    return result


def sigmoid(value: float) -> float:
    return 1.0 / (1.0 + math.exp(-max(-40.0, min(40.0, value))))


def logistic_train(rows: list[dict[str, Any]], epochs: int = 180) -> list[float]:
    dimension = len(ROUTER_FEATURE_NAMES) if rows and len(rows[0]["features"]) == len(ROUTER_FEATURE_NAMES) else len(EXPERT_FEATURE_NAMES)
    weights = [0.0] * (dimension + 1)
    if not rows:
        return weights
    positives = max(1, sum(bool(row["positive"]) for row in rows))
    negatives = max(1, len(rows) - positives)
    positive_weight, negative_weight = len(rows) / (2 * positives), len(rows) / (2 * negatives)
    for epoch in range(epochs):
        gradient = [0.0] * len(weights)
        for row in rows:
            values = [1.0] + row["features"]
            probability = sigmoid(sum(weight * value for weight, value in zip(weights, values)))
            target = float(bool(row["positive"]))
            error = (probability - target) * (positive_weight if target else negative_weight)
            for index, value in enumerate(values):
                gradient[index] += error * value
        rate = 0.09 * (1.0 - 0.35 * epoch / epochs)
        for index in range(len(weights)):
            weights[index] -= rate * (gradient[index] / len(rows) + (0.002 * weights[index] if index else 0))
    return weights


def forest_train(rows: list[dict[str, Any]], trees: int = 20) -> list[dict[str, float | int]]:
    if not rows:
        return []
    choices = [(feature, threshold) for feature in range(len(rows[0]["features"])) for threshold in (0.15, 0.3, 0.5, 0.7, 0.85)]
    def rate(group: list[dict[str, Any]]) -> float:
        return (sum(bool(row["positive"]) for row in group) + 1) / (len(group) + 2)
    def gini(group: list[dict[str, Any]]) -> float:
        if not group:
            return 0.0
        positive = sum(bool(row["positive"]) for row in group) / len(group)
        return 1 - positive * positive - (1 - positive) * (1 - positive)
    forest = []
    for tree in range(trees):
        sampled = [rows[(index * 17 + tree * 31) % len(rows)] for index in range(len(rows))]
        feature, threshold = min(choices, key=lambda choice: (
            len([row for row in sampled if row["features"][choice[0]] < choice[1]]) * gini([row for row in sampled if row["features"][choice[0]] < choice[1]])
            + len([row for row in sampled if row["features"][choice[0]] >= choice[1]]) * gini([row for row in sampled if row["features"][choice[0]] >= choice[1]])
        ))
        left = [row for row in sampled if row["features"][feature] < threshold]
        right = [row for row in sampled if row["features"][feature] >= threshold]
        forest.append({"feature": feature, "threshold": threshold, "left": rate(left), "right": rate(right)})
    return forest


def boosted_train(rows: list[dict[str, Any]], rounds: int = 20) -> list[dict[str, float | int]]:
    if not rows:
        return []
    choices = [(feature, threshold, polarity) for feature in range(len(rows[0]["features"])) for threshold in (0.2, 0.4, 0.6, 0.8) for polarity in (-1, 1)]
    weights = [1.0 / len(rows)] * len(rows)
    result = []
    for _ in range(rounds):
        error, best = min(((sum(weights[index] for index, row in enumerate(rows) if ((1 if row["features"][feature] >= threshold else -1) * polarity > 0) != bool(row["positive"])), (feature, threshold, polarity)) for feature, threshold, polarity in choices), key=lambda item: item[0])
        error = min(0.499, max(1e-6, error))
        alpha = 0.5 * math.log((1 - error) / error)
        feature, threshold, polarity = best
        for index, row in enumerate(rows):
            prediction = 1 if (1 if row["features"][feature] >= threshold else -1) * polarity > 0 else -1
            target = 1 if row["positive"] else -1
            weights[index] *= math.exp(-alpha * target * prediction)
        total = sum(weights)
        weights = [value / total for value in weights]
        result.append({"feature": feature, "threshold": threshold, "polarity": polarity, "alpha": alpha})
    return result


def logistic_probability(weights: list[float], features: list[float]) -> float:
    return sigmoid(weights[0] + sum(weight * value for weight, value in zip(weights[1:], features)))


def forest_probability(model: list[dict[str, float | int]], features: list[float]) -> float:
    if not model:
        return 0.0
    return sum(float(tree["left"] if features[int(tree["feature"])] < float(tree["threshold"]) else tree["right"]) for tree in model) / len(model)


def boosted_probability(model: list[dict[str, float | int]], features: list[float]) -> float:
    if not model:
        return 0.0
    total = sum(float(item["alpha"]) for item in model)
    margin = sum(float(item["alpha"]) * (1 if (1 if features[int(item["feature"])] >= float(item["threshold"]) else -1) * int(item["polarity"]) > 0 else -1) for item in model)
    return sigmoid(2 * margin / max(1e-6, total))


def category_probability(model_type: str, model: Any, features: list[float]) -> float:
    return logistic_probability(model, features) if model_type == "logistic" else forest_probability(model, features) if model_type == "forest" else boosted_probability(model, features)


def select_threshold(scores: list[tuple[float, bool]], precision_target: float = 0.90) -> dict[str, float]:
    thresholds = sorted({0.5, 0.6, 0.7, 0.8, 0.85, 0.9, 0.95, 0.98, 0.99} | {round(score, 5) for score, _ in scores})
    best = {"threshold": 0.99, "precision": 0.0, "recall": 0.0, "coverage": 0.0, "trusted": 0.0}
    positives = max(1, sum(positive for _, positive in scores))
    for threshold in thresholds:
        accepted = [(score, positive) for score, positive in scores if score >= threshold]
        if not accepted:
            continue
        precision = sum(positive for _, positive in accepted) / len(accepted)
        recall = sum(positive for _, positive in accepted) / positives
        coverage = len(accepted) / max(1, len(scores))
        if precision >= precision_target and (recall > best["recall"] or recall == best["recall"] and threshold < best["threshold"]):
            best = {"threshold": threshold, "precision": precision, "recall": recall, "coverage": coverage, "trusted": float(len(accepted))}
    return best


def evaluate_scores(scores: list[tuple[float, bool]], threshold: float) -> dict[str, float | int | None]:
    accepted = [(score, positive) for score, positive in scores if score >= threshold]
    return {"candidates": len(scores), "trusted": len(accepted), "correct": sum(positive for _, positive in accepted), "wrongTrusted": sum(not positive for _, positive in accepted), "precision": sum(positive for _, positive in accepted) / len(accepted) if accepted else None, "coverage": len(accepted) / max(1, len(scores))}


def expert_candidate_values(lines: list[dict[str, Any]], category: str) -> list[tuple[int, str]]:
    result: list[tuple[int, str]] = []
    if category == "vendor":
        for index, line in enumerate(lines[:18]):
            value = text(line.get("text"))
            letters = sum(char.isalpha() for char in value)
            if letters >= 3 and letters / max(1, len(value)) >= 0.35 and len(value) <= 80 and not AMOUNT_RE.search(value) and not re.search(r"^(?:store|shop)$|\b(?:receipt|invoice|subtotal|sub-total|total|tax|gst|hst|date|cashier|address|tel|phone|thank|change|tender)\b", value, re.I):
                result.append((index, value))
    elif category == "purchase_date":
        for index, line in enumerate(lines):
            for raw in DATE_RE.findall(text(line.get("text"))):
                value = date_key(raw)
                if value:
                    result.append((index, value))
    elif category == "receipt_id":
        for index, line in enumerate(lines):
            value = text(line.get("text"))
            match = re.search(r"(?:invoice|receipt|order|transaction|trans|reference|ref|id|no\.?|number)\s*[:#-]?\s*([A-Z0-9][A-Z0-9-]{2,})", value, re.I)
            if match:
                result.append((index, match.group(1)))
    elif category == "item":
        for index, line in enumerate(lines):
            value = text(line.get("text"))
            if len(value) >= 3 and (AMOUNT_RE.search(value) or KEYWORDS["item"].search(value)):
                result.append((index, value))
    else:
        for index, line in enumerate(lines):
            value = text(line.get("text"))
            for raw in AMOUNT_RE.findall(value):
                if amount_value(raw) is None:
                    continue
                if category in ("subtotal", "tax") and not any(0 <= near < len(lines) and KEYWORDS[category].search(text(lines[near].get("text"))) for near in (index - 1, index, index + 1)):
                    continue
                result.append((index, raw.replace(" ", "")))
    return result


def crop_window(group: dict[str, Any], category: str, probability: float, width: float, height: float, mode: str = "adaptive") -> dict[str, float]:
    lines = [line for line in group["lines"] if text(line.get("text"))]
    if not lines:
        anchor = (float(group["top"]) + float(group["bottom"])) / 2
    else:
        def score(index: int) -> float:
            value = text(lines[index].get("text"))
            item = box(lines[index], index)
            y = item["cy"] / max(1, height)
            bias = 1 - min(1, y * 2.4) if category == "vendor" else 1 - min(1, y * 1.8) if category == "purchase_date" else 1 - abs(y - 0.48) if category == "item" else y
            return (4 if KEYWORDS[category].search(value) else 0) + (3 if category == "purchase_date" and DATE_RE.search(value) else 0) + (2 if category not in ("vendor", "purchase_date") and AMOUNT_RE.search(value) else 0) + bias + confidence(lines[index]) * 0.5 + (0.5 if index < max(2, len(lines) * 0.15) else 0)
        anchor = box(lines[max(range(len(lines)), key=score)], 0)["cy"]
    base = 0.22 if category == "item" else 0.12 if category == "vendor" else 0.10
    selected_mode = mode if mode != "adaptive" else "tight" if probability >= 0.9 else "medium" if probability >= 0.78 else "wide"
    multiplier = 0.72 if selected_mode == "tight" else 1.45 if selected_mode == "wide" else 1.0
    fraction = max(0.045, min(0.62 if category == "item" else 0.45, base * multiplier))
    crop_height = height * fraction
    top = max(0.0, min(height - crop_height, anchor - crop_height / 2))
    side = width * (0.025 if category == "item" else 0.045)
    return {"top": top, "bottom": top + crop_height, "height": crop_height, "left": side, "right": max(side + 1, width - side), "mode": selected_mode}


def expert_features(lines: list[dict[str, Any]], index: int, category: str, crop: dict[str, float], width: float, height: float, router_probability: float) -> list[float]:
    line = lines[index]
    item = box(line, index)
    value = text(line.get("text"))
    previous = text(lines[index - 1].get("text")) if index else ""
    following = text(lines[index + 1].get("text")) if index + 1 < len(lines) else ""
    amounts = AMOUNT_RE.findall(value)
    dates = DATE_RE.findall(value)
    position = max(0, value.find(amounts[0])) / max(1, len(value)) if amounts else 0.0
    return [
        index / max(1, len(lines) - 1), max(0, min(1, (item["y0"] - crop["top"]) / max(1, crop["height"]))), max(0, min(1, (item["y1"] - crop["top"]) / max(1, crop["height"]))),
        max(0, min(1, item["x0"] / max(1, width))), max(0, min(1, item["x1"] / max(1, width))), max(0, min(1, item["cx"] / max(1, width))),
        max(0, min(1, item["width"] / max(1, width) * 2)), max(0, min(1, item["height"] / max(1, height) * 25)), confidence(line),
        min(1, len(value) / 80), sum(char.isalpha() for char in value) / max(1, len(value)), sum(char.isdigit() for char in value) / max(1, len(value)),
        min(1, len(amounts) / 3), min(1, len(dates) / 2), 1 if re.search(r"[$€£]|\b(?:rm|usd|cad|gbp)\b", value, re.I) else 0,
        1 if KEYWORDS[category].search(value) else 0, 1 if KEYWORDS[category].search(previous) else 0, 1 if KEYWORDS[category].search(following) else 0,
        1 if AMOUNT_RE.search(previous) else 0, 1 if AMOUNT_RE.search(following) else 0, 1 if DATE_RE.search(previous) else 0, 1 if DATE_RE.search(following) else 0,
        position, 1 if position >= 0.5 else 0, 1 if item["x1"] / max(1, width) >= 0.78 else 0,
        1 if index and abs(item["cy"] - box(lines[index - 1], index - 1)["cy"]) > item["height"] * 2.5 else 0,
        1 if index + 1 < len(lines) and abs(box(lines[index + 1], index + 1)["cy"] - item["cy"]) > item["height"] * 2.5 else 0,
        router_probability, 1 if item["cy"] / max(1, height) < 0.25 else 0, 1 if item["cy"] / max(1, height) > 0.75 else 0,
        1 if len(value) > 32 else 0, 1 if KEYWORDS[category].search(value) else 0,
    ]


def expert_examples(row: dict[str, Any], label: dict[str, Any], router: dict[str, Any], split: str) -> dict[str, list[dict[str, Any]]]:
    groups = row_groups(row)
    all_lines = [line for group in groups for line in group["lines"]]
    width, height = dimensions(all_lines, groups)
    examples = {category: [] for category in SPECIALISTS}
    for group in groups:
        features = router_features(group, width, height)
        routed_categories = []
        for category in SPECIALISTS:
            probability = logistic_probability(router[category]["weights"], features)
            if probability < router[category]["threshold"]:
                continue
            feature_name = "candidate_date" if category == "purchase_date" else "candidate_" + category
            direct_index = list(ROUTER_FEATURE_NAMES).index(feature_name)
            priority = probability + (0.35 if features[direct_index] >= 0.5 and category in FIELDS else 0.0)
            routed_categories.append((priority, category, probability))
        for _, category, probability in sorted(routed_categories, reverse=True)[:2]:
            crop = crop_window(group, category, probability, width, height)
            lines = group["lines"]
            for index, value in expert_candidate_values(lines, category):
                expected = None
                if category == "vendor":
                    expected = normalize(str(label.get("company", "")))
                    positive = bool(expected and (expected in normalize(value) or normalize(value) in expected))
                elif category == "purchase_date":
                    expected = label_date(str(label.get("date", "")))
                    positive = value == expected
                elif category == "total":
                    expected_value = amount_value(str(label.get("total", "")))
                    positive = expected_value is not None and abs((amount_value(value) or -999999) - expected_value) < 0.011
                else:
                    positive = category_label(category, [lines[index]], label)
                examples[category].append({"features": expert_features(lines, index, category, crop, width, height, probability), "positive": positive, "receipt": row["id"], "split": split, "value": value})
    return examples


def router_rows(rows: list[dict[str, Any]], labels_dir: Path) -> dict[str, list[dict[str, Any]]]:
    result = {category: [] for category in CATEGORIES}
    for row in rows:
        index = int(row["id"])
        label = json.loads((labels_dir / f"{index:03d}.json").read_text())
        split = split_for(index)
        groups = row_groups(row)
        width, height = dimensions([line for group in groups for line in group["lines"]], groups)
        for group in groups:
            features = router_features(group, width, height)
            for category in CATEGORIES:
                result[category].append({"features": features, "positive": category_label(category, group["lines"], label), "receipt": row["id"], "split": split})
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, default=Path("benchmarks/receipt-band-ocr-sroie-all-fraction40-overlap40-contrast-2200-rules-hybrid.json"))
    parser.add_argument("--labels", type=Path, default=Path("benchmarks/sroie500/labels"))
    parser.add_argument("--output", type=Path, default=Path("src/lib/receiptHierarchicalModel.json"))
    parser.add_argument("--comparison", type=Path, default=Path("benchmarks/receipt-hierarchical-model-comparison.json"))
    args = parser.parse_args()
    benchmark = json.loads(args.input.read_text())
    rows = benchmark["rows"]
    router_documents = router_rows(rows, args.labels)
    router_models: dict[str, Any] = {}
    selected_router: dict[str, Any] = {}
    for category in CATEGORIES:
        train = [item for item in router_documents[category] if item["split"] == "tuning"]
        validation = [item for item in router_documents[category] if item["split"] == "validation"]
        final = [item for item in router_documents[category] if item["split"] == "final"]
        trained = {"logistic": logistic_train(train), "stump-forest": forest_train(train), "boosted-stumps": boosted_train(train)}
        comparisons = {}
        best_type, best_gate = "logistic", {"threshold": 0.9}
        best_recall = -1.0
        for model_type, trained_model in trained.items():
            validation_scores = [(category_probability("logistic" if model_type == "logistic" else "forest" if model_type == "stump-forest" else "boosted", trained_model, item["features"]), bool(item["positive"])) for item in validation]
            # Routing false positives cost a cheap second-pass invocation, but
            # routing false negatives permanently remove the specialist's
            # chance to recover a field. Trust is gated separately below, so
            # route at a recall-friendly threshold while still reporting its
            # precision/recall honestly.
            gate = select_threshold(validation_scores, 0.65 if category not in ("other",) else 0.80)
            final_scores = [(category_probability("logistic" if model_type == "logistic" else "forest" if model_type == "stump-forest" else "boosted", trained_model, item["features"]), bool(item["positive"])) for item in final]
            comparisons[model_type] = {"validationGate": gate, "validation": evaluate_scores(validation_scores, gate["threshold"]), "final": evaluate_scores(final_scores, gate["threshold"]), "modelBytes": len(json.dumps(trained_model, separators=(",", ":")))}
            if model_type == "logistic" or gate["recall"] > best_recall and gate["precision"] >= 0.90:
                best_type, best_gate, best_recall = model_type, gate, gate["recall"]
        # Browser inference intentionally ships logistic only. If a tree model
        # wins a screen it remains a benchmark result until separately encoded.
        selected_model = trained["logistic"]
        selected_gate = comparisons["logistic"]["validationGate"]
        route_floor = 0.18 if category in ("subtotal", "tax") else selected_gate["threshold"]
        selected_router[category] = {"type": "logistic", "weights": selected_model, "threshold": min(selected_gate["threshold"], route_floor), "min_margin": 0.0, "calibration": []}
        router_models[category] = {"selected": "logistic", "comparisons": comparisons, "positiveTuning": sum(item["positive"] for item in train), "positiveValidation": sum(item["positive"] for item in validation), "positiveFinal": sum(item["positive"] for item in final)}

    # Specialists are trained only from router-selected adaptive crops. The
    # router is already frozen from tuning/validation before this collection.
    specialist_documents = {category: [] for category in SPECIALISTS}
    for row in rows:
        index = int(row["id"])
        label = json.loads((args.labels / f"{index:03d}.json").read_text())
        specialist_documents_for_row = expert_examples(row, label, selected_router, split_for(index))
        for category in SPECIALISTS:
            specialist_documents[category].extend(specialist_documents_for_row[category])

    expert_models: dict[str, Any] = {}
    expert_comparisons: dict[str, Any] = {}
    for category in SPECIALISTS:
        train = [item for item in specialist_documents[category] if item["split"] == "tuning"]
        validation = [item for item in specialist_documents[category] if item["split"] == "validation"]
        final = [item for item in specialist_documents[category] if item["split"] == "final"]
        weights = logistic_train(train)
        validation_scores = [(logistic_probability(weights, item["features"]), bool(item["positive"])) for item in validation]
        # A trusted specialist prediction is safety-critical. The router may
        # over-route because a missed region costs one cheap OCR crop, but a
        # specialist gate is selected only from the highest observed
        # precision slice on validation. Aggregation still requires agreement
        # across distinct observations and semantic labels.
        gate = select_threshold(validation_scores, 0.995)
        # A candidate model is not allowed to be trusted on a single line. The
        # TypeScript aggregator adds the independent-observation gate.
        # The confidence gate is combined with explicit labels, value
        # ambiguity checks, and two independent crop observations in the
        # browser. Keeping this below 1.0 lets the specialist recover a line
        # whose OCR confidence is high but whose learned probability is not
        # perfectly separable; no field can bypass the aggregation checks.
        threshold = gate["threshold"] if gate["precision"] >= 0.995 else 1.0
        expert_models[category] = {"type": "logistic", "weights": weights, "threshold": threshold, "min_margin": 0.05, "min_confidence": 0.70, "calibration": []}
        expert_comparisons[category] = {"trainingCandidates": len(train), "trainingPositives": sum(item["positive"] for item in train), "validationGate": gate, "validation": evaluate_scores(validation_scores, gate["threshold"]), "final": evaluate_scores([(logistic_probability(weights, item["features"]), bool(item["positive"])) for item in final], gate["threshold"]), "modelBytes": len(json.dumps(weights, separators=(",", ":")))}

    model = {"version": 1, "engine": "paddleocr-js-ppocrv6-tiny-hierarchical", "dataset": "SROIE 500 grouped receipt split; router and specialists train on tuning only", "router_feature_names": list(ROUTER_FEATURE_NAMES), "expert_feature_names": list(EXPERT_FEATURE_NAMES), "router": selected_router, "experts": expert_models}
    comparison = {"dataset": "SROIE public PP-OCRv6 band cache", "sampleSize": len(rows), "splits": {"tuning": 301, "validation": 100, "final": 99}, "router": router_models, "experts": expert_comparisons, "notes": ["Router labels are exact for vendor/date/total where SROIE labels match OCR; subtotal/tax/id/item are weak labels and are not claimed as field accuracy.", "Specialist examples are generated only from router-selected adaptive windows after receipt-level splitting.", "The shipped representation is logistic for tiny browser inference; forests/boosted stumps are validation comparisons only."]}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(model, separators=(",", ":")) + "\n")
    args.comparison.parent.mkdir(parents=True, exist_ok=True)
    args.comparison.write_text(json.dumps(comparison, separators=(",", ":")) + "\n")
    print(json.dumps(comparison, indent=2))


if __name__ == "__main__":
    main()
