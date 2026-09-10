import { normalizeReceiptPurchaseDate } from "@/lib/receiptDate";
import {
  extractReceiptFieldsFromText,
  type ReceiptFrontendExtraction,
  type ReceiptFrontendField,
  type ReceiptFrontendFields,
  type ReceiptFrontendFieldResult,
} from "@/lib/receiptFrontendExtractor";
import type { ReceiptOcrLine } from "@/lib/receiptOcr";
import ppocrV6ModelJson from "@/lib/receiptPpocrV6FieldModel.json";

/**
 * PP-OCRv6's detector returns quadrilaterals.  The field selector keeps the
 * polygon as well as its safe axis-aligned envelope, so skew, text baseline,
 * and receipt-relative position can be used without shipping a ML runtime.
 * The checked-in model is just five small logistic regressions.
 */

const FIELDS: readonly ReceiptFrontendField[] = ["vendor", "purchase_date", "subtotal", "tax", "total"];

export const PP_OCRV6_FEATURE_NAMES = [
  "rank",
  "rank_fraction",
  "x0",
  "x1",
  "center_x",
  "y0",
  "y1",
  "center_y",
  "width",
  "height",
  "area",
  "left_margin",
  "right_margin",
  "top_margin",
  "bottom_margin",
  "line_confidence",
  "line_length",
  "alpha_ratio",
  "digit_ratio",
  "amount_count",
  "has_amount",
  "has_date",
  "has_currency",
  "field_label",
  "previous_field_label",
  "next_field_label",
  "line_keyword",
  "previous_keyword",
  "next_keyword",
  "previous_amount",
  "next_amount",
  "previous_date",
  "next_date",
  "amount_relative_x",
  "amount_right_half",
  "amount_near_right_edge",
  "gap_prev",
  "gap_next",
  "aligned_prev",
  "aligned_next",
  "repeated_value",
  "value_frequency",
  "explicit_label_strength",
  "candidate_bottom",
  "candidate_top",
  "candidate_right",
  "polygon_skew",
  "polygon_tilt",
] as const;

type ModelField = {
  type: "logistic";
  weights: number[];
  threshold: number;
  min_margin: number;
  min_confidence?: number;
  calibration: Array<{ max: number; accuracy: number }>;
};

type PpocrV6Model = {
  version: number;
  engine: string;
  feature_names: string[];
  fields: Record<ReceiptFrontendField, ModelField>;
};

const model = ppocrV6ModelJson as PpocrV6Model;

const AMOUNT_PATTERN = /(?:[$€£]|\b(?:rm|usd|cad|gbp)\b)\s*\(?\s*-?\d{1,6}(?:[,.]\d{3})*(?:[,.]\d{2})\s*\)?|\(?\s*-?\d{1,6}(?:[,.]\d{3})*(?:[,.]\d{2})\s*\)?/gi;
const DATE_PATTERN = /\b(?:20\d{2}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.](?:20)?\d{2}|\d{1,2}\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+20\d{2}|(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:,\s*|\s+)20\d{2})\b/gi;
const KEYWORDS = [
  "total", "grand", "final", "due", "payable", "after", "adj", "adjustment", "incl", "inclusive",
  "excl", "excluding", "sales", "summary", "tax", "gst", "subtotal", "sub-total", "rounding", "round",
  "cash", "change", "tender", "paid", "payment", "qty", "quantity", "item", "price", "discount", "amount",
  "balance", "before", "invoice", "date", "time", "issued", "store", "receipt", "member", "address", "thank",
] as const;

const LABEL_PATTERNS: Record<ReceiptFrontendField, RegExp> = {
  vendor: /never-match/i,
  purchase_date: /\b(?:date|time|issued|invoice)\b/i,
  subtotal: /\b(?:sub[ -]?total|before\s+tax|total\s+sales\s+excluding)\b/i,
  tax: /\b(?:tax|gst|hst|vat|sales\s+tax|tax\s+amount)\b/i,
  total: /\b(?:grand\s+total|total\s+due|amount\s+due|balance\s+due|final\s+total|payable|total)\b/i,
};

