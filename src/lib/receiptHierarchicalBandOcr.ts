import type {
  ReceiptFrontendExtraction,
  ReceiptFrontendField,
  ReceiptFrontendFieldResult,
  ReceiptFrontendFields,
} from "@/lib/receiptFrontendExtractor";
import type { ReceiptOcrBox, ReceiptOcrLine } from "@/lib/receiptOcr";
import {
  deduplicateReceiptBandLines,
  type ReceiptBandObservation,
  type ReceiptMergedLine,
} from "@/lib/receiptBandOcr";
import hierarchicalModelJson from "@/lib/receiptHierarchicalModel.json";

/**
 * Experimental PP-OCRv6 hierarchical mixture of experts.
 *
 * The first pass only classifies coarse bands.  A second pass is created only
 * for categories with router evidence, and each crop is sent to its selected
 * specialist(s).  This module contains no OCR runtime and is therefore safe
 * to exercise in Node benchmarks and cheap to use from a browser adapter.
 */

export const RECEIPT_HIERARCHICAL_CATEGORIES = [
  "vendor",
  "purchase_date",
  "subtotal",
  "tax",
  "total",
  "receipt_id",
  "item",
  "other",
] as const;

export type ReceiptHierarchicalCategory = typeof RECEIPT_HIERARCHICAL_CATEGORIES[number];
export type ReceiptHierarchicalField = ReceiptFrontendField;
export type ReceiptHierarchicalSpecialist = Exclude<ReceiptHierarchicalCategory, "other">;

const FIELDS: readonly ReceiptFrontendField[] = ["vendor", "purchase_date", "subtotal", "tax", "total"];
const FIELD_CATEGORY: Record<ReceiptFrontendField, ReceiptHierarchicalSpecialist> = {
  vendor: "vendor",
  purchase_date: "purchase_date",
  subtotal: "subtotal",
  tax: "tax",
  total: "total",
};

export const HIERARCHICAL_ROUTER_FEATURE_NAMES = [
  "band_top", "band_bottom", "band_center", "band_height", "line_count", "line_count_density",
  "mean_confidence", "min_confidence", "mean_line_height", "mean_line_width", "text_density",
  "alpha_ratio", "digit_ratio", "amount_line_fraction", "date_line_fraction", "currency_line_fraction",
  "keyword_vendor", "keyword_date", "keyword_subtotal", "keyword_tax", "keyword_total",
  "keyword_receipt_id", "keyword_item", "top_line_fraction", "bottom_line_fraction",
  "right_aligned_fraction", "wide_line_fraction", "sparse_gap_fraction", "non_empty_fraction",
  "candidate_vendor", "candidate_date", "candidate_subtotal", "candidate_tax", "candidate_total",
  "candidate_receipt_id", "candidate_item",
] as const;

export const HIERARCHICAL_EXPERT_FEATURE_NAMES = [
  "rank_fraction", "relative_top", "relative_bottom", "x0", "x1", "center_x", "width", "height",
  "line_confidence", "text_length", "alpha_ratio", "digit_ratio", "amount_count", "date_count",
  "currency", "category_keyword", "previous_category_keyword", "next_category_keyword",
  "previous_amount", "next_amount", "previous_date", "next_date", "amount_position",
  "amount_right_half", "right_aligned", "gap_previous", "gap_next", "router_probability",
  "top_region", "bottom_region", "long_text", "strong_label",
] as const;

type LogisticModel = {
  type: "logistic";
  weights: number[];
  threshold: number;
  min_margin: number;
  min_confidence?: number;
  calibration?: Array<{ max: number; accuracy: number }>;
};

type HierarchicalModel = {
  version: number;
  engine: string;
  router_feature_names: string[];
  expert_feature_names: string[];
  router: Record<ReceiptHierarchicalCategory, LogisticModel>;
  experts: Record<ReceiptHierarchicalSpecialist, LogisticModel>;
};

const model = hierarchicalModelJson as HierarchicalModel;

export interface ReceiptRouterBandInput {
  bandIndex: number;
  observationKey: string;
  top: number;
  bottom: number;
  width: number;
  height: number;
  lines: ReceiptOcrLine[];
}

export interface ReceiptRouterPrediction {
  bandIndex: number;
  observationKey: string;
  top: number;
  bottom: number;
  probabilities: Record<ReceiptHierarchicalCategory, number>;
  routes: ReceiptHierarchicalSpecialist[];
  dominantCategory: ReceiptHierarchicalCategory;
  lineCount: number;
}

export type ReceiptExpertWindowMode = "tight" | "medium" | "wide" | "adaptive";

export interface ReceiptHierarchicalConfig {
  name: string;
  /** Existing PP-OCRv6 coarse-band geometry/preprocessing used by the browser runner. */
  firstPassConfigName?: string;
  windowMode: ReceiptExpertWindowMode;
  maxCategoriesPerBand: number;
  maxExpertInvocations: number;
  routerThresholds?: Partial<Record<ReceiptHierarchicalCategory, number>>;
  expertThresholds?: Partial<Record<ReceiptHierarchicalSpecialist, number>>;
  expertMinConfidence?: Partial<Record<ReceiptHierarchicalSpecialist, number>>;
  minIndependentObservations: 1 | 2 | 3;
  /** Crop height multiplier around the anchor line for the adaptive mode. */
  windowPadding: number;
}