const normalizeLine = (value: string): string => value.replace(/[|¦]/g, " ").replace(/\s+/g, " ").trim();
const normalizedText = (value: string): string => normalizeLine(value).toLowerCase();
const normalizedToken = (value: string): string => normalizedText(value).replace(/[^a-z0-9]/g, "");

const amountMatches = (text: string): string[] => Array.from(text.matchAll(AMOUNT_PATTERN), (match) => match[0]);
const dateMatches = (text: string): string[] => Array.from(text.matchAll(DATE_PATTERN), (match) => match[0]);

const parseAmount = (raw: string): number | null => {
  let value = raw.toLowerCase().replace(/\b(?:rm|usd|cad|gbp)\b/g, "").replace(/[\s$€£()]/g, "");
  const comma = value.lastIndexOf(",");
  const dot = value.lastIndexOf(".");
  if (comma > dot) value = value.replace(/\./g, "").replace(",", ".");
  else value = value.replace(/,/g, "");
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed < 1_000_000 ? parsed : null;
};

const amountKey = (raw: string): string | null => {
  const parsed = parseAmount(raw);
  return parsed === null ? null : parsed.toFixed(2);
};

const outputAmount = (raw: string): string => raw
  .replace(/\s+/g, "")
  .replace(/[€£]/g, "$");

const monthNumbers: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9,
  september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

const validDate = (year: number, month: number, day: number): string | null => {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day) || month < 1 || month > 12 || day < 1) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
};

const normalizeDateCandidate = (raw: string): string | null => {
  const trimmed = normalizeLine(raw).replace(/\s*,\s*/g, ", ");
  const direct = normalizeReceiptPurchaseDate(trimmed);
  if (direct) return direct;
  const numeric = trimmed.match(/^(\d{1,2})[/. -](\d{1,2})[/. -](20\d{2}|\d{2})$/);
  if (numeric) {
    const first = Number(numeric[1]);
    const second = Number(numeric[2]);
    const year = numeric[3].length === 2 ? 2000 + Number(numeric[3]) : Number(numeric[3]);
    if (first <= 12 && second <= 12) return null;
    if (first > 12) return validDate(year, second, first);
    return validDate(year, first, second);
  }
  const monthFirst = trimmed.match(/^([A-Za-z]+)\s+(\d{1,2})(?:,\s*|\s+)(20\d{2})$/);
  if (monthFirst) return validDate(Number(monthFirst[3]), monthNumbers[monthFirst[1].toLowerCase()] ?? 0, Number(monthFirst[2]));
  const dayFirst = trimmed.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(20\d{2})$/);
  if (dayFirst) return validDate(Number(dayFirst[3]), monthNumbers[dayFirst[2].toLowerCase()] ?? 0, Number(dayFirst[1]));
  return null;
};

const confidenceFraction = (value: number | undefined): number => {
  if (value === undefined || !Number.isFinite(value)) return 0.75;
  return Math.max(0, Math.min(1, value > 1 ? value / 100 : value));
};

type NormalizedLine = ReceiptOcrLine & {
  normalized: string;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  centerX: number;
  centerY: number;
  width: number;
  height: number;
  area: number;
  polygonSkew: number;
  polygonTilt: number;
};

const clamp = (value: number): number => Math.max(-1, Math.min(1, value));

const polygonGeometry = (line: ReceiptOcrLine): { skew: number; tilt: number } => {
  const points = line.polygon && line.polygon.length >= 4
    ? line.polygon
    : line.bbox
      ? [[line.bbox.x0, line.bbox.y0], [line.bbox.x1, line.bbox.y0], [line.bbox.x1, line.bbox.y1], [line.bbox.x0, line.bbox.y1]] as Array<[number, number]>
      : [];
  if (points.length < 4) return { skew: 0, tilt: 0 };
  const height = Math.max(1, Math.max(...points.map(([, y]) => y)) - Math.min(...points.map(([, y]) => y)));
  const top = (points[0][1] + points[1][1]) / 2;
  const bottom = (points[2][1] + points[3][1]) / 2;
  const left = (points[0][0] + points[3][0]) / 2;
  const right = (points[1][0] + points[2][0]) / 2;
  return {
    skew: clamp((points[1][1] - points[0][1] + points[2][1] - points[3][1]) / Math.max(1, height * 2)),
    tilt: clamp((top - bottom) / height + (right - left) / Math.max(1, height * 20)),
  };
};

const normalizedLines = (ocrLines: ReceiptOcrLine[]): NormalizedLine[] => {
  const source = ocrLines
    .map((line, originalIndex) => ({ line, originalIndex, normalized: normalizeLine(line.text) }))
    .filter((item) => item.normalized.length > 0)
    .map(({ line, originalIndex, normalized }) => {
      const fallback = { x0: 0, y0: originalIndex, x1: 1, y1: originalIndex + 1 };
      const bbox = line.bbox ?? fallback;
      const x0 = Math.min(bbox.x0, bbox.x1);
      const x1 = Math.max(bbox.x0, bbox.x1);
      const y0 = Math.min(bbox.y0, bbox.y1);
      const y1 = Math.max(bbox.y0, bbox.y1);
      const polygon = polygonGeometry(line);
      return { ...line, normalized, x0, x1, y0, y1, centerX: (x0 + x1) / 2, centerY: (y0 + y1) / 2, width: x1 - x0, height: y1 - y0, area: Math.max(0, x1 - x0) * Math.max(0, y1 - y0), polygonSkew: polygon.skew, polygonTilt: polygon.tilt };
    });
  const minX = Math.min(...source.map((line) => line.x0), 0);
  const minY = Math.min(...source.map((line) => line.y0), 0);
  const maxX = Math.max(...source.map((line) => line.x1), 1);
  const maxY = Math.max(...source.map((line) => line.y1), 1);
  const pageWidth = Math.max(1, maxX - minX);
  const pageHeight = Math.max(1, maxY - minY);
  return source
    .map((line) => ({
      ...line,
      x0: (line.x0 - minX) / pageWidth,
      x1: (line.x1 - minX) / pageWidth,
      y0: (line.y0 - minY) / pageHeight,
      y1: (line.y1 - minY) / pageHeight,
      centerX: (line.centerX - minX) / pageWidth,
      centerY: (line.centerY - minY) / pageHeight,
      width: line.width / pageWidth,
      height: line.height / pageHeight,
      area: (line.width / pageWidth) * (line.height / pageHeight),
    }))
    .sort((left, right) => Math.abs(left.y0 - right.y0) <= Math.max(0.008, Math.max(left.height, right.height) * 0.4)
      ? left.x0 - right.x0
      : left.y0 - right.y0);
};

const hasKeyword = (text: string): boolean => KEYWORDS.some((keyword) => {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return keyword.includes("-") ? text.includes(keyword) : new RegExp(`\\b${escaped}\\b`, "i").test(text);
});

const labelScore = (field: ReceiptFrontendField, text: string): number => {
  if (!LABEL_PATTERNS[field].test(text)) return 0;
  if (field === "total") {
    if (/\b(?:grand\s+total|total\s+due|amount\s+due|balance\s+due|final\s+total|payable)\b/i.test(text)) return 1;
    if (/\btotal\s+(?:sales\s+)?(?:inclusive|after|inc)/i.test(text)) return 0.85;
    return 0.7;
  }
  if (field === "subtotal") return /\bsub[ -]?total\b/i.test(text) ? 1 : 0.8;
  if (field === "tax") return /\b(?:tax|gst|hst|vat|sales\s+tax)\b/i.test(text) ? 1 : 0.7;
  return 1;
};

const explicitLabelStrength = (lines: NormalizedLine[], index: number, field: ReceiptFrontendField): number => Math.max(
  labelScore(field, lines[index]?.normalized ?? ""),
  labelScore(field, lines[index - 1]?.normalized ?? "") * 0.95,
  labelScore(field, lines[index + 1]?.normalized ?? "") * 0.9,
);