export const RECEIPT_HIERARCHICAL_SCREENING_CONFIGS: readonly ReceiptHierarchicalConfig[] = [
  {
    name: "adaptive-medium-min2",
    firstPassConfigName: "fraction40-overlap40-contrast-2200-rules-hybrid",
    windowMode: "adaptive",
    maxCategoriesPerBand: 2,
    maxExpertInvocations: 12,
    minIndependentObservations: 2,
    windowPadding: 1,
  },
  {
    name: "adaptive-wide-min2",
    firstPassConfigName: "fraction50-overlap40-sharpen-2200-band-only",
    windowMode: "wide",
    maxCategoriesPerBand: 2,
    maxExpertInvocations: 12,
    minIndependentObservations: 2,
    windowPadding: 1.35,
  },
  {
    name: "adaptive-tight-min2",
    firstPassConfigName: "fraction30-overlap20-original-1600-band-only",
    windowMode: "tight",
    maxCategoriesPerBand: 2,
    maxExpertInvocations: 12,
    minIndependentObservations: 2,
    windowPadding: 0.72,
  },
  {
    name: "adaptive-medium-min1",
    firstPassConfigName: "fraction40-overlap40-contrast-2200-rules-hybrid",
    windowMode: "adaptive",
    maxCategoriesPerBand: 2,
    maxExpertInvocations: 12,
    minIndependentObservations: 1,
    windowPadding: 1,
  },
  {
    name: "adaptive-medium-min3",
    firstPassConfigName: "fraction40-overlap40-contrast-2200-rules-hybrid",
    windowMode: "adaptive",
    maxCategoriesPerBand: 2,
    maxExpertInvocations: 12,
    minIndependentObservations: 3,
    windowPadding: 1,
  },
  {
    name: "adaptive-multi3-medium-min2",
    firstPassConfigName: "fraction40-overlap40-contrast-2200-rules-hybrid",
    windowMode: "adaptive",
    maxCategoriesPerBand: 3,
    maxExpertInvocations: 18,
    minIndependentObservations: 2,
    windowPadding: 1,
  },
  {
    name: "medium-fixed-min2",
    firstPassConfigName: "pixels480-overlap40-sharpen-2800-whole-plus-band",
    windowMode: "medium",
    maxCategoriesPerBand: 2,
    maxExpertInvocations: 12,
    minIndependentObservations: 2,
    windowPadding: 1,
  },
  {
    name: "adaptive-medium-tuned-min2",
    firstPassConfigName: "fraction40-overlap40-contrast-2200-rules-hybrid",
    windowMode: "adaptive",
    maxCategoriesPerBand: 2,
    maxExpertInvocations: 12,
    minIndependentObservations: 2,
    windowPadding: 1,
    expertThresholds: { vendor: 0.65, purchase_date: 0.55, subtotal: 0.50, tax: 0.65, total: 0.65, receipt_id: 0.50, item: 0.50 },
    expertMinConfidence: { vendor: 0.55, purchase_date: 0.55, subtotal: 0.55, tax: 0.55, total: 0.55, receipt_id: 0.55, item: 0.55 },
  },
  {
    name: "adaptive-wide-tuned-min2",
    firstPassConfigName: "fraction50-overlap40-sharpen-2200-band-only",
    windowMode: "wide",
    maxCategoriesPerBand: 2,
    maxExpertInvocations: 12,
    minIndependentObservations: 2,
    windowPadding: 1.35,
    expertThresholds: { vendor: 0.75, purchase_date: 0.60, subtotal: 0.60, tax: 0.70, total: 0.70, receipt_id: 0.60, item: 0.60 },
    expertMinConfidence: { vendor: 0.60, purchase_date: 0.55, subtotal: 0.55, tax: 0.60, total: 0.60, receipt_id: 0.60, item: 0.60 },
  },
  {
    name: "adaptive-medium-high-gate-min2",
    firstPassConfigName: "fraction40-overlap40-contrast-2200-rules-hybrid",
    windowMode: "adaptive",
    maxCategoriesPerBand: 2,
    maxExpertInvocations: 12,
    minIndependentObservations: 2,
    windowPadding: 1,
    expertThresholds: { vendor: 0.80, purchase_date: 0.65, subtotal: 0.65, tax: 0.80, total: 0.80, receipt_id: 0.65, item: 0.65 },
    expertMinConfidence: { vendor: 0.65, purchase_date: 0.60, subtotal: 0.60, tax: 0.65, total: 0.65, receipt_id: 0.65, item: 0.65 },
  },
  {
    name: "adaptive-medium-tuned-min3",
    firstPassConfigName: "fraction40-overlap40-contrast-2200-rules-hybrid",
    windowMode: "adaptive",
    maxCategoriesPerBand: 2,
    maxExpertInvocations: 12,
    minIndependentObservations: 3,
    windowPadding: 1,
    expertThresholds: { vendor: 0.55, purchase_date: 0.50, subtotal: 0.45, tax: 0.60, total: 0.60, receipt_id: 0.50, item: 0.50 },
    expertMinConfidence: { vendor: 0.55, purchase_date: 0.55, subtotal: 0.55, tax: 0.55, total: 0.55, receipt_id: 0.55, item: 0.55 },
  },
];

export const RECEIPT_HIERARCHICAL_EXPERIMENTAL_CONFIG: ReceiptHierarchicalConfig = RECEIPT_HIERARCHICAL_SCREENING_CONFIGS[0];

export interface ReceiptExpertCrop {
  cropId: string;
  category: ReceiptHierarchicalSpecialist;
  mode: Exclude<ReceiptExpertWindowMode, "adaptive">;
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
  sourceBandIndex: number;
  sourceObservationKey: string;
  sourceBandIndices: number[];
  routerProbability: number;
  anchorLineIndex: number | null;
  anchorY: number;
}

export type ReceiptHierarchicalObservation = ReceiptBandObservation & {
  sourcePass: "first-pass" | "expert";
  expertCategory?: ReceiptHierarchicalSpecialist;
  cropId?: string;
  routerProbability?: number;
};

export interface ReceiptHierarchicalFieldResult extends ReceiptFrontendFieldResult {
  supportBandCount: number;
  independentObservationCount: number;
  trustedSupportCount: number;
  agreement: boolean;
  competingValueCount: number;
  routedSupportCount: number;
}

export interface ReceiptHierarchicalSpecialistResult {
  category: ReceiptHierarchicalSpecialist;
  value: string | null;
  confidence: number;
  status: "trusted" | "uncertain" | "missing";
  evidence: string;
  supportBandCount: number;
  independentObservationCount: number;
  routedSupportCount: number;
}

export interface ReceiptHierarchicalExtraction extends Omit<ReceiptFrontendExtraction, "fields" | "engine"> {
  engine: "ppocrv6-hierarchical-bands";
  fields: Record<ReceiptFrontendField, ReceiptHierarchicalFieldResult>;
  specialists: Record<"receipt_id" | "item", ReceiptHierarchicalSpecialistResult>;
  routerPredictions: ReceiptRouterPrediction[];
  expertCrops: ReceiptExpertCrop[];
  mergedLines: ReceiptMergedLine[];
  routing: {
    firstPassBandCount: number;
    routedBandCount: number;
    routedCategoryCounts: Record<ReceiptHierarchicalSpecialist, number>;
    specialistInvocationCount: number;
    skippedSpecialistCount: number;
  };
  deduplication: {
    inputLineCount: number;
    mergedLineCount: number;
    duplicateLineCount: number;
    multiBandLineCount: number;
    meanSupportCount: number;
    expertInputLineCount: number;
  };
}

interface Geometry {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
}

const clamp = (value: number, low = 0, high = 1): number => Math.max(low, Math.min(high, value));
const finite = (value: unknown, fallback = 0): number => typeof value === "number" && Number.isFinite(value) ? value : fallback;
const normalizeLine = (value: string): string => value.replace(/[|¦]/g, " ").replace(/\s+/g, " ").trim();
const lower = (value: string): string => normalizeLine(value).toLowerCase();
const amountPattern = /(?:[$€£]|\b(?:rm|usd|cad|gbp)\b)?\s*\(?\s*-?\d{1,6}(?:[,.]\d{3})*(?:[,.]\d{2})\s*\)?/gi;
const datePattern = /\b(?:20\d{2}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.](?:20)?\d{2}|(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:,\s*|\s+)20\d{2})\b/gi;
const currencyPattern = /[$€£]|\b(?:rm|usd|cad|gbp)\b/i;
const keywordPatterns: Record<ReceiptHierarchicalCategory, RegExp> = {
  vendor: /\b(?:store|shop|market|mart|inc|ltd|llc|corp|co|berhad|sdn)\b/i,
  purchase_date: /\b(?:date|time|issued|invoice)\b|\b\d{1,2}[/. -]\d{1,2}[/. -](?:20)?\d{2}\b/i,
  subtotal: /\b(?:sub[ -]?total|before\s+tax|excluding)\b/i,
  tax: /\b(?:tax|gst|hst|vat|sales\s+tax)\b/i,
  total: /\b(?:grand\s+total|total\s+due|amount\s+due|balance\s+due|payable|final\s+total|total)\b/i,
  receipt_id: /\b(?:invoice|receipt|order|transaction|trans|reference|ref|id|no\.?|number)\b/i,
  item: /\b(?:item|qty|quantity|price|sku|product|description|unit)\b/i,
  other: /$^/i,
};

const categoryKeyword = (category: ReceiptHierarchicalCategory, text: string): boolean => keywordPatterns[category].test(text);

const amountMatches = (text: string): string[] => {
  amountPattern.lastIndex = 0;
  const matches = text.match(amountPattern) ?? [];
  amountPattern.lastIndex = 0;
  return matches;
};

const dateMatches = (text: string): string[] => {
  datePattern.lastIndex = 0;
  const matches = [...text.matchAll(datePattern)].map((match) => match[0]);
  datePattern.lastIndex = 0;
  return matches;
};

const parseAmount = (raw: string): number | null => {
  let value = raw.toLowerCase().replace(/\b(?:rm|usd|cad|gbp)\b/g, "").replace(/[\s$€£()]/g, "");
  const comma = value.lastIndexOf(",");
  const dot = value.lastIndexOf(".");
  value = comma > dot ? value.replace(/\./g, "").replace(",", ".") : value.replace(/,/g, "");
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed < 1_000_000 ? parsed : null;
};

const amountKey = (raw: string): string | null => {
  const parsed = parseAmount(raw);
  return parsed === null ? null : parsed.toFixed(2);
};

const outputAmount = (raw: string): string => raw.replace(/\s+/g, "").replace(/[€£]/g, "$");

const validDate = (year: number, month: number, day: number): string | null => {
  const date = new Date(Date.UTC(year, month - 1, day));
  return Number.isInteger(year) && Number.isInteger(month) && Number.isInteger(day)
    && year >= 2000 && month >= 1 && month <= 12 && day >= 1 && date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
    : null;
};

const monthNumbers: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5,
  jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

const normalizeDate = (raw: string): string | null => {
  const text = normalizeLine(raw).replace(/\s*,\s*/g, ", ");
  let match = text.match(/^(\d{1,2})[/. -](\d{1,2})[/. -](20\d{2}|\d{2})$/);
  if (match) {
    const first = Number(match[1]);
    const second = Number(match[2]);
    const year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
    if (first <= 12 && second <= 12) return null;
    return first > 12 ? validDate(year, second, first) : validDate(year, first, second);
  }
  match = text.match(/^([A-Za-z]+)\s+(\d{1,2})(?:,\s*|\s+)(20\d{2})$/);
  if (match) return validDate(Number(match[3]), monthNumbers[match[1].toLowerCase()] ?? 0, Number(match[2]));
  match = text.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(20\d{2})$/);
  return match ? validDate(Number(match[3]), monthNumbers[match[2].toLowerCase()] ?? 0, Number(match[1])) : null;
};

const geometry = (line: ReceiptOcrLine, fallbackIndex: number): Geometry => {
  const bbox = line.bbox ?? { x0: 0, y0: fallbackIndex, x1: 1, y1: fallbackIndex + 1 };
  const x0 = Math.min(finite(bbox.x0), finite(bbox.x1));
  const x1 = Math.max(finite(bbox.x0), finite(bbox.x1));
  const y0 = Math.min(finite(bbox.y0), finite(bbox.y1));
  const y1 = Math.max(finite(bbox.y0), finite(bbox.y1));
  return { x0, y0, x1, y1, width: Math.max(1, x1 - x0), height: Math.max(1, y1 - y0), centerX: (x0 + x1) / 2, centerY: (y0 + y1) / 2 };
};

const inferredPage = (bands: ReceiptRouterBandInput[], lines: ReceiptOcrLine[] = []): { width: number; height: number } => {
  const all = [...lines, ...bands.flatMap((band) => band.lines)];
  const maxX = Math.max(1, ...all.map((line, index) => geometry(line, index).x1), ...bands.map((band) => band.width));
  const maxY = Math.max(1, ...all.map((line, index) => geometry(line, index).y1), ...bands.map((band) => band.bottom));
  return { width: maxX, height: maxY };
};

const confidenceFraction = (value: unknown): number => {
  const number = finite(value, 75);
  return clamp(number > 1 ? number / 100 : number);
};

const lineStats = (lines: ReceiptOcrLine[], pageWidth: number, pageHeight: number) => {
  const nonEmpty = lines.filter((line) => normalizeLine(line.text).length > 0);
  const geometries = nonEmpty.map((line, index) => geometry(line, index));
  const textLength = nonEmpty.reduce((sum, line) => sum + normalizeLine(line.text).length, 0);
  const area = geometries.reduce((sum, box) => sum + box.width * box.height, 0);
  const heights = geometries.map((box) => box.height).sort((a, b) => a - b);
  const medianHeight = heights.length ? heights[Math.floor(heights.length / 2)] : 1;
  const confidence = nonEmpty.map((line) => confidenceFraction(line.confidence));
  const amounts = nonEmpty.filter((line) => amountMatches(line.text).length > 0).length;
  const dates = nonEmpty.filter((line) => dateMatches(line.text).length > 0).length;
  const currency = nonEmpty.filter((line) => currencyPattern.test(line.text)).length;
  const keywordRate = (category: ReceiptHierarchicalCategory): number => nonEmpty.filter((line) => categoryKeyword(category, line.text)).length / Math.max(1, nonEmpty.length);
  const sortedY = geometries.map((box) => box.centerY).sort((a, b) => a - b);
  const gaps = sortedY.slice(1).map((value, index) => value - sortedY[index]);
  const rightAligned = geometries.filter((box) => box.x1 / pageWidth >= 0.78).length;
  const topLines = geometries.filter((box) => box.centerY / pageHeight < 0.24).length;
  const bottomLines = geometries.filter((box) => box.centerY / pageHeight > 0.76).length;
  const wideLines = geometries.filter((box) => box.width / pageWidth > 0.72).length;
  const sparseGaps = gaps.filter((gap) => gap > medianHeight * 2.5).length;
  const candidate = (category: ReceiptHierarchicalCategory): boolean => {
    if (category === "vendor") return nonEmpty.some((line, index) => {
      const value = normalizeLine(line.text);
      const letters = (value.match(/[A-Za-z]/g) ?? []).length;
      return index < 8 && letters >= 3 && letters / Math.max(1, value.length) >= 0.35 && !amountMatches(value).length;
    });
    if (category === "purchase_date") return dates > 0;
    if (category === "subtotal" || category === "tax") return nonEmpty.some((line) => categoryKeyword(category, line.text)) && amounts > 0;
    if (category === "total") return nonEmpty.some((line) => categoryKeyword(category, line.text)) && amounts > 0;
    if (category === "receipt_id") return nonEmpty.some((line) => categoryKeyword(category, line.text) && /[A-Z0-9]{3,}/i.test(line.text));
    if (category === "item") return nonEmpty.some((line) => categoryKeyword(category, line.text)) || amounts >= 3;
    return false;
  };
  return { nonEmpty, geometries, textLength, area, medianHeight, confidence, amounts, dates, currency, keywordRate, sortedY, gaps, rightAligned, topLines, bottomLines, wideLines, sparseGaps, candidate };
};