const featureVector = (
  lines: NormalizedLine[],
  index: number,
  field: ReceiptFrontendField,
  rawAmount: string | undefined,
  valueFrequency: number,
  repeatedValue: boolean,
): number[] => {
  const line = lines[index];
  const previous = lines[index - 1];
  const next = lines[index + 1];
  const text = line.normalized;
  const previousText = previous?.normalized ?? "";
  const nextText = next?.normalized ?? "";
  const amounts = amountMatches(text);
  const datePresent = dateMatches(text).length > 0;
  const amountPosition = rawAmount ? Math.max(0, text.indexOf(rawAmount)) / Math.max(1, text.length) : 0;
  const lineLabel = labelScore(field, text);
  const previousLabel = labelScore(field, previousText);
  const nextLabel = labelScore(field, nextText);
  const values = [
    index / Math.max(1, lines.length - 1),
    (index + 1) / Math.max(1, lines.length),
    line.x0,
    line.x1,
    line.centerX,
    line.y0,
    line.y1,
    line.centerY,
    line.width,
    line.height,
    Math.min(1, line.area * 8),
    line.x0,
    1 - line.x1,
    line.y0,
    1 - line.y1,
    confidenceFraction(line.confidence),
    Math.min(text.length, 80) / 80,
    (text.match(/[A-Za-z]/g) ?? []).length / Math.max(1, text.length),
    (text.match(/[0-9]/g) ?? []).length / Math.max(1, text.length),
    Math.min(1, amounts.length / 4),
    amounts.length ? 1 : 0,
    datePresent ? 1 : 0,
    /[$€£]|\b(?:rm|usd|cad|gbp)\b/i.test(text) ? 1 : 0,
    lineLabel,
    previousLabel,
    nextLabel,
    hasKeyword(text) ? 1 : 0,
    hasKeyword(previousText) ? 1 : 0,
    hasKeyword(nextText) ? 1 : 0,
    amountMatches(previousText).length ? 1 : 0,
    amountMatches(nextText).length ? 1 : 0,
    dateMatches(previousText).length ? 1 : 0,
    dateMatches(nextText).length ? 1 : 0,
    amountPosition,
    amountPosition >= 0.5 ? 1 : 0,
    rawAmount && amountPosition >= 0.65 ? 1 : 0,
    previous ? Math.max(0, line.y0 - previous.y1) : 0,
    next ? Math.max(0, next.y0 - line.y1) : 0,
    previous && Math.abs(line.x0 - previous.x0) <= 0.12 ? 1 : 0,
    next && Math.abs(line.x0 - next.x0) <= 0.12 ? 1 : 0,
    repeatedValue ? 1 : 0,
    Math.min(1, valueFrequency / 4),
    explicitLabelStrength(lines, index, field),
    line.centerY >= 0.8 ? 1 : 0,
    line.centerY <= 0.22 ? 1 : 0,
    rawAmount && (amountPosition >= 0.5 || line.x1 >= 0.8) ? 1 : 0,
    line.polygonSkew,
    line.polygonTilt,
  ];
  return values;
};

type Candidate = {
  index: number;
  value: string;
  canonical: string;
  rawAmount?: string;
  evidence: string;
  score: number;
  confidence: number;
  labelStrength: number;
  features: number[];
};

const sigmoid = (value: number): number => 1 / (1 + Math.exp(-Math.max(-40, Math.min(40, value))));

const calibratedConfidence = (score: number, points: ModelField["calibration"]): number => {
  const point = points.find((candidate) => score < candidate.max) ?? points[points.length - 1];
  return Math.max(0, Math.min(1, point?.accuracy ?? score));
};

const modelScore = (field: ReceiptFrontendField, features: number[]): { raw: number; confidence: number } => {
  const configuration = model.fields[field];
  if (!configuration || configuration.type !== "logistic" || configuration.weights.length < 2) return { raw: 0, confidence: 0 };
  const raw = sigmoid(configuration.weights[0] + configuration.weights.slice(1).reduce((sum, weight, position) => sum + weight * (features[position] ?? 0), 0));
  return { raw, confidence: calibratedConfidence(raw, configuration.calibration) };
};