/** Feature vector shared exactly with the offline training script. */
export const hierarchicalRouterFeatures = (
  band: ReceiptRouterBandInput,
  pageWidth: number,
  pageHeight: number,
): number[] => {
  const safeWidth = Math.max(1, pageWidth);
  const safeHeight = Math.max(1, pageHeight);
  const stats = lineStats(band.lines, safeWidth, safeHeight);
  const count = stats.nonEmpty.length;
  const mean = (values: number[]): number => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  const lineCountDensity = count / Math.max(1, band.height / Math.max(1, stats.medianHeight));
  return [
    band.top / safeHeight,
    band.bottom / safeHeight,
    (band.top + band.bottom) / 2 / safeHeight,
    band.height / safeHeight,
    clamp(count / 16),
    clamp(lineCountDensity),
    mean(stats.confidence),
    stats.confidence.length ? Math.min(...stats.confidence) : 0,
    clamp(stats.medianHeight / safeHeight * 25),
    clamp(mean(stats.geometries.map((box) => box.width / safeWidth)) * 2),
    clamp(stats.textLength / Math.max(1, band.width * band.height) * 1800),
    mean(stats.nonEmpty.map((line) => (normalizeLine(line.text).match(/[A-Za-z]/g) ?? []).length / Math.max(1, normalizeLine(line.text).length))),
    mean(stats.nonEmpty.map((line) => (normalizeLine(line.text).match(/[0-9]/g) ?? []).length / Math.max(1, normalizeLine(line.text).length))),
    stats.amounts / Math.max(1, count),
    stats.dates / Math.max(1, count),
    stats.currency / Math.max(1, count),
    stats.keywordRate("vendor"),
    stats.keywordRate("purchase_date"),
    stats.keywordRate("subtotal"),
    stats.keywordRate("tax"),
    stats.keywordRate("total"),
    stats.keywordRate("receipt_id"),
    stats.keywordRate("item"),
    stats.topLines / Math.max(1, count),
    stats.bottomLines / Math.max(1, count),
    stats.rightAligned / Math.max(1, count),
    stats.wideLines / Math.max(1, count),
    stats.sparseGaps / Math.max(1, stats.gaps.length),
    count ? 1 : 0,
    stats.candidate("vendor") ? 1 : 0,
    stats.candidate("purchase_date") ? 1 : 0,
    stats.candidate("subtotal") ? 1 : 0,
    stats.candidate("tax") ? 1 : 0,
    stats.candidate("total") ? 1 : 0,
    stats.candidate("receipt_id") ? 1 : 0,
    stats.candidate("item") ? 1 : 0,
  ];
};

const sigmoid = (value: number): number => 1 / (1 + Math.exp(-Math.max(-40, Math.min(40, value))));

const modelProbability = (configuration: LogisticModel | undefined, features: number[]): number => {
  if (!configuration || configuration.type !== "logistic" || !configuration.weights.length) return 0;
  const raw = sigmoid(configuration.weights[0] + configuration.weights.slice(1).reduce((sum, weight, index) => sum + weight * (features[index] ?? 0), 0));
  const calibration = configuration.calibration ?? [];
  const point = calibration.find((candidate) => raw < candidate.max) ?? calibration[calibration.length - 1];
  return clamp(point?.accuracy ?? raw);
};

const rawModelProbability = (configuration: LogisticModel | undefined, features: number[]): number => {
  if (!configuration || configuration.type !== "logistic" || !configuration.weights.length) return 0;
  return sigmoid(configuration.weights[0] + configuration.weights.slice(1).reduce((sum, weight, index) => sum + weight * (features[index] ?? 0), 0));
};

const routerThreshold = (category: ReceiptHierarchicalCategory, overrides?: Partial<Record<ReceiptHierarchicalCategory, number>>): number => (
  overrides?.[category] ?? model.router?.[category]?.threshold ?? 0.7
);

const dominant = (probabilities: Record<ReceiptHierarchicalCategory, number>): ReceiptHierarchicalCategory => (
  [...RECEIPT_HIERARCHICAL_CATEGORIES].sort((left, right) => probabilities[right] - probabilities[left])[0] ?? "other"
);

export const classifyReceiptBands = (
  bands: ReceiptRouterBandInput[],
  options: Pick<ReceiptHierarchicalConfig, "maxCategoriesPerBand" | "routerThresholds"> = RECEIPT_HIERARCHICAL_EXPERIMENTAL_CONFIG,
): ReceiptRouterPrediction[] => {
  const dimensions = inferredPage(bands);
  return bands.map((band) => {
    const features = hierarchicalRouterFeatures(band, dimensions.width, dimensions.height);
    const probabilities = Object.fromEntries(RECEIPT_HIERARCHICAL_CATEGORIES.map((category) => [
      category,
      modelProbability(model.router?.[category], features),
    ])) as Record<ReceiptHierarchicalCategory, number>;
    const directEvidence = (category: ReceiptHierarchicalCategory): number => {
      const featureName = category === "purchase_date" ? "candidate_date" : `candidate_${category}`;
      const index = HIERARCHICAL_ROUTER_FEATURE_NAMES.indexOf(featureName as typeof HIERARCHICAL_ROUTER_FEATURE_NAMES[number]);
      return index >= 0 && features[index] >= 0.5 ? 1 : 0;
    };
    const routes = [...RECEIPT_HIERARCHICAL_CATEGORIES]
      .filter((category): category is ReceiptHierarchicalSpecialist => category !== "other" && probabilities[category] >= routerThreshold(category, options.routerThresholds))
      // The learned probability is primary. A small independently computed
      // candidate-evidence bonus keeps a direct total/date/merchant signal
      // from being crowded out by generic item/id bands when fan-out is capped.
      .sort((left, right) => {
        const leftScore = probabilities[left] + (directEvidence(left) && FIELDS.includes(left as ReceiptFrontendField) ? 0.35 : 0);
        const rightScore = probabilities[right] + (directEvidence(right) && FIELDS.includes(right as ReceiptFrontendField) ? 0.35 : 0);
        return rightScore - leftScore;
      })
      .slice(0, Math.max(1, Math.round(options.maxCategoriesPerBand)));
    return {
      bandIndex: band.bandIndex,
      observationKey: band.observationKey,
      top: band.top,
      bottom: band.bottom,
      probabilities,
      routes,
      dominantCategory: dominant(probabilities),
      lineCount: band.lines.filter((line) => normalizeLine(line.text)).length,
    };
  });
};

const categoryAnchorScore = (line: ReceiptOcrLine, category: ReceiptHierarchicalSpecialist, index: number, lineCount: number, pageHeight: number): number => {
  const text = normalizeLine(line.text);
  const box = geometry(line, index);
  const y = box.centerY / Math.max(1, pageHeight);
  const amount = amountMatches(text).length > 0;
  const date = dateMatches(text).length > 0;
  const keyword = categoryKeyword(category, text);
  const categoryBias = category === "vendor" ? 1 - Math.min(1, y * 2.4)
    : category === "purchase_date" ? 1 - Math.min(1, y * 1.8)
      : category === "item" ? 1 - Math.abs(y - 0.48) : y;
  return (keyword ? 4 : 0) + (category === "purchase_date" && date ? 3 : 0)
    + (category !== "vendor" && category !== "purchase_date" && amount ? 2 : 0)
    + categoryBias + confidenceFraction(line.confidence) * 0.5 + (index < Math.max(2, lineCount * 0.15) ? 0.5 : 0);
};

const categoryWindowFraction = (category: ReceiptHierarchicalSpecialist, mode: Exclude<ReceiptExpertWindowMode, "adaptive">, padding: number): number => {
  // Financial labels and their values are often separated by a faint/large
  // thermal-paper line gap (Walmart and adjustment invoices are common
  // examples). Give that specialist enough vertical context to see both the
  // label and its value; the independent-value gate below still rejects
  // competing amounts.
  const base = category === "item" ? 0.22 : category === "vendor" ? 0.12 : 0.15;
  const multiplier = mode === "tight" ? 0.72 : mode === "wide" ? 1.45 : 1;
  return clamp(base * multiplier * padding, 0.045, category === "item" ? 0.62 : 0.45);
};

const cropModeFor = (probability: number, configured: ReceiptExpertWindowMode): Exclude<ReceiptExpertWindowMode, "adaptive"> => {
  if (configured !== "adaptive") return configured;
  return probability >= 0.9 ? "tight" : probability >= 0.78 ? "medium" : "wide";
};

const overlapRatio = (left: ReceiptExpertCrop, right: ReceiptExpertCrop): number => {
  const overlap = Math.max(0, Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top));
  return overlap / Math.max(1, Math.min(left.height, right.height));
};

/** Build variable second-pass windows from router geometry. */
export const buildAdaptiveExpertCrops = (
  bands: ReceiptRouterBandInput[],
  predictions: ReceiptRouterPrediction[],
  config: Pick<ReceiptHierarchicalConfig, "windowMode" | "windowPadding" | "maxExpertInvocations"> = RECEIPT_HIERARCHICAL_EXPERIMENTAL_CONFIG,
): ReceiptExpertCrop[] => {
  const dimensions = inferredPage(bands);
  const byKey = new Map(bands.map((band) => [band.observationKey, band]));
  const crops: ReceiptExpertCrop[] = [];
  predictions.forEach((prediction) => {
    const band = byKey.get(prediction.observationKey);
    if (!band || !prediction.routes.length) return;
    const routed = prediction.routes.slice(0, 3);
    routed.forEach((category) => {
      const lines = band.lines.filter((line) => normalizeLine(line.text));
      const anchorLineIndex = lines.length
        ? lines.reduce((best, line, index) => categoryAnchorScore(line, category, index, lines.length, dimensions.height) > categoryAnchorScore(lines[best], category, best, lines.length, dimensions.height) ? index : best, 0)
        : null;
      const anchorBox = anchorLineIndex === null ? null : geometry(lines[anchorLineIndex], anchorLineIndex);
      const anchorY = anchorBox?.centerY ?? (band.top + band.bottom) / 2;
      const mode = cropModeFor(prediction.probabilities[category], config.windowMode);
      const height = dimensions.height * categoryWindowFraction(category, mode, config.windowPadding);
      const top = clamp(anchorY - height / 2, 0, dimensions.height - height);
      const sideGuard = dimensions.width * (category === "item" ? 0.025 : 0.045);
      const left = sideGuard;
      const right = Math.max(left + 1, dimensions.width - sideGuard);
      crops.push({
        cropId: `expert:${prediction.observationKey}:${category}`,
        category,
        mode,
        left,
        top,
        right,
        bottom: top + height,
        width: right - left,
        height,
        sourceBandIndex: prediction.bandIndex,
        sourceObservationKey: prediction.observationKey,
        sourceBandIndices: [prediction.bandIndex],
        routerProbability: prediction.probabilities[category],
        anchorLineIndex,
        anchorY,
      });
    });
  });
  crops.sort((left, right) => right.routerProbability - left.routerProbability);
  const selected: ReceiptExpertCrop[] = [];
  crops.forEach((crop) => {
    // Crops from different first-pass bands are separate OCR invocations and
    // may provide independent support. Only collapse a repeated crop from the
    // same source observation; deduplication of the returned text happens
    // later and never counts one observation key twice.
    const duplicate = selected.find((other) => other.category === crop.category
      && other.sourceObservationKey === crop.sourceObservationKey
      && overlapRatio(other, crop) >= 0.88
      && Math.abs(other.top - crop.top) <= Math.max(other.height, crop.height) * 0.18);
    if (duplicate) {
      duplicate.sourceBandIndices = [...new Set([...duplicate.sourceBandIndices, crop.sourceBandIndex])].sort((a, b) => a - b);
      return;
    }
    if (selected.length < Math.max(1, Math.round(config.maxExpertInvocations))) selected.push(crop);
  });
  return selected.sort((left, right) => left.top - right.top || left.category.localeCompare(right.category));
};

const categoryFieldLabel = (category: ReceiptHierarchicalSpecialist, text: string): boolean => categoryKeyword(category, text);

const expertFeatures = (
  lines: ReceiptOcrLine[],
  index: number,
  category: ReceiptHierarchicalSpecialist,
  crop: ReceiptExpertCrop,
  pageWidth: number,
  pageHeight: number,
): number[] => {
  const line = lines[index];
  const box = geometry(line, index);
  const previous = lines[index - 1]?.text ?? "";
  const next = lines[index + 1]?.text ?? "";
  const text = normalizeLine(line.text);
  const amounts = amountMatches(text);
  const dates = dateMatches(text);
  const position = amounts.length ? Math.max(0, text.indexOf(amounts[0])) / Math.max(1, text.length) : 0;
  const conf = confidenceFraction(line.confidence);
  return [
    index / Math.max(1, lines.length - 1),
    clamp((box.y0 - crop.top) / Math.max(1, crop.height)),
    clamp((box.y1 - crop.top) / Math.max(1, crop.height)),
    clamp(box.x0 / Math.max(1, pageWidth)),
    clamp(box.x1 / Math.max(1, pageWidth)),
    clamp(box.centerX / Math.max(1, pageWidth)),
    clamp(box.width / Math.max(1, pageWidth) * 2),
    clamp(box.height / Math.max(1, pageHeight) * 25),
    conf,
    clamp(text.length / 80),
    (text.match(/[A-Za-z]/g) ?? []).length / Math.max(1, text.length),
    (text.match(/[0-9]/g) ?? []).length / Math.max(1, text.length),
    clamp(amounts.length / 3),
    clamp(dates.length / 2),
    currencyPattern.test(text) ? 1 : 0,
    categoryFieldLabel(category, text) ? 1 : 0,
    categoryFieldLabel(category, previous) ? 1 : 0,
    categoryFieldLabel(category, next) ? 1 : 0,
    amountMatches(previous).length ? 1 : 0,
    amountMatches(next).length ? 1 : 0,
    dateMatches(previous).length ? 1 : 0,
    dateMatches(next).length ? 1 : 0,
    position,
    position >= 0.5 ? 1 : 0,
    box.x1 / Math.max(1, pageWidth) >= 0.78 ? 1 : 0,
    index && Math.abs(box.centerY - geometry(lines[index - 1], index - 1).centerY) > box.height * 2.5 ? 1 : 0,
    index + 1 < lines.length && Math.abs(geometry(lines[index + 1], index + 1).centerY - box.centerY) > box.height * 2.5 ? 1 : 0,
    crop.routerProbability,
    box.centerY / Math.max(1, pageHeight) < 0.25 ? 1 : 0,
    box.centerY / Math.max(1, pageHeight) > 0.75 ? 1 : 0,
    text.length > 32 ? 1 : 0,
    categoryFieldLabel(category, text) ? 1 : 0,
  ];
};

const editSimilarity = (left: string, right: string): number => {
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.includes(right) || right.includes(left)) return Math.min(left.length, right.length) / Math.max(left.length, right.length);
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    let diagonal = previous[0];
    previous[0] = row;
    for (let column = 1; column <= right.length; column += 1) {
      const saved = previous[column];
      previous[column] = Math.min(previous[column] + 1, previous[column - 1] + 1, diagonal + (left[row - 1] === right[column - 1] ? 0 : 1));
      diagonal = saved;
    }
  }
  return 1 - previous[right.length] / Math.max(left.length, right.length);
};