const blockedVendorLine = (text: string): boolean => /^(?:store|shop)$|\b(?:receipt|invoice|subtotal|sub-total|total|tax|gst|hst|date|cashier|address|tel|phone|thank|change|tender)\b/i.test(text);

const collectCandidates = (lines: NormalizedLine[], field: ReceiptFrontendField): Array<Omit<Candidate, "score" | "confidence" | "features" | "labelStrength"> & { labelStrength: number }> => {
  const candidates: Array<Omit<Candidate, "score" | "confidence" | "features" | "labelStrength"> & { labelStrength: number }> = [];
  if (field === "vendor") {
    lines.slice(0, 14).forEach((line, index) => {
      const letters = (line.normalized.match(/[A-Za-z]/g) ?? []).length;
      if (letters < 3 || letters / Math.max(1, line.normalized.length) < 0.35 || line.normalized.length > 80 || blockedVendorLine(line.normalized) || amountMatches(line.normalized).length) return;
      candidates.push({ index, value: line.normalized, canonical: normalizedToken(line.normalized), evidence: line.normalized, labelStrength: 0 });
    });
  } else if (field === "purchase_date") {
    lines.forEach((line, index) => dateMatches(line.normalized).forEach((raw) => {
      const value = normalizeDateCandidate(raw);
      if (!value) return;
      candidates.push({ index, value, canonical: value, evidence: line.normalized, labelStrength: 0 });
    }));
  } else {
    lines.forEach((line, index) => amountMatches(line.normalized).forEach((raw) => {
      const key = amountKey(raw);
      if (key === null) return;
      candidates.push({ index, value: outputAmount(raw), rawAmount: raw, canonical: key, evidence: line.normalized, labelStrength: 0 });
    }));
  }
  return candidates;
};

const emptyPpField = (value: string | null = null, confidence = 0, evidence = ""): ReceiptFrontendFieldResult => ({
  value,
  confidence,
  status: value ? "uncertain" : "missing",
  source: "ml",
  evidence,
});

const isExcludedTotalContext = (text: string): boolean => /\b(?:qty|quantity|items?|excluding|excl\.?|before\s+tax|subtotal|sub-total|tax\s+amount|round(?:ing)?\s+adjustment)\b/i.test(text);

const candidateMatchesValue = (candidate: Candidate, field: ReceiptFrontendField, value: string): boolean => {
  if (field === "vendor") return normalizedToken(candidate.value) === normalizedToken(value);
  if (field === "purchase_date") return candidate.canonical === value;
  return candidate.canonical === amountKey(value);
};