const normalizedValue = (field: ReceiptFrontendField | ReceiptHierarchicalSpecialist, value: string): string => {
  if (field === "vendor") return lower(value).replace(/[^a-z0-9]/g, "");
  if (field === "purchase_date") return normalizeDate(value) ?? value;
  if (field === "receipt_id" || field === "item") return lower(value).replace(/[^a-z0-9.-]/g, "");
  return amountKey(value) ?? lower(value).replace(/[^a-z0-9.-]/g, "");
};

interface ExpertCandidate {
  field: ReceiptFrontendField | ReceiptHierarchicalSpecialist;
  category: ReceiptHierarchicalSpecialist;
  value: string;
  canonical: string;
  line: ReceiptOcrLine;
  lineIndex: number;
  probability: number;
  confidence: number;
  evidence: string;
  observationKey: string;
  cropId: string;
  bandIndex: number;
  isFirstPass: boolean;
  finalTotalLabel: boolean;
}

const blockedVendor = /^(?:store|shop)$|\b(?:receipt|invoice|subtotal|sub-total|total|tax|gst|hst|date|cashier|address|tel|phone|thank|change|tender)\b/i;
const excludedTotal = /\b(?:qty|quantity|items?|excluding|excl\.?|before\s+tax|subtotal|sub-total|tax\s+amount|round(?:ing)?\s+adjustment|suppl(?:y|ies)|saving|discount)\b/i;
const strongTotalLabel = /\b(?:grand\s+total|total\s+(?:due|payable|amt|amount|rounded|round(?:ed)?|incl(?:usive)?|including)|amount\s+due|balance\s+due|payable|final\s+total|round(?:ed|ing)?\s+\w*\s+total)\b/i;