const chooseField = (
  lines: NormalizedLine[],
  field: ReceiptFrontendField,
  preferredValue?: string | null,
): ReceiptFrontendFieldResult => {
  const configuration = model.fields[field];
  if (!configuration || model.version !== 1 || model.feature_names.join("|") !== PP_OCRV6_FEATURE_NAMES.join("|")) return emptyPpField();
  const base = collectCandidates(lines, field);
  if (!base.length) return emptyPpField();
  const frequencies = new Map<string, number>();
  base.forEach((candidate) => frequencies.set(candidate.canonical, (frequencies.get(candidate.canonical) ?? 0) + 1));
  const candidates: Candidate[] = base.map((candidate) => {
    const frequency = frequencies.get(candidate.canonical) ?? 1;
    const features = featureVector(lines, candidate.index, field, candidate.rawAmount, frequency, frequency > 1);
    const score = modelScore(field, features);
    return {
      ...candidate,
      labelStrength: explicitLabelStrength(lines, candidate.index, field),
      features,
      score: score.raw,
      confidence: score.confidence,
    };
  });
  candidates.sort((left, right) => right.score - left.score);
  const preferred = preferredValue
    ? candidates.find((candidate) => candidateMatchesValue(candidate, field, preferredValue))
    : undefined;
  const top = preferred ?? candidates[0];
  const second = candidates.filter((candidate) => candidate !== top)[0]?.score ?? 0;
  const margin = top.score - second;
  const sameCanonical = candidates.filter((candidate) => candidate.canonical === top.canonical);
  const distinctValues = new Set(candidates.map((candidate) => candidate.canonical));
  const previous = lines[top.index - 1]?.normalized ?? "";
  const next = lines[top.index + 1]?.normalized ?? "";
  const line = lines[top.index].normalized;
  const context = `${previous} ${line} ${next}`;
  const strongLabel = top.labelStrength >= 0.65;
  if ((field === "subtotal" || field === "tax") && !candidates.some((candidate) => candidate.labelStrength >= 0.65)) return emptyPpField();
  let safe = top.score >= configuration.threshold
    && top.confidence >= (configuration.min_confidence ?? 0.98)
    && margin >= configuration.min_margin;

  if (field === "vendor") {
    safe = safe && top.index < 14 && !blockedVendorLine(line) && !amountMatches(line).length;
  } else if (field === "purchase_date") {
    // A second, different date is ambiguous even if its OCR confidence is high.
    safe = safe && distinctValues.size === 1 && (strongLabel || top.index <= Math.max(4, Math.floor(lines.length * 0.2)));
  } else if (field === "subtotal" || field === "tax") {
    // SROIE has no subtotal/tax ground truth.  Keep these fields on the
    // explicit-label path; the model may rank candidates but cannot invent a
    // business-rule result from total - subtotal.
    const labelled = candidates.filter((candidate) => candidate.labelStrength >= 0.65);
    const labelledValues = new Set(labelled.map((candidate) => candidate.canonical));
    safe = safe && strongLabel && labelledValues.size === 1 && labelled.length >= 1;
  } else {
    const preferredLabel = /\b(?:grand\s+total|total\s+due|amount\s+due|balance\s+due|final\s+total|payable|total\s+(?:sales\s+)?(?:inclusive|incl|after|with))\b/i.test(context);
    const excluded = isExcludedTotalContext(context);
    const distinctStrong = new Set(candidates.filter((candidate) => candidate.labelStrength >= 0.65).map((candidate) => candidate.canonical));
    safe = safe && strongLabel && !excluded && (distinctStrong.size <= 1 || preferredLabel);
    // Repeated totals are common on thermal receipts.  They are safe only when
    // the selected value is attached to a strong final-total label and all
    // competing labelled totals agree.
    if (sameCanonical.length > 1 && top.labelStrength < 0.95 && !preferredLabel) safe = false;
  }

  // A candidate with an ambiguous value is not surfaced as a trusted value.
  // Keeping its evidence is useful in the review UI while its field remains
  // unresolved for GPT.
  const evidence = `${top.evidence} (PP-OCRv6 model ${Math.round(top.confidence * 100)}%, margin ${Math.round(margin * 100)}%)`;
  return {
    value: safe ? top.value : top.value || null,
    confidence: top.confidence,
    status: safe ? "trusted" : "uncertain",
    source: "ml",
    evidence,
  };
};

export const extractReceiptFieldsFromPpocrV6Lines = (
  ocrLines: ReceiptOcrLine[],
  textOverride?: string,
): ReceiptFrontendExtraction => {
  const lines = normalizedLines(ocrLines);
  const text = textOverride ?? lines.map((line) => line.normalized).join("\n");
  const legacy = extractReceiptFieldsFromText(text, "rules-only").fields;
  const fields = Object.fromEntries(FIELDS.map((field) => {
    const adapted = chooseField(lines, field);
    if (adapted.status === "trusted" || legacy[field].status !== "trusted") return [field, adapted];
    // A legacy rule result may be retained only if the PP-OCRv6 model scores
    // that exact candidate independently. This recovers strong labelled
    // values without allowing a legacy result to bypass ambiguity gates.
    const validatedLegacy = chooseField(lines, field, legacy[field].value);
    return validatedLegacy.status === "trusted"
      ? [field, { ...validatedLegacy, evidence: `${validatedLegacy.evidence}; independently validated legacy label` }]
      : [field, adapted];
  })) as ReceiptFrontendFields;
  const unresolvedFields = FIELDS.filter((field) => fields[field].status !== "trusted");
  return {
    text,
    fields,
    unresolvedFields,
    durationMs: 0,
    engine: "ppocrv6",
    ocrLines,
  };
};