const candidateValues = (lines: ReceiptOcrLine[], field: ReceiptFrontendField | ReceiptHierarchicalSpecialist): Array<{ index: number; value: string }> => {
  const result: Array<{ index: number; value: string }> = [];
  if (field === "vendor") {
    lines.slice(0, 18).forEach((line, index) => {
      const text = normalizeLine(line.text);
      const letters = (text.match(/[A-Za-z]/g) ?? []).length;
      if (letters >= 3 && letters / Math.max(1, text.length) >= 0.35 && text.length <= 80 && !blockedVendor.test(text) && !amountMatches(text).length) result.push({ index, value: text });
    });
  } else if (field === "purchase_date") {
    lines.forEach((line, index) => dateMatches(line.text).forEach((raw) => {
      const value = normalizeDate(raw);
      if (value) result.push({ index, value });
    }));
  } else if (field === "receipt_id") {
    lines.forEach((line, index) => {
      const text = normalizeLine(line.text);
      if (!categoryKeyword("receipt_id", text) || !/[A-Z0-9]{3,}/i.test(text)) return;
      const match = text.match(/(?:invoice|receipt|order|transaction|trans|reference|ref|id|no\.?|number)\s*[:#-]?\s*([A-Z0-9][A-Z0-9-]{2,})/i);
      if (match) result.push({ index, value: match[1] });
    });
  } else if (field === "item") {
    lines.forEach((line, index) => {
      const text = normalizeLine(line.text);
      if (text.length >= 3 && (amountMatches(text).length || categoryKeyword("item", text))) result.push({ index, value: text });
    });
  } else {
    lines.forEach((line, index) => amountMatches(line.text).forEach((raw) => {
      if (parseAmount(raw) === null) return;
      const value = outputAmount(raw);
      if ((field === "subtotal" || field === "tax") && ![index - 1, index, index + 1].some((near) => near >= 0 && near < lines.length && categoryKeyword(field, lines[near].text))) return;
      result.push({ index, value });
    }));
  }
  return result;
};

const makeCandidate = (
  line: ReceiptOcrLine,
  lineIndex: number,
  value: string,
  field: ReceiptFrontendField | ReceiptHierarchicalSpecialist,
  crop: ReceiptExpertCrop,
  observation: ReceiptHierarchicalObservation,
  lines: ReceiptOcrLine[],
  pageWidth: number,
  pageHeight: number,
): ExpertCandidate => {
  const features = expertFeatures(lines, lineIndex, crop.category, crop, pageWidth, pageHeight);
  const raw = rawModelProbability(model.experts?.[crop.category], features);
  const probability = modelProbability(model.experts?.[crop.category], features);
  const confidence = clamp(probability * (0.65 + 0.35 * confidenceFraction(line.confidence)));
  const previousText = normalizeLine(lines[lineIndex - 1]?.text ?? "");
  const currentText = normalizeLine(line.text);
  return {
    field,
    category: crop.category,
    value,
    canonical: normalizedValue(field, value),
    line,
    lineIndex,
    probability: raw,
    confidence: clamp(probability * (0.65 + 0.35 * confidenceFraction(line.confidence))),
    evidence: [lines[lineIndex - 1]?.text, line.text, lines[lineIndex + 1]?.text].filter(Boolean).map(normalizeLine).join(" "),
    observationKey: observation.observationKey,
    cropId: observation.cropId ?? crop.cropId,
    bandIndex: observation.bandIndex,
    isFirstPass: observation.sourcePass === "first-pass",
    // Receipt formats normally print the total label on the same line as, or
    // immediately above, the amount. A following label must not bless the
    // previous amount (e.g. "Total 0% supplies: 12.98" followed by
    // "Total Payable: -1.73").
    finalTotalLabel: crop.category === "total" && strongTotalLabel.test(currentText + " " + previousText),
  };
};

const emptyField = (): ReceiptHierarchicalFieldResult => ({
  value: null,
  confidence: 0,
  status: "missing",
  source: "ml",
  evidence: "",
  supportBandCount: 0,
  independentObservationCount: 0,
  trustedSupportCount: 0,
  agreement: false,
  competingValueCount: 0,
  routedSupportCount: 0,
});

const selectCandidates = (
  field: ReceiptFrontendField,
  candidates: ExpertCandidate[],
  minIndependentObservations: number,
  expertThresholdOverride?: number,
  expertMinConfidenceOverride?: number,
): ReceiptHierarchicalFieldResult => {
  if (!candidates.length) return emptyField();
  // Financial specialists must select from explicitly labelled amounts when
  // one is available. This keeps a broad adaptive crop containing item prices,
  // subtotal, tax, and total from turning a merely high model score into a
  // trusted value. If no label is present, fail open for that field.
  const labelled = (field === "subtotal" || field === "tax" || field === "total")
    ? candidates.filter((candidate) => categoryKeyword(field, candidate.evidence))
    : candidates;
  if ((field === "subtotal" || field === "tax" || field === "total") && !labelled.length) return emptyField();
  candidates = labelled.length ? labelled : candidates;
  if (field === "total") {
    const finalLabelled = candidates.filter((candidate) => candidate.finalTotalLabel);
    if (!finalLabelled.length) return emptyField();
    candidates = finalLabelled;
  }
  const values = new Map<string, ExpertCandidate[]>();
  candidates.forEach((candidate) => {
    const existing = [...values.keys()].find((key) => key === candidate.canonical || (field === "vendor" && editSimilarity(key, candidate.canonical) >= 0.92));
    values.set(existing ?? candidate.canonical, [...(values.get(existing ?? candidate.canonical) ?? []), candidate]);
  });
  const ranked = [...values.entries()].map(([canonical, supports]) => {
    const distinctObservations = new Set(supports.map((candidate) => candidate.observationKey));
    const distinctBands = new Set(supports.map((candidate) => candidate.bandIndex));
    const strongest = [...supports].sort((left, right) => right.probability - left.probability)[0];
    return { canonical, supports, strongest, distinctObservations, distinctBands };
  }).sort((left, right) => {
    const leftSupport = left.distinctObservations.size;
    const rightSupport = right.distinctObservations.size;
    return (rightSupport - leftSupport) || (right.strongest.probability - left.strongest.probability);
  });
  const top = ranked[0];
  const second = ranked[1];
  const configuration = model.experts?.[FIELD_CATEGORY[field]];
  const threshold = expertThresholdOverride ?? configuration?.threshold ?? 0.8;
  const margin = top.strongest.probability - (second?.strongest.probability ?? 0);
  const topContext = top.supports.map((candidate) => candidate.evidence).join(" ");
  const strongLabel = [
    field === "vendor",
    field === "purchase_date" && /\b(?:date|time|issued|invoice)\b/i.test(topContext),
    (field === "subtotal" || field === "tax") && categoryKeyword(field, top.strongest.evidence),
    field === "total" && /\b(?:grand\s+total|total\s+due|amount\s+due|balance\s+due|payable|final\s+total|total)\b/i.test(topContext),
  ].some(Boolean);
  const allText = top.supports.map((candidate) => candidate.evidence).join(" ");
  // A bare "TOTAL" is routinely printed beside item/summary amounts.  It is
  // useful routing evidence, but not a conservative value label. Require a
  // semantic final-total label before trusting that specialist; otherwise the
  // field remains available to GPT/review and fails open.
  const excluded = field === "total" && excludedTotal.test(allText) && !/\b(?:grand|due|payable|final)\b/i.test(allText);
  const distinctLabelValues = new Set(candidates.filter((candidate) => categoryKeyword(field, candidate.evidence)).map((candidate) => candidate.canonical));
  const noAmbiguousDate = field !== "purchase_date" || values.size === 1;
  const competingWeak = ranked.slice(1).every((candidate) => candidate.strongest.probability < threshold - 0.05 && candidate.distinctObservations.size < minIndependentObservations);
  const safe = top.strongest.probability >= threshold
    && top.strongest.confidence >= (expertMinConfidenceOverride ?? configuration?.min_confidence ?? 0.98)
    && margin >= (configuration?.min_margin ?? 0.03)
    && top.distinctObservations.size >= minIndependentObservations
    && top.distinctBands.size >= minIndependentObservations
    && competingWeak
    && noAmbiguousDate
    && (field === "vendor" || field === "purchase_date" || strongLabel)
    && ((field !== "subtotal" && field !== "tax") || distinctLabelValues.size === 1)
    && !excluded;
  const trustedSupportCount = top.supports.filter((candidate) => candidate.probability >= threshold).length;
  return {
    value: top.strongest.value,
    confidence: top.strongest.confidence,
    status: safe ? "trusted" : "uncertain",
    source: "ml",
    evidence: `${top.strongest.evidence} (hierarchical ${Math.round(top.strongest.confidence * 100)}%, ${top.distinctObservations.size} independent observation${top.distinctObservations.size === 1 ? "" : "s"}${ranked.length > 1 ? ", competing values" : ""})`,
    supportBandCount: top.distinctBands.size,
    independentObservationCount: top.distinctObservations.size,
    trustedSupportCount,
    agreement: top.distinctObservations.size >= minIndependentObservations && ranked.length === 1,
    competingValueCount: ranked.length,
    routedSupportCount: candidates.length,
  };
};

const selectSpecialist = (
  category: "receipt_id" | "item",
  candidates: ExpertCandidate[],
  minIndependentObservations: number,
): ReceiptHierarchicalSpecialistResult => {
  if (!candidates.length) return { category, value: null, confidence: 0, status: "missing", evidence: "", supportBandCount: 0, independentObservationCount: 0, routedSupportCount: 0 };
  const grouped = new Map<string, ExpertCandidate[]>();
  candidates.forEach((candidate) => grouped.set(candidate.canonical, [...(grouped.get(candidate.canonical) ?? []), candidate]));
  const ranked = [...grouped.values()].sort((left, right) => right.length - left.length || right[0].probability - left[0].probability);
  const supports = ranked[0];
  const observations = new Set(supports.map((candidate) => candidate.observationKey));
  const bands = new Set(supports.map((candidate) => candidate.bandIndex));
  const configuration = model.experts?.[category];
  const threshold = configuration?.threshold ?? 0.8;
  const safe = supports[0].probability >= threshold && supports[0].confidence >= (configuration?.min_confidence ?? 0.98) && observations.size >= minIndependentObservations && ranked.length === 1;
  return { category, value: supports[0].value, confidence: supports[0].confidence, status: safe ? "trusted" : "uncertain", evidence: `${supports[0].evidence} (hierarchical ${Math.round(supports[0].confidence * 100)}%)`, supportBandCount: bands.size, independentObservationCount: observations.size, routedSupportCount: candidates.length };
};

const groupObservationLines = (observations: ReceiptHierarchicalObservation[]): Map<string, ReceiptHierarchicalObservation[]> => {
  const groups = new Map<string, ReceiptHierarchicalObservation[]>();
  observations.forEach((observation) => groups.set(observation.observationKey, [...(groups.get(observation.observationKey) ?? []), observation]));
  return groups;
};

const candidateForGroup = (
  lines: ReceiptHierarchicalObservation[],
  crop: ReceiptExpertCrop,
  field: ReceiptFrontendField | ReceiptHierarchicalSpecialist,
  pageWidth: number,
  pageHeight: number,
): ExpertCandidate[] => candidateValues(lines, field).map(({ index, value }) => makeCandidate(lines[index], index, value, field, crop, lines[index], lines, pageWidth, pageHeight));

const emptySpecialist = (category: "receipt_id" | "item"): ReceiptHierarchicalSpecialistResult => ({ category, value: null, confidence: 0, status: "missing", evidence: "", supportBandCount: 0, independentObservationCount: 0, routedSupportCount: 0 });

/**
 * Aggregate first-pass and expert observations with independent per-field
 * gates. The router can decide where to spend OCR work, but it cannot make a
 * value trusted; only the matching specialist and its own observations can.
 */
export const extractReceiptFieldsFromHierarchicalBands = (
  firstPassObservations: ReceiptHierarchicalObservation[],
  expertObservations: ReceiptHierarchicalObservation[],
  options: {
    config?: ReceiptHierarchicalConfig;
    routerPredictions?: ReceiptRouterPrediction[];
    expertCrops?: ReceiptExpertCrop[];
    pageWidth?: number;
    pageHeight?: number;
  } = {},
): ReceiptHierarchicalExtraction => {
  const config = options.config ?? RECEIPT_HIERARCHICAL_EXPERIMENTAL_CONFIG;
  const allLines = [...firstPassObservations, ...expertObservations];
  const dimensions = options.pageWidth && options.pageHeight ? { width: options.pageWidth, height: options.pageHeight } : inferredPage([],
    allLines);
  const firstBands = [...groupObservationLines(firstPassObservations).entries()].map(([observationKey, lines]) => ({
    bandIndex: lines[0]?.bandIndex ?? -1,
    observationKey,
    top: Math.min(...lines.map((line) => line.bandTop)),
    bottom: Math.max(...lines.map((line) => line.bandBottom), 1),
    width: dimensions.width,
    height: Math.max(1, Math.max(...lines.map((line) => line.bandBottom), 1) - Math.min(...lines.map((line) => line.bandTop), 0)),
    lines,
  }));
  const predictions = options.routerPredictions ?? classifyReceiptBands(firstBands, config);
  const crops = options.expertCrops ?? buildAdaptiveExpertCrops(firstBands, predictions, config);
  const cropById = new Map(crops.map((crop) => [crop.cropId, crop]));
  const routedFirst = new Set(predictions.filter((prediction) => prediction.routes.length).map((prediction) => prediction.observationKey));
  const groups = groupObservationLines(expertObservations);
  const candidatesFor = (field: ReceiptFrontendField): ExpertCandidate[] => {
    const category = FIELD_CATEGORY[field];
    const candidates: ExpertCandidate[] = [];
    groups.forEach((lines, observationKey) => {
      const first = lines[0];
      if (first.expertCategory !== category) return;
      const crop = cropById.get(first.cropId ?? "") ?? {
        cropId: first.cropId ?? observationKey,
        category,
        mode: "medium" as const,
        left: 0,
        top: first.bandTop,
        right: dimensions.width,
        bottom: first.bandBottom,
        width: dimensions.width,
        height: Math.max(1, first.bandBottom - first.bandTop),
        sourceBandIndex: first.bandIndex,
        sourceObservationKey: observationKey,
        sourceBandIndices: [first.bandIndex],
        routerProbability: first.routerProbability ?? 0,
        anchorLineIndex: null,
        anchorY: (first.bandTop + first.bandBottom) / 2,
      };
      candidates.push(...candidateForGroup(lines, crop, field, dimensions.width, dimensions.height));
    });
    // A first-pass line is only an evidence fallback for a category that was
    // actually routed. It is never treated as a specialist invocation.
    if (!candidates.length) firstPassObservations.filter((line) => routedFirst.has(line.observationKey)).forEach((line) => {
      const prediction = predictions.find((item) => item.observationKey === line.observationKey);
      if (!prediction?.routes.includes(category)) return;
      const crop: ReceiptExpertCrop = {
        cropId: `first-pass:${line.observationKey}:${category}`,
        category,
        mode: "wide",
        left: 0,
        top: line.bandTop,
        right: dimensions.width,
        bottom: line.bandBottom,
        width: dimensions.width,
        height: Math.max(1, line.bandBottom - line.bandTop),
        sourceBandIndex: line.bandIndex,
        sourceObservationKey: line.observationKey,
        sourceBandIndices: [line.bandIndex],
        routerProbability: prediction.probabilities[category],
        anchorLineIndex: null,
        anchorY: (line.bandTop + line.bandBottom) / 2,
      };
      candidates.push(...candidateForGroup([line], crop, field, dimensions.width, dimensions.height));
    });
    return candidates;
  };
  const fields = Object.fromEntries(FIELDS.map((field) => [field, selectCandidates(field, candidatesFor(field), config.minIndependentObservations, config.expertThresholds?.[FIELD_CATEGORY[field]], config.expertMinConfidence?.[FIELD_CATEGORY[field]])])) as Record<ReceiptFrontendField, ReceiptHierarchicalFieldResult>;
  const specialistCandidates = (category: "receipt_id" | "item"): ExpertCandidate[] => {
    const candidates: ExpertCandidate[] = [];
    groups.forEach((lines, observationKey) => {
      const first = lines[0];
      if (first.expertCategory !== category) return;
      const crop = cropById.get(first.cropId ?? "") ?? {
        cropId: first.cropId ?? observationKey,
        category,
        mode: "medium" as const,
        left: 0,
        top: first.bandTop,
        right: dimensions.width,
        bottom: first.bandBottom,
        width: dimensions.width,
        height: Math.max(1, first.bandBottom - first.bandTop),
        sourceBandIndex: first.bandIndex,
        sourceObservationKey: observationKey,
        sourceBandIndices: [first.bandIndex],
        routerProbability: first.routerProbability ?? 0,
        anchorLineIndex: null,
        anchorY: (first.bandTop + first.bandBottom) / 2,
      };
      candidates.push(...candidateForGroup(lines, crop, category, dimensions.width, dimensions.height));
    });
    return candidates;
  };
  const specialists = {
    receipt_id: specialistCandidates("receipt_id").length ? selectSpecialist("receipt_id", specialistCandidates("receipt_id"), config.minIndependentObservations) : emptySpecialist("receipt_id"),
    item: specialistCandidates("item").length ? selectSpecialist("item", specialistCandidates("item"), config.minIndependentObservations) : emptySpecialist("item"),
  };
  const merged = deduplicateReceiptBandLines(allLines);
  const routedCategoryCounts = Object.fromEntries(RECEIPT_HIERARCHICAL_CATEGORIES.filter((category): category is ReceiptHierarchicalSpecialist => category !== "other").map((category) => [category, predictions.filter((prediction) => prediction.routes.includes(category)).length])) as Record<ReceiptHierarchicalSpecialist, number>;
  const trustedRoutes = predictions.filter((prediction) => prediction.routes.length).length;
  const unresolvedFields = FIELDS.filter((field) => fields[field].status !== "trusted");
  return {
    text: merged.map((line) => line.text).join("\n"),
    fields,
    unresolvedFields,
    durationMs: 0,
    engine: "ppocrv6-hierarchical-bands",
    ocrLines: merged,
    specialists,
    routerPredictions: predictions,
    expertCrops: crops,
    mergedLines: merged,
    routing: {
      firstPassBandCount: firstBands.length,
      routedBandCount: trustedRoutes,
      routedCategoryCounts,
      specialistInvocationCount: crops.length,
      skippedSpecialistCount: Math.max(0, predictions.length * 7 - crops.length),
    },
    deduplication: {
      inputLineCount: allLines.length,
      mergedLineCount: merged.length,
      duplicateLineCount: Math.max(0, allLines.length - merged.length),
      multiBandLineCount: merged.filter((line) => line.independentBandCount > 1).length,
      meanSupportCount: merged.length ? merged.reduce((sum, line) => sum + line.supportCount, 0) / merged.length : 0,
      expertInputLineCount: expertObservations.length,
    },
  };
};

/** Convert a source image crop to the browser runner's normalized rectangle. */
export const expertCropRectangle = (crop: ReceiptExpertCrop, pageWidth: number, pageHeight: number): { left: number; top: number; width: number; height: number } => ({
  left: clamp(crop.left / Math.max(1, pageWidth)),
  top: clamp(crop.top / Math.max(1, pageHeight)),
  width: clamp(crop.width / Math.max(1, pageWidth)),
  height: clamp(crop.height / Math.max(1, pageHeight)),
});

export const hierarchicalModelInfo = (): { routerBytes: number; expertBytes: number; totalBytes: number; routerCategories: number; expertCategories: number } => {
  const routerBytes = JSON.stringify(model.router ?? {}).length;
  const expertBytes = JSON.stringify(model.experts ?? {}).length;
  return { routerBytes, expertBytes, totalBytes: routerBytes + expertBytes, routerCategories: Object.keys(model.router ?? {}).length, expertCategories: Object.keys(model.experts ?? {}).length };
};
