import type {
  ReceiptFrontendExtraction,
  ReceiptFrontendField,
  ReceiptFrontendFieldResult,
  ReceiptFrontendFields,
} from "@/lib/receiptFrontendExtractor";
import type { ReceiptOcrBox, ReceiptOcrLine, ReceiptOcrPreprocessing } from "@/lib/receiptOcr";
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
  "header_region_prior",
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
  "top_region", "bottom_region", "long_text", "strong_label", "opposing_label",
  "strong_semantic_label", "numeric_only", "label_distance", "line_length_bucket",
  "financial_association", "financial_label_same_line", "financial_column_match",
  "financial_strong_label", "financial_opposing", "financial_amount_rank",
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
  /** Recall-first ranking scores. These are routing priorities, never trust scores. */
  rankingScores?: Record<ReceiptHierarchicalSpecialist, number>;
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
  /** Number of highest-ranked bands to expose to each specialist. */
  topBandsPerCategory?: Partial<Record<ReceiptHierarchicalSpecialist, number>>;
  /** Broaden vendor routing in the header without weakening final field gates. */
  vendorHeaderPrior?: boolean;
  expertThresholds?: Partial<Record<ReceiptHierarchicalSpecialist, number>>;
  expertMinConfidence?: Partial<Record<ReceiptHierarchicalSpecialist, number>>;
  /** Field/category-specific agreement minimums. */
  minIndependentObservationsByCategory?: Partial<Record<ReceiptHierarchicalSpecialist, 1 | 2 | 3>>;
  /** Permit a single very strong, semantically labelled observation. */
  allowStrongSingleObservation?: Partial<Record<ReceiptHierarchicalSpecialist, boolean>>;
  strongPredictionThreshold?: Partial<Record<ReceiptHierarchicalSpecialist, number>>;
  strongConfidenceThreshold?: Partial<Record<ReceiptHierarchicalSpecialist, number>>;
  /** Optional second-pass preprocessing views; views from one crop are not independent votes. */
  expertPreprocessingVariants?: readonly ReceiptOcrPreprocessing[];
  /** Stop requesting later category crops after that category is safely trusted. */
  earlyStopTrustedFields?: boolean;
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
  {
    name: "high-recall-fanout-top1",
    firstPassConfigName: "fraction40-overlap40-contrast-2200-rules-hybrid",
    windowMode: "adaptive",
    maxCategoriesPerBand: 1,
    maxExpertInvocations: 10,
    minIndependentObservations: 2,
    windowPadding: 1,
    vendorHeaderPrior: true,
    topBandsPerCategory: { vendor: 2, purchase_date: 2, subtotal: 2, tax: 1, total: 2, receipt_id: 3, item: 3 },
    expertThresholds: { vendor: 0.35, purchase_date: 0.35, subtotal: 0.35, tax: 0.45, total: 0.55, receipt_id: 0.25, item: 0.35 },
    expertMinConfidence: { vendor: 0.55, purchase_date: 0.55, subtotal: 0.55, tax: 0.55, total: 0.55, receipt_id: 0.55, item: 0.55 },
  },
  {
    name: "high-recall-fanout-top2",
    firstPassConfigName: "fraction40-overlap40-contrast-2200-rules-hybrid",
    windowMode: "adaptive",
    maxCategoriesPerBand: 2,
    maxExpertInvocations: 14,
    minIndependentObservations: 2,
    windowPadding: 1,
    vendorHeaderPrior: true,
    topBandsPerCategory: { vendor: 2, purchase_date: 2, subtotal: 2, tax: 1, total: 2, receipt_id: 3, item: 3 },
    expertThresholds: { vendor: 0.35, purchase_date: 0.35, subtotal: 0.35, tax: 0.45, total: 0.55, receipt_id: 0.25, item: 0.35 },
    expertMinConfidence: { vendor: 0.55, purchase_date: 0.55, subtotal: 0.55, tax: 0.55, total: 0.55, receipt_id: 0.55, item: 0.55 },
  },
  {
    name: "high-recall-fanout-top3",
    firstPassConfigName: "fraction40-overlap40-contrast-2200-rules-hybrid",
    windowMode: "adaptive",
    maxCategoriesPerBand: 3,
    maxExpertInvocations: 18,
    minIndependentObservations: 2,
    windowPadding: 1,
    vendorHeaderPrior: true,
    topBandsPerCategory: { vendor: 2, purchase_date: 2, subtotal: 2, tax: 1, total: 2, receipt_id: 3, item: 3 },
    expertThresholds: { vendor: 0.35, purchase_date: 0.35, subtotal: 0.35, tax: 0.45, total: 0.55, receipt_id: 0.25, item: 0.35 },
    expertMinConfidence: { vendor: 0.55, purchase_date: 0.55, subtotal: 0.55, tax: 0.55, total: 0.55, receipt_id: 0.55, item: 0.55 },
  },
  {
    name: "specialist-calibrated-top3-tight",
    firstPassConfigName: "fraction40-overlap40-contrast-2200-rules-hybrid",
    windowMode: "tight",
    maxCategoriesPerBand: 3,
    maxExpertInvocations: 18,
    minIndependentObservations: 2,
    windowPadding: 0.9,
    vendorHeaderPrior: true,
    topBandsPerCategory: { vendor: 2, purchase_date: 2, subtotal: 2, tax: 1, total: 2, receipt_id: 3, item: 3 },
    expertThresholds: { vendor: 0.30, purchase_date: 0.30, subtotal: 0.25, tax: 0.25, total: 0.52, receipt_id: 0.20, item: 0.25 },
    expertMinConfidence: { vendor: 0.48, purchase_date: 0.48, subtotal: 0.45, tax: 0.45, total: 0.52, receipt_id: 0.45, item: 0.45 },
    minIndependentObservationsByCategory: { vendor: 2, purchase_date: 1, subtotal: 2, tax: 2, total: 2, receipt_id: 2, item: 2 },
    allowStrongSingleObservation: { vendor: true, purchase_date: true, receipt_id: true },
    strongPredictionThreshold: { vendor: 0.86, purchase_date: 0.82, receipt_id: 0.90 },
    strongConfidenceThreshold: { vendor: 0.80, purchase_date: 0.80, receipt_id: 0.86 },
    earlyStopTrustedFields: true,
  },
  {
    name: "specialist-calibrated-top3-medium",
    firstPassConfigName: "fraction40-overlap40-contrast-2200-rules-hybrid",
    windowMode: "medium",
    maxCategoriesPerBand: 3,
    maxExpertInvocations: 18,
    minIndependentObservations: 2,
    windowPadding: 1,
    vendorHeaderPrior: true,
    topBandsPerCategory: { vendor: 2, purchase_date: 2, subtotal: 2, tax: 1, total: 2, receipt_id: 3, item: 3 },
    expertThresholds: { vendor: 0.30, purchase_date: 0.30, subtotal: 0.25, tax: 0.25, total: 0.52, receipt_id: 0.20, item: 0.25 },
    expertMinConfidence: { vendor: 0.48, purchase_date: 0.48, subtotal: 0.45, tax: 0.45, total: 0.52, receipt_id: 0.45, item: 0.45 },
    minIndependentObservationsByCategory: { vendor: 2, purchase_date: 1, subtotal: 2, tax: 2, total: 2, receipt_id: 2, item: 2 },
    allowStrongSingleObservation: { vendor: true, purchase_date: true, receipt_id: true },
    strongPredictionThreshold: { vendor: 0.86, purchase_date: 0.82, receipt_id: 0.90 },
    strongConfidenceThreshold: { vendor: 0.80, purchase_date: 0.80, receipt_id: 0.86 },
    earlyStopTrustedFields: true,
  },
  {
    name: "specialist-calibrated-top3-wide",
    firstPassConfigName: "fraction40-overlap40-contrast-2200-rules-hybrid",
    windowMode: "wide",
    maxCategoriesPerBand: 3,
    maxExpertInvocations: 18,
    minIndependentObservations: 2,
    windowPadding: 1.15,
    vendorHeaderPrior: true,
    topBandsPerCategory: { vendor: 2, purchase_date: 2, subtotal: 2, tax: 1, total: 2, receipt_id: 3, item: 3 },
    expertThresholds: { vendor: 0.30, purchase_date: 0.30, subtotal: 0.25, tax: 0.25, total: 0.52, receipt_id: 0.20, item: 0.25 },
    expertMinConfidence: { vendor: 0.48, purchase_date: 0.48, subtotal: 0.45, tax: 0.45, total: 0.52, receipt_id: 0.45, item: 0.45 },
    minIndependentObservationsByCategory: { vendor: 2, purchase_date: 1, subtotal: 2, tax: 2, total: 2, receipt_id: 2, item: 2 },
    allowStrongSingleObservation: { vendor: true, purchase_date: true, receipt_id: true },
    strongPredictionThreshold: { vendor: 0.86, purchase_date: 0.82, receipt_id: 0.90 },
    strongConfidenceThreshold: { vendor: 0.80, purchase_date: 0.80, receipt_id: 0.86 },
    earlyStopTrustedFields: true,
  },
  {
    name: "specialist-calibrated-top3-medium-multiview",
    firstPassConfigName: "fraction40-overlap40-contrast-2200-rules-hybrid",
    windowMode: "medium",
    maxCategoriesPerBand: 3,
    maxExpertInvocations: 18,
    minIndependentObservations: 2,
    windowPadding: 1,
    vendorHeaderPrior: true,
    topBandsPerCategory: { vendor: 2, purchase_date: 2, subtotal: 2, tax: 1, total: 2, receipt_id: 3, item: 3 },
    expertThresholds: { vendor: 0.30, purchase_date: 0.30, subtotal: 0.25, tax: 0.25, total: 0.52, receipt_id: 0.20, item: 0.25 },
    expertMinConfidence: { vendor: 0.48, purchase_date: 0.48, subtotal: 0.45, tax: 0.45, total: 0.52, receipt_id: 0.45, item: 0.45 },
    minIndependentObservationsByCategory: { vendor: 2, purchase_date: 1, subtotal: 2, tax: 2, total: 2, receipt_id: 2, item: 2 },
    allowStrongSingleObservation: { vendor: true, purchase_date: true, receipt_id: true },
    strongPredictionThreshold: { vendor: 0.86, purchase_date: 0.82, receipt_id: 0.90 },
    strongConfidenceThreshold: { vendor: 0.80, purchase_date: 0.80, receipt_id: 0.86 },
    expertPreprocessingVariants: ["original", "contrast"],
    earlyStopTrustedFields: true,
  },
  {
    name: "specialist-calibrated-top3-medium-safe-vendor87",
    firstPassConfigName: "fraction40-overlap40-contrast-2200-rules-hybrid",
    windowMode: "medium",
    maxCategoriesPerBand: 3,
    maxExpertInvocations: 18,
    minIndependentObservations: 2,
    windowPadding: 1,
    vendorHeaderPrior: true,
    topBandsPerCategory: { vendor: 2, purchase_date: 2, subtotal: 2, tax: 1, total: 2, receipt_id: 3, item: 3 },
    expertThresholds: { vendor: 0.30, purchase_date: 0.30, subtotal: 0.25, tax: 0.25, total: 0.60, receipt_id: 0.55, item: 0.25 },
    expertMinConfidence: { vendor: 0.48, purchase_date: 0.50, subtotal: 0.45, tax: 0.45, total: 0.60, receipt_id: 0.60, item: 0.45 },
    minIndependentObservationsByCategory: { vendor: 2, purchase_date: 1, subtotal: 2, tax: 2, total: 1, receipt_id: 1, item: 2 },
    allowStrongSingleObservation: { vendor: true, purchase_date: true, total: true, receipt_id: true },
    strongPredictionThreshold: { vendor: 0.87, purchase_date: 0.82, total: 0.88, receipt_id: 0.80 },
    strongConfidenceThreshold: { vendor: 0.84, purchase_date: 0.80, total: 0.84, receipt_id: 0.80 },
    earlyStopTrustedFields: true,
  },
  {
    name: "specialist-finance-top3-medium-support2",
    firstPassConfigName: "fraction40-overlap40-contrast-2200-rules-hybrid",
    windowMode: "medium",
    maxCategoriesPerBand: 3,
    maxExpertInvocations: 18,
    minIndependentObservations: 2,
    windowPadding: 1,
    vendorHeaderPrior: true,
    topBandsPerCategory: { vendor: 2, purchase_date: 2, subtotal: 3, tax: 2, total: 2, receipt_id: 3, item: 3 },
    expertThresholds: { vendor: 0.30, purchase_date: 0.30, subtotal: 0.25, tax: 0.25, total: 0.60, receipt_id: 0.55, item: 0.25 },
    expertMinConfidence: { vendor: 0.48, purchase_date: 0.50, subtotal: 0.45, tax: 0.45, total: 0.60, receipt_id: 0.60, item: 0.45 },
    minIndependentObservationsByCategory: { vendor: 2, purchase_date: 1, subtotal: 2, tax: 2, total: 1, receipt_id: 1, item: 2 },
    allowStrongSingleObservation: { vendor: true, purchase_date: true, subtotal: true, tax: true, total: true, receipt_id: true },
    strongPredictionThreshold: { vendor: 0.87, purchase_date: 0.82, subtotal: 0.82, tax: 0.82, total: 0.88, receipt_id: 0.80 },
    strongConfidenceThreshold: { vendor: 0.84, purchase_date: 0.80, subtotal: 0.78, tax: 0.78, total: 0.84, receipt_id: 0.80 },
    earlyStopTrustedFields: true,
  },
  {
    name: "specialist-finance-top3-wide-support2",
    firstPassConfigName: "fraction40-overlap40-contrast-2200-rules-hybrid",
    windowMode: "wide",
    maxCategoriesPerBand: 3,
    maxExpertInvocations: 18,
    minIndependentObservations: 2,
    windowPadding: 1.15,
    vendorHeaderPrior: true,
    topBandsPerCategory: { vendor: 2, purchase_date: 2, subtotal: 3, tax: 2, total: 2, receipt_id: 3, item: 3 },
    expertThresholds: { vendor: 0.30, purchase_date: 0.30, subtotal: 0.25, tax: 0.25, total: 0.60, receipt_id: 0.55, item: 0.25 },
    expertMinConfidence: { vendor: 0.48, purchase_date: 0.50, subtotal: 0.45, tax: 0.45, total: 0.60, receipt_id: 0.60, item: 0.45 },
    minIndependentObservationsByCategory: { vendor: 2, purchase_date: 1, subtotal: 2, tax: 2, total: 1, receipt_id: 1, item: 2 },
    allowStrongSingleObservation: { vendor: true, purchase_date: true, subtotal: true, tax: true, total: true, receipt_id: true },
    strongPredictionThreshold: { vendor: 0.87, purchase_date: 0.82, subtotal: 0.82, tax: 0.82, total: 0.88, receipt_id: 0.80 },
    strongConfidenceThreshold: { vendor: 0.84, purchase_date: 0.80, subtotal: 0.78, tax: 0.78, total: 0.84, receipt_id: 0.80 },
    earlyStopTrustedFields: true,
  },
  {
    name: "specialist-finance-top3-medium-multiview-support2",
    firstPassConfigName: "fraction40-overlap40-contrast-2200-rules-hybrid",
    windowMode: "medium",
    maxCategoriesPerBand: 3,
    maxExpertInvocations: 18,
    minIndependentObservations: 2,
    windowPadding: 1,
    vendorHeaderPrior: true,
    topBandsPerCategory: { vendor: 2, purchase_date: 2, subtotal: 3, tax: 2, total: 2, receipt_id: 3, item: 3 },
    expertThresholds: { vendor: 0.30, purchase_date: 0.30, subtotal: 0.25, tax: 0.25, total: 0.60, receipt_id: 0.55, item: 0.25 },
    expertMinConfidence: { vendor: 0.48, purchase_date: 0.50, subtotal: 0.45, tax: 0.45, total: 0.60, receipt_id: 0.60, item: 0.45 },
    minIndependentObservationsByCategory: { vendor: 2, purchase_date: 1, subtotal: 2, tax: 2, total: 1, receipt_id: 1, item: 2 },
    allowStrongSingleObservation: { vendor: true, purchase_date: true, subtotal: true, tax: true, total: true, receipt_id: true },
    strongPredictionThreshold: { vendor: 0.87, purchase_date: 0.82, subtotal: 0.82, tax: 0.82, total: 0.88, receipt_id: 0.80 },
    strongConfidenceThreshold: { vendor: 0.84, purchase_date: 0.80, subtotal: 0.78, tax: 0.78, total: 0.84, receipt_id: 0.80 },
    expertPreprocessingVariants: ["original", "contrast"],
    earlyStopTrustedFields: true,
  },
  {
    name: "specialist-finance-high-recall-calibrated-single",
    firstPassConfigName: "fraction40-overlap40-contrast-2200-rules-hybrid",
    windowMode: "medium",
    // Finance needs to coexist with the already-validated date/total/ID
    // routes. The cap is high only because the router has already selected a
    // category-specific top-band quota; buildAdaptiveExpertCrops still
    // invokes one specialist per routed category crop and enforces the 18
    // crop mobile budget. No specialist is run on an unrouted crop.
    maxCategoriesPerBand: 7,
    maxExpertInvocations: 18,
    minIndependentObservations: 2,
    windowPadding: 1,
    vendorHeaderPrior: true,
    topBandsPerCategory: { vendor: 2, purchase_date: 2, subtotal: 3, tax: 2, total: 2, receipt_id: 3, item: 3 },
    expertThresholds: { vendor: 0.30, purchase_date: 0.30, subtotal: 0.25, tax: 0.25, total: 0.60, receipt_id: 0.55, item: 0.25 },
    expertMinConfidence: { vendor: 0.48, purchase_date: 0.50, subtotal: 0.45, tax: 0.45, total: 0.60, receipt_id: 0.60, item: 0.45 },
    minIndependentObservationsByCategory: { vendor: 2, purchase_date: 1, subtotal: 2, tax: 2, total: 1, receipt_id: 1, item: 2 },
    allowStrongSingleObservation: { vendor: true, purchase_date: true, subtotal: true, tax: true, total: true, receipt_id: true },
    // For finance, strongPredictionThreshold is interpreted against the
    // calibrated specialist confidence in the one-observation path. The raw
    // model threshold above remains a separate mandatory gate.
    // Validation-only finance gate screen: lowering subtotal to .58 recovered
    // two explicitly labelled subtotal rows; tax stayed at .65 because the
    // next lower slice admitted a GST-column/header false positive. These are
    // specialist confidence gates, independent from router confidence.
    strongPredictionThreshold: { vendor: 0.87, purchase_date: 0.82, subtotal: 0.58, tax: 0.65, total: 0.88, receipt_id: 0.80 },
    strongConfidenceThreshold: { vendor: 0.84, purchase_date: 0.80, subtotal: 0.58, tax: 0.65, total: 0.84, receipt_id: 0.80 },
    earlyStopTrustedFields: true,
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
  funnel: {
    byCategory: Record<ReceiptHierarchicalSpecialist, {
      routerEligibleBands: number;
      routedBands: number;
      cropsProposed: number;
      ocrCrops: number;
      ocrLines: number;
      candidateValues: number;
      modelPassing: number;
      agreementEligible: number;
      trusted: number;
    }>;
  };
  /** Optional offline-only candidate trace; omitted by the browser path. */
  diagnostics?: {
    candidates: Record<ReceiptFrontendField, Array<{
      value: string;
      canonical: string;
      probability: number;
      confidence: number;
      hardNegative: boolean;
      financialAssociation: number;
      financialStrongLabel: boolean;
      financialSameLine: boolean;
      financialColumnMatch: number;
      financialSummaryColumnMatch: number;
      financialSummaryContext: boolean;
      financialDirectLabel: boolean;
      financialTableHeader: boolean;
      financialTaxCodeBase: boolean;
      financialZeroRate: boolean;
      financialOpposing: boolean;
      financialAmountRank: number;
      ocrConfidence?: number;
      cropTop: number;
      cropBottom: number;
      financialLabelText: string;
      financialLabelDistance: number;
      evidence: string;
      observationKey: string;
      bandIndex: number;
    }>>;
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

const isRateToken = (text: string, raw: string): boolean => {
  const start = text.indexOf(raw);
  if (start < 0) return false;
  const suffix = text.slice(start + raw.length);
  return /^\s*%/.test(suffix);
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
  const isoMatch = text.match(/^(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (isoMatch) return validDate(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));
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
    if (category === "subtotal") return nonEmpty.some((line) => strongSubtotalLabel.test(normalizeLine(line.text)) || categoryKeyword(category, line.text)) && amounts > 0;
    if (category === "tax") return nonEmpty.some((line) => {
      const text = normalizeLine(line.text);
      return (categoryKeyword(category, text) && !taxMetadataLabel.test(text))
        || taxIncludedLabel.test(text)
        || taxInclusiveDescription.test(text)
        || /\b(?:gst|tax)\s*@\s*\d+(?:\.\d+)?\s*%/i.test(text);
    }) && amounts > 0;
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
    // A broad, geometry-only header prior is useful when a vendor name has
    // no lexical cue (logos and short merchant names are common). It only
    // affects where the specialist spends a cheap OCR pass; it never enters
    // the final trusted-field gate.
    clamp(1 - ((band.top + band.bottom) / 2 / safeHeight) / 0.42),
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

const routerPriority = (
  category: ReceiptHierarchicalSpecialist,
  probability: number,
  features: number[],
): number => {
  const feature = (name: typeof HIERARCHICAL_ROUTER_FEATURE_NAMES[number]): number => {
    const index = HIERARCHICAL_ROUTER_FEATURE_NAMES.indexOf(name);
    return index >= 0 ? features[index] ?? 0 : 0;
  };
  const candidateName = category === "purchase_date" ? "candidate_date" : `candidate_${category}` as typeof HIERARCHICAL_ROUTER_FEATURE_NAMES[number];
  const direct = feature(candidateName);
  const directBonus = category === "vendor" ? 0.12
    : category === "receipt_id" ? 0.22
      : category === "item" ? 0.12 : 0.28;
  const headerBonus = category === "vendor" ? feature("header_region_prior") * 0.2 : 0;
  return probability + direct * directBonus + headerBonus;
};

const dominant = (probabilities: Record<ReceiptHierarchicalCategory, number>): ReceiptHierarchicalCategory => (
  [...RECEIPT_HIERARCHICAL_CATEGORIES].sort((left, right) => probabilities[right] - probabilities[left])[0] ?? "other"
);

export const classifyReceiptBands = (
  bands: ReceiptRouterBandInput[],
  options: Pick<ReceiptHierarchicalConfig, "maxCategoriesPerBand" | "routerThresholds" | "topBandsPerCategory" | "vendorHeaderPrior"> = RECEIPT_HIERARCHICAL_EXPERIMENTAL_CONFIG,
): ReceiptRouterPrediction[] => {
  const dimensions = inferredPage(bands);
  const provisional = bands.map((band) => {
    const features = hierarchicalRouterFeatures(band, dimensions.width, dimensions.height);
    const probabilities = Object.fromEntries(RECEIPT_HIERARCHICAL_CATEGORIES.map((category) => [
      category,
      modelProbability(model.router?.[category], features),
    ])) as Record<ReceiptHierarchicalCategory, number>;
    return {
      bandIndex: band.bandIndex,
      observationKey: band.observationKey,
      top: band.top,
      bottom: band.bottom,
      probabilities,
      rankingScores: Object.fromEntries(RECEIPT_HIERARCHICAL_CATEGORIES
        .filter((category): category is ReceiptHierarchicalSpecialist => category !== "other")
        .map((category) => [category, routerPriority(category, probabilities[category], features)])) as Record<ReceiptHierarchicalSpecialist, number>,
      routes: [] as ReceiptHierarchicalSpecialist[],
      dominantCategory: dominant(probabilities),
      lineCount: band.lines.filter((line) => normalizeLine(line.text)).length,
    };
  });
  const selectedByCategory = new Map<ReceiptHierarchicalSpecialist, Set<string>>();
  RECEIPT_HIERARCHICAL_CATEGORIES.filter((category): category is ReceiptHierarchicalSpecialist => category !== "other").forEach((category) => {
    const headerPrior = (prediction: typeof provisional[number]): number => {
      const index = HIERARCHICAL_ROUTER_FEATURE_NAMES.indexOf("header_region_prior");
      // Reconstructing this from geometry keeps the prediction payload small.
      return index >= 0 ? clamp(1 - ((prediction.top + prediction.bottom) / 2 / Math.max(1, dimensions.height)) / 0.42) : 0;
    };
    const threshold = routerThreshold(category, options.routerThresholds);
    const eligible = provisional.filter((prediction) => {
      const broadVendorHeader = category === "vendor" && options.vendorHeaderPrior
        && headerPrior(prediction) >= 0.35
        // Header routing has a deliberately low floor. It recovers logo-only
        // and short merchant headers while remaining independent of trust.
        && prediction.probabilities[category] >= Math.min(threshold, 0.18);
      return prediction.probabilities[category] >= threshold || broadVendorHeader;
    }).sort((left, right) => (right.rankingScores[category] ?? 0) - (left.rankingScores[category] ?? 0));
    const quota = options.topBandsPerCategory?.[category];
    selectedByCategory.set(category, new Set((quota == null ? eligible : eligible.slice(0, Math.max(1, Math.round(quota)))).map((prediction) => prediction.observationKey)));
  });
  return provisional.map((prediction) => {
    const routes = RECEIPT_HIERARCHICAL_CATEGORIES
      .filter((category): category is ReceiptHierarchicalSpecialist => category !== "other" && selectedByCategory.get(category)?.has(prediction.observationKey))
      .sort((left, right) => (prediction.rankingScores?.[right] ?? prediction.probabilities[right] ?? 0) - (prediction.rankingScores?.[left] ?? prediction.probabilities[left] ?? 0))
      .slice(0, Math.max(1, Math.round(options.maxCategoriesPerBand)));
    return { ...prediction, routes };
  });
};

const categoryAnchorScore = (line: ReceiptOcrLine, category: ReceiptHierarchicalSpecialist, index: number, lineCount: number, pageHeight: number): number => {
  const text = normalizeLine(line.text);
  const box = geometry(line, index);
  const y = box.centerY / Math.max(1, pageHeight);
  const amount = amountMatches(text).length > 0;
  const date = dateMatches(text).length > 0;
  const keyword = category === "subtotal"
    ? strongSubtotalLabel.test(text)
    : category === "tax"
      ? ((strongTaxLabel.test(text) && !taxMetadataLabel.test(text) && !taxInclusiveTotalLabel.test(text))
        || taxIncludedLabel.test(text)
        || taxInclusiveDescription.test(text)
        || /\b(?:gst|tax)\s*@\s*\d+(?:\.\d+)?\s*%/i.test(text))
      : categoryKeyword(category, text);
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
  const base = category === "item" ? 0.22 : category === "vendor" ? 0.12 : (category === "subtotal" || category === "tax") ? 0.18 : 0.15;
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
    const routed = prediction.routes;
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
  const deduplicated: ReceiptExpertCrop[] = [];
  crops.forEach((crop) => {
    // Crops from different first-pass bands are separate OCR invocations and
    // may provide independent support. Only collapse a repeated crop from the
    // same source observation; deduplication of the returned text happens
    // later and never counts one observation key twice.
    const duplicate = deduplicated.find((other) => other.category === crop.category
      && other.sourceObservationKey === crop.sourceObservationKey
      && overlapRatio(other, crop) >= 0.88
      && Math.abs(other.top - crop.top) <= Math.max(other.height, crop.height) * 0.18);
    if (duplicate) {
      duplicate.sourceBandIndices = [...new Set([...duplicate.sourceBandIndices, crop.sourceBandIndex])].sort((a, b) => a - b);
      return;
    }
    deduplicated.push(crop);
  });
  // A global cap must not let high-scoring tax/total bands starve the weak but
  // valuable receipt-id/item/vendor routes. Select in category round-robin
  // order after within-category ranking, then restore stable page order for
  // sequential/mobile-safe OCR.
  const byCategory = new Map<ReceiptHierarchicalSpecialist, ReceiptExpertCrop[]>();
  deduplicated.forEach((crop) => byCategory.set(crop.category, [...(byCategory.get(crop.category) ?? []), crop]));
  byCategory.forEach((categoryCrops) => categoryCrops.sort((left, right) => right.routerProbability - left.routerProbability));
  const selected: ReceiptExpertCrop[] = [];
  const categoryOrder: ReceiptHierarchicalSpecialist[] = [...RECEIPT_HIERARCHICAL_CATEGORIES].filter((category): category is ReceiptHierarchicalSpecialist => category !== "other");
  let cursor = 0;
  const maxInvocations = Math.max(1, Math.round(config.maxExpertInvocations));
  while (selected.length < maxInvocations && categoryOrder.some((category) => (byCategory.get(category)?.length ?? 0) > cursor)) {
    categoryOrder.forEach((category) => {
      if (selected.length >= maxInvocations) return;
      const candidate = byCategory.get(category)?.[cursor];
      if (candidate) selected.push(candidate);
    });
    cursor += 1;
  }
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
  candidateValue?: string,
): number[] => {
  const line = lines[index];
  const box = geometry(line, index);
  const previous = lines[index - 1]?.text ?? "";
  const next = lines[index + 1]?.text ?? "";
  const text = normalizeLine(line.text);
  const amounts = amountMatches(text);
  const dates = dateMatches(text);
  const candidateRaw = category === "subtotal" || category === "tax"
    ? candidateValue && amounts.find((raw) => amountKey(raw) === amountKey(candidateValue))
    : undefined;
  const selectedAmount = candidateRaw ?? amounts[0];
  const position = selectedAmount ? Math.max(0, text.indexOf(selectedAmount)) / Math.max(1, text.length) : 0;
  const conf = confidenceFraction(line.confidence);
  const association = (category === "subtotal" || category === "tax") && selectedAmount
    ? financialAssociation(lines, index, category, selectedAmount)
    : null;
  const contextLines = lines.slice(Math.max(0, index - 2), Math.min(lines.length, index + 3));
  const contextText = contextLines.map((candidate) => normalizeLine(candidate.text)).join(" ");
  const opposingLabel = category === "total"
    ? (excludedTotal.test(text) && !strongTotalLabel.test(text) ? 1 : 0)
    : category === "subtotal"
      ? (/\b(?:tax|gst|hst|vat|total|payment|paid|cash|change|tender)\b/i.test(text) ? 1 : 0)
      : category === "tax"
        ? (/\b(?:sub[ -]?total|before\s+tax|total|payment|paid|cash|change|tender)\b/i.test(text) ? 1 : 0)
        : category === "receipt_id"
          ? (receiptIdHardNegative.test(text) ? 1 : 0)
          : category === "vendor" && vendorMetadata.test(text) ? 1 : 0;
  const strongSemanticLabel = category === "total" ? (strongTotalLabel.test(contextText) ? 1 : 0)
    : category === "receipt_id" ? (strongReceiptIdLabel.test(text) ? 1 : 0)
      : category === "vendor" ? (!vendorMetadata.test(text) && index < 8 ? 1 : 0)
        : (categoryKeyword(category, text) ? 1 : 0);
  const labelDistance = (() => {
    const distance = Array.from({ length: 5 }, (_, offset) => index + offset - 2)
      .filter((near) => near >= 0 && near < lines.length && categoryKeyword(category, lines[near].text))
      .map((near) => Math.abs(near - index));
    return distance.length ? 1 / (1 + Math.min(...distance)) : 0;
  })();
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
    opposingLabel,
    strongSemanticLabel,
    amounts.length > 0 && (text.match(/[A-Za-z]/g) ?? []).length / Math.max(1, text.length) < 0.18 ? 1 : 0,
    labelDistance,
    clamp(text.length / 40),
    association?.score ?? 0,
    association?.sameLine ? 1 : 0,
    association?.columnMatch ?? 0,
    association?.strongLabel ? 1 : 0,
    association?.opposing ? 1 : 0,
    association?.amountRank ? clamp(association.amountRank / Math.max(1, amounts.length - 1)) : 0,
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
  if (field === "purchase_date") return normalizeDate(value) ?? `raw:${lower(value).replace(/[^a-z0-9]/g, "")}`;
  if (field === "receipt_id" || field === "item") return lower(value).replace(/[^a-z0-9.-]/g, "");
  return amountKey(value) ?? lower(value).replace(/[^a-z0-9.-]/g, "");
};

const equivalentCanonical = (
  field: ReceiptFrontendField | ReceiptHierarchicalSpecialist,
  left: string,
  right: string,
): boolean => {
  if (left === right) return true;
  if (field === "vendor") {
    const minimumLength = Math.min(left.length, right.length);
    return minimumLength >= 6 && editSimilarity(left, right) >= 0.84;
  }
  if (field === "receipt_id") {
    const minimumLength = Math.min(left.length, right.length);
    if (minimumLength < 6 || Math.abs(left.length - right.length) > 1 || editSimilarity(left, right) < 0.84) return false;
    const leftDigits = left.replace(/[^0-9]/g, "");
    const rightDigits = right.replace(/[^0-9]/g, "");
    if (!leftDigits.length || !rightDigits.length) return true;
    const sharedDigits = [...new Set(leftDigits)].filter((digit) => rightDigits.includes(digit)).length;
    return leftDigits === rightDigits || sharedDigits / Math.max(1, new Set(leftDigits + rightDigits).size) >= 0.6;
  }
  return false;
};

const equivalentGroupKey = (
  field: ReceiptFrontendField | ReceiptHierarchicalSpecialist,
  keys: Iterable<string>,
  candidate: string,
): string | undefined => [...keys].find((key) => equivalentCanonical(field, key, candidate));

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
  cropTop: number;
  cropBottom: number;
  isFirstPass: boolean;
  finalTotalLabel: boolean;
  hardNegative: boolean;
  financialAssociation: number;
  financialLabelText: string;
  financialStrongLabel: boolean;
  financialSameLine: boolean;
  financialLabelDistance: number;
  financialColumnMatch: number;
  financialSummaryColumnMatch: number;
  financialSummaryContext: boolean;
  financialDirectLabel: boolean;
  financialTableHeader: boolean;
  financialTaxCodeBase: boolean;
  financialZeroRate: boolean;
  financialOpposing: boolean;
  financialAmountRank: number;
}

const vendorMetadata = /\b(?:reg(?:istration)?\.?\s*(?:no|number)?|co-?reg|gstn?|sst|tax\s*id|tel(?:ephone)?|phone|mobile|whatsapp|address|jalan|street|road|postcode|postal|owned\s+by|dba|branch|cashier|terminal|register)\b/i;
const blockedVendor = /^(?:store|shop)$|\b(?:receipt|invoice|subtotal|sub-total|total|tax|gst|hst|date|cashier|thank|change|tender)\b/i;
const receiptIdHardNegative = /\b(?:auth(?:orization)?|approval|terminal|register|cashier|reference|ref(?:erence)?|rrn|stan|trace|batch|gst|tax|tel|phone|mobile|member|card|serial|sku)\b/i;
const excludedTotal = /\b(?:qty|quantity|items?|excluding|excl\.?|before\s+tax|subtotal|sub-total|tax\s+amount|round(?:ing)?\s+adjustment|suppl(?:y|ies)|saving|discount|payment|paid|cash|change|tender|auth(?:orization)?|approval|terminal|register|reference|rrn|stan|trace|batch)\b/i;
const strongTotalLabel = /\b(?:grand\s+total|total\s+(?:due|payable|amt|amount|rounded|round(?:ed)?|incl(?:usive)?|including)|amount\s+due|balance\s+due|final\s+total|round(?:ed|ing)?\s+\w*\s+total)\b/i;
const strongReceiptIdLabel = /\b(?:receipt|invoice|order|transaction|trans(?:action)?|document|doc|bill)\b/i;
const strongSubtotalLabel = /\b(?:sub[\s-]?(?:total|t[o0]tal|futal|t[a4]l)|(?:total\s+)?sales?\s*\(?\s*(?:excluding|excl\.?|before)\b|total\s*\(?\s*(?:excluding|excl\.?|before)\b|before\s+tax|net\s+subtotal)\b/i;
const explicitSubtotalLabel = /\bsub[\s-]?total\b/i;
const strongTaxLabel = /\b(?:tax|gst|hst|vat|sales\s+tax)(?:\s*[/ -]?\s*(?:amt|amount|total|summary))?\b/i;
const taxMetadataLabel = /\b(?:tax\s*(?:id|no\.?|number|registration)|gst\s*(?:no\.?|number|id|reg(?:istration)?)|taxable\s+id)\b/i;
const subtotalInclusiveLabel = /\b(?:sub[\s-]?total|total\s+sales?)\b[^\n]{0,24}\b(?:incl(?:usive)?|including|inc)\.?\s*(?:gst|tax|vat|hst)\b/i;
const taxInclusiveTotalLabel = /\b(?:total|sales?|sub[\s-]?total|nett?|amount)\b[^\n]{0,32}\b(?:(?:(?:incl(?:usive)?|[il]nclusive|in[dcl]l|including|inc)\.?\s*(?:of\s*)?|with\s+)(?:gst|tax|vat|hst)\b|(?:gst|tax|vat|hst)\s*(?:incl(?:uded)?|inclusive|inc)\.?\b)/i;
const taxIncludedLabel = /\b(?:tax|gst|hst|vat)\b[^\n]{0,28}\b(?:incl(?:uded|usive)?|including|inc)\b/i;
const taxInclusiveDescription = /\b(?:bill|gst|tax)\b[^\n]{0,32}\binclusive\s+of\s+\d+(?:\.\d+)?\s*%?\s*(?:gst|tax|vat|hst)\b/i;
const taxExcludedLabel = /\b(?:excluded|excluding|excl\.?|before)\b[^\n]{0,16}\b(?:gst|tax|vat|hst)\b/i;
const taxTableHeader = /\b(?:amount|amt)\s*(?:\([^)]*\))?[^0-9\n]{0,16}\b(?:tax|gst|hst|vat)\s*(?:\([^)]*\))?\b|\b(?:tax|gst|hst|vat)\s*(?:\([^)]*\))?[^0-9\n]{0,16}\b(?:amount|amt)\b/i;
const inlineTaxColumnHeader = /\b(?:amount|amt)\s*\([^)]*\)\s+(?:tax|gst|hst|vat)\s*\([^)]*\)\s*[-:]?\s*[$€£]?\s*\d/i;
const genericTaxColumnHeader = /^(?:tax|gst|hst|vat)(?:\s*\([^)]*\))?$/i;
const taxCodeBaseLabel = /\b(?:s|sr|standard|z|zr|zero)\s*[-:=]?\s*(?:(?:gst|tax)\s*)?(?:@?\s*)?(?:\(|\[)?\d+(?:\.\d+)?\s*%(?:\)|\])?(?:\s*(?:gst|tax))?\b|\b(?:s|sr|standard|z|zr|zero)\s*[-:=]?\s*(?:gst|tax)\s*@?\s*(?:\(|\[)?\d+(?:\.\d+)?\s*%(?:\)|\])?/i;
const taxZeroRateLabel = /\b(?:z|zr|zero)\s*[-:=]?\s*(?:(?:gst|tax)\s*)?(?:@?\s*)?(?:\(|\[)?0\s*%(?:\)|\])?(?:\s*(?:gst|tax))?\b/i;
const directTaxAmountLabel = /\b(?:tax|gst|hst|vat)(?:\s*[/ -]?\s*(?:amt|amount|total|summary))?\s*[:=]?\s*[A-Za-z]{0,3}$/i;
const directTaxAmountValue = /\b(?:tax|gst|hst|vat)(?:\s*[/ -]?\s*(?:amt|amount|total|summary))?\s*[:=]\s*(?:[A-Za-z]{0,3}\s*)?(?:[$€£]|\b(?:rm|usd|cad|gbp)\b)?\s*\(?\s*-?\d{1,6}(?:[,.]\d{3})*(?:[,.]\d{2})/gi;
const taxExcludedAmountContext = /\b(?:excluded|excluding|excl\.?|before)\b[^\n]{0,16}\b(?:gst|tax|vat|hst)\b[^0-9]{0,8}$/i;
const paymentAmountContext = /\b(?:payment|paid|cash|tender|change)\b[^\n]{0,28}$/i;
const subtotalOpposingLabel = /\b(?:tax|gst|hst|vat|payment|paid|cash|change|tender|discount|saving|savings|round(?:ing)?|total(?:\s+(?:due|payable|amount))?)\b/i;
const taxOpposingLabel = /\b(?:sub[\s-]?(?:total|t[o0]tal|futal|t[a4]l)|before\s+tax|payment|paid|cash|change|tender|discount|saving|savings|round(?:ing)?|grand\s+total|total\s+(?:due|payable|amount))\b/i;

interface FinancialAssociation {
  score: number;
  labelText: string;
  labelIndex: number;
  strongLabel: boolean;
  sameLine: boolean;
  columnMatch: number;
  summaryColumnMatch: number;
  summaryContext: boolean;
  directLabel: boolean;
  tableHeader: boolean;
  taxCodeBase: boolean;
  zeroRate: boolean;
  opposing: boolean;
  amountRank: number;
}

type CandidateValue = { index: number; value: string; financial?: FinancialAssociation };

const financialLabelPattern = (field: "subtotal" | "tax"): RegExp => field === "subtotal" ? strongSubtotalLabel : strongTaxLabel;
const financialOpposingPattern = (field: "subtotal" | "tax"): RegExp => field === "subtotal" ? subtotalOpposingLabel : taxOpposingLabel;
const nearbyFinancialLabel = (lines: ReceiptOcrLine[], index: number, field: "subtotal" | "tax", radius = 4): boolean => (
  Array.from({ length: radius * 2 + 1 }, (_, offset) => index + offset - radius)
    .some((near) => near >= 0 && near < lines.length && (categoryKeyword(field, lines[near].text) || financialLabelPattern(field).test(normalizeLine(lines[near].text))))
);

const regexSpan = (pattern: RegExp, value: string): { start: number; end: number } | null => {
  pattern.lastIndex = 0;
  const match = pattern.exec(value);
  pattern.lastIndex = 0;
  return match ? { start: match.index, end: match.index + match[0].length } : null;
};

const hasDirectTaxAmount = (value: string): boolean => {
  directTaxAmountValue.lastIndex = 0;
  const matches = [...value.matchAll(directTaxAmountValue)];
  directTaxAmountValue.lastIndex = 0;
  return matches.some((match) => {
    const start = match.index ?? 0;
    return !taxExcludedLabel.test(value.slice(Math.max(0, start - 20), start + Math.min(match[0].length, 24)));
  });
};

/**
 * Associate one amount with the nearest labelled financial role. A whole OCR
 * line can contain item prices, subtotal, GST and total simultaneously, so a
 * keyword anywhere in a crop is not enough. Prefer same-line labels, then
 * labels immediately above with matching x columns (including GST summary
 * tables). Weak proximity-only associations stay available to the expert as
 * hard negatives but can never become trusted values.
 */
const financialAssociation = (
  lines: ReceiptOcrLine[],
  index: number,
  field: "subtotal" | "tax",
  raw: string,
): FinancialAssociation | null => {
  const line = lines[index];
  if (!line) return null;
  const text = normalizeLine(line.text);
  const amountStart = Math.max(0, text.indexOf(raw));
  const amountBox = geometry(line, index);
  const pageWidth = Math.max(1, ...lines.map((candidate, candidateIndex) => geometry(candidate, candidateIndex).x1));
  const amountCenterX = amountBox.x0 + amountBox.width * ((amountStart + raw.length / 2) / Math.max(1, text.length));
  const amountValues = amountMatches(text);
  const amountRank = Math.max(0, amountValues.findIndex((candidate) => amountKey(candidate) === amountKey(raw)));
  const ownPattern = financialLabelPattern(field);
  const opposingPattern = financialOpposingPattern(field);
  const options: FinancialAssociation[] = [];
  const summaryAnchorIndex = field === "tax"
    ? lines.reduce<number | null>((best, candidate, candidateIndex) => {
      const candidateText = normalizeLine(candidate.text);
      const summaryLike = /\b(?:gst|tax)\s*(?:summary|analysis)\b/i.test(candidateText)
        || taxCodeBaseLabel.test(candidateText)
        || /\b(?:gst|tax)\s*(?:amt|amount)\b/i.test(candidateText)
        || /\b(?:gst|tax)\s*@\s*\d+(?:\.\d+)?\s*%/i.test(candidateText);
      if (!summaryLike || Math.abs(candidateIndex - index) > 8) return best;
      return best === null || Math.abs(candidateIndex - index) < Math.abs(best - index) ? candidateIndex : best;
    }, null)
    : null;
  const summaryEntries = summaryAnchorIndex === null ? [] : lines.slice(
    Math.max(0, summaryAnchorIndex - 1),
    Math.min(lines.length, summaryAnchorIndex + 10),
  ).flatMap((candidate, candidateIndex) => amountMatches(candidate.text).map((candidateRaw) => {
    const absoluteIndex = Math.max(0, summaryAnchorIndex - 1) + candidateIndex;
    const candidateBox = geometry(candidate, absoluteIndex);
    const candidateText = normalizeLine(candidate.text);
    const candidateStart = Math.max(0, candidateText.indexOf(candidateRaw));
    return {
      index: absoluteIndex,
      raw: candidateRaw,
      centerX: candidateBox.x0 + candidateBox.width * ((candidateStart + candidateRaw.length / 2) / Math.max(1, candidateText.length)),
    };
  }));
  const summaryColumnMatchFor = (candidateRaw: string): number => {
    const candidate = summaryEntries.find((entry) => entry.index === index && amountKey(entry.raw) === amountKey(candidateRaw));
    if (!candidate || summaryEntries.length < 2) return 0.5;
    const centers = [...new Set(summaryEntries.map((entry) => Math.round(entry.centerX * 100) / 100))].sort((left, right) => left - right);
    if (centers.length < 2) return 0.5;
    const rank = centers.findIndex((center) => Math.abs(center - candidate.centerX) < 0.01);
    if (rank < 0) return 0.5;
    const fraction = rank / Math.max(1, centers.length - 1);
    return field === "tax" ? fraction : 1 - fraction;
  };
  lines.forEach((candidate, candidateIndex) => {
    if (Math.abs(candidateIndex - index) > 4) return;
    const labelText = normalizeLine(candidate.text);
    if (!(categoryKeyword(field, labelText) || ownPattern.test(labelText)) || (field === "tax" && taxMetadataLabel.test(labelText))) return;
    const labelBox = geometry(candidate, candidateIndex);
    const labelSpan = regexSpan(ownPattern, labelText) ?? regexSpan(keywordPatterns[field], labelText);
    const rowContext = lines.slice(Math.max(0, candidateIndex - 3), Math.min(lines.length, candidateIndex + 4))
      .map((nearby) => normalizeLine(nearby.text)).join(" ");
    const inlineTaxHeader = field === "tax" && inlineTaxColumnHeader.test(labelText);
    const tableHeader = field === "tax" && ((!amountMatches(labelText).length
      && (genericTaxColumnHeader.test(labelText) || taxTableHeader.test(labelText))) || inlineTaxHeader);
    const itemTableHeader = tableHeader && /\b(?:item|qty|quantity|description|s\s*\/\s*price|u\.?\s*price|unit|code)\b/i.test(rowContext);
    const taxInclusiveRole = field === "tax" && taxInclusiveTotalLabel.test(labelText) && !taxIncludedLabel.test(labelText.replace(/\b(?:total|sales?|sub[\s-]?total|nett?|amount)\b/gi, ""));
    const directIncludedTax = field === "tax" && (taxIncludedLabel.test(labelText) || taxInclusiveDescription.test(labelText)) && !taxInclusiveRole;
    const taxIncludedWithoutExplicitAmount = field === "tax" && taxIncludedLabel.test(labelText) && !/[:=]/.test(labelText);
    const taxCodeBase = field === "tax" && taxCodeBaseLabel.test(labelText) && amountMatches(labelText).length > 0
      && !/\b(?:amt|amount)\b/i.test(labelText);
    const zeroRate = field === "tax" && taxZeroRateLabel.test(labelText);
    const ambiguousRole = field === "subtotal"
      ? subtotalInclusiveLabel.test(labelText)
      : taxInclusiveRole;
    const excludedTaxRole = field === "tax" && taxExcludedLabel.test(labelText) && !hasDirectTaxAmount(labelText);
    const directLabel = field === "tax" && (directIncludedTax || taxCodeBaseLabel.test(labelText)
      || /\b(?:total\s+)?(?:tax|gst|hst|vat)\s*(?:amt|amount|total|summary)?\b/i.test(labelText)
      || /\b(?:tax|gst)\s*@\s*\d+(?:\.\d+)?\s*%/i.test(labelText));
    const strongLabel = ownPattern.test(labelText)
      && !(field === "tax" && taxMetadataLabel.test(labelText))
      && !ambiguousRole
      && !excludedTaxRole
      && !itemTableHeader
      && !taxCodeBase;
    const sameLine = candidateIndex === index;
    const lineDistance = Math.abs(candidateIndex - index);
    const below = labelBox.centerY > amountBox.centerY + Math.max(labelBox.height, amountBox.height) * 0.6;
    if (below && !sameLine) return;
    const columnDistance = Math.min(
      Math.abs(amountCenterX - labelBox.centerX),
      Math.abs(amountCenterX - labelBox.x0),
      Math.abs(amountCenterX - labelBox.x1),
    );
    const geometricColumnMatch = clamp(1 - columnDistance / Math.max(1, pageWidth * 0.34));
    // In a GST summary the OCR line bbox often spans the whole row, so the
    // bbox alone cannot distinguish the net, tax, and total columns. Tax is
    // commonly the right-hand amount; subtotal/net is commonly the left-most
    // amount. Use that weak prior only as a tie-breaker, never as standalone
    // evidence.
    const amountCount = amountValues.length;
    const rankFraction = amountCount > 1 ? amountRank / Math.max(1, amountCount - 1) : 0.5;
    const roleRank = field === "tax" ? rankFraction : 1 - rankFraction;
    const columnMatch = clamp(geometricColumnMatch * 0.65 + roleRank * 0.35);
    const summaryColumnMatch = summaryColumnMatchFor(raw);
    const summaryContext = summaryAnchorIndex !== null;
    const labelEnd = labelSpan?.end ?? labelText.length;
    const labelStart = labelSpan?.start ?? 0;
    const textProximity = sameLine
      ? clamp(1 - Math.abs(amountStart - labelEnd) / Math.max(8, text.length))
      : 0;
    const lineMatch = lineDistance === 0 ? 1 : lineDistance === 1 ? 0.82 : lineDistance === 2 ? 0.62 : 0.42;
    const ownBeforeAmount = !sameLine || amountStart >= labelStart;
    const oppositeSpans = [...labelText.matchAll(new RegExp(opposingPattern.source, "gi"))]
      .map((match) => Math.abs((candidateIndex === index ? match.index + match[0].length / 2 : amountStart) - (candidateIndex === index ? amountStart + raw.length / 2 : amountStart)));
    const amountContextBefore = sameLine ? labelText.slice(Math.max(0, amountStart - 36), amountStart) : "";
    const taxAmountOpposing = field === "tax" && sameLine
      && (taxExcludedAmountContext.test(amountContextBefore)
        || (paymentAmountContext.test(amountContextBefore) && !directTaxAmountLabel.test(amountContextBefore)));
    const opposing = ambiguousRole || excludedTaxRole || taxAmountOpposing || itemTableHeader || inlineTaxHeader || taxCodeBase || taxIncludedWithoutExplicitAmount
      || (taxInclusiveRole && !directIncludedTax)
      || (!strongLabel && opposingPattern.test(labelText))
      || (sameLine && oppositeSpans.length > 0 && !strongLabel);
    const score = clamp(
      (strongLabel ? 0.44 : 0.25)
      + (sameLine ? 0.23 : 0.07)
      + lineMatch * 0.10
      + columnMatch * 0.14
      + (summaryContext ? summaryColumnMatch * 0.12 : 0)
      + (directLabel ? 0.08 : 0)
      + textProximity * 0.12
      + (ownBeforeAmount ? 0.03 : -0.12)
      - (itemTableHeader ? 0.22 : 0)
      - (taxCodeBase ? 0.20 : 0)
      - (opposing ? 0.24 : 0),
    );
    options.push({ score, labelText, labelIndex: candidateIndex, strongLabel, sameLine, columnMatch, summaryColumnMatch, summaryContext, directLabel, tableHeader: itemTableHeader, taxCodeBase, zeroRate, opposing, amountRank });
  });
  return options.sort((left, right) => right.score - left.score)[0] ?? null;
};

const nearbyCategoryKeyword = (lines: ReceiptOcrLine[], index: number, category: ReceiptHierarchicalCategory, radius = 2): boolean => (
  Array.from({ length: radius * 2 + 1 }, (_, offset) => index + offset - radius)
    .some((near) => near >= 0 && near < lines.length && categoryKeyword(category, lines[near].text))
);

const candidateValues = (lines: ReceiptOcrLine[], field: ReceiptFrontendField | ReceiptHierarchicalSpecialist): CandidateValue[] => {
  const result: CandidateValue[] = [];
  if (field === "vendor") {
    lines.slice(0, 18).forEach((line, index) => {
      const text = normalizeLine(line.text);
      const letters = (text.match(/[A-Za-z]/g) ?? []).length;
      if (letters >= 3 && letters / Math.max(1, text.length) >= 0.35 && text.length <= 80 && !blockedVendor.test(text) && !amountMatches(text).length) result.push({ index, value: text });
    });
  } else if (field === "purchase_date") {
    lines.forEach((line, index) => dateMatches(line.text).forEach((raw) => {
      const value = normalizeDate(raw) ?? normalizeLine(raw);
      if (value) result.push({ index, value });
    }));
  } else if (field === "receipt_id") {
    lines.forEach((line, index) => {
      const text = normalizeLine(line.text);
      if (!strongReceiptIdLabel.test(text) || receiptIdHardNegative.test(text) || !/[A-Z0-9]{3,}/i.test(text)) return;
      const match = text.match(/(?:invoice|receipt|order|transaction|trans|reference|ref|id|no\.?|number)\s*[:#-]?\s*([A-Z0-9][A-Z0-9-]{2,})/i);
      if (match) result.push({ index, value: match[1] });
    });
  } else if (field === "item") {
    lines.forEach((line, index) => {
      const text = normalizeLine(line.text);
      if (text.length >= 3 && (amountMatches(text).length || categoryKeyword("item", text))) result.push({ index, value: text });
    });
  } else {
    const financialResults: CandidateValue[] = [];
    lines.forEach((line, index) => amountMatches(line.text).forEach((raw) => {
      if (parseAmount(raw) === null) return;
      if (isRateToken(line.text, raw)) return;
      const value = outputAmount(raw);
      if (field === "subtotal" || field === "tax") {
        if (!nearbyFinancialLabel(lines, index, field, 4)) return;
        financialResults.push({ index, value, financial: financialAssociation(lines, index, field, raw) ?? undefined });
      } else {
        result.push({ index, value });
      }
    }));
    if (field === "subtotal" || field === "tax") {
      // A GST/tax summary commonly prints a zero-rated row beside the actual
      // charged tax. Keep a genuine zero tax when it is the only explicit tax
      // amount, but do not let it beat a non-zero direct tax observation.
      const positiveDirectTax = field === "tax" && financialResults.some((candidate) => {
        const association = candidate.financial;
        return parseAmount(candidate.value) !== null
          && (parseAmount(candidate.value) ?? 0) > 0
          && Boolean(association?.strongLabel)
          && !association?.opposing
          && (association?.summaryContext || association?.directLabel || association?.sameLine);
      });
      financialResults.forEach((candidate) => {
        const association = candidate.financial;
        const zeroRate = Boolean(association?.zeroRate) || (parseAmount(candidate.value) ?? -1) === 0;
        if (!(field === "tax" && positiveDirectTax && zeroRate)) result.push(candidate);
      });
    }
  }
  return result;
};

/** Keep the amount most plausibly tied to the field label in each routed crop.
 * The specialist still sees the discarded amounts as hard negatives during
 * training, but a GST table should not make every amount in the same crop a
 * live competitor just because the header contains the word "Tax". Keeping
 * near-ties only would preserve ambiguity rather than resolve it safely. */
const focusFinancialCandidates = (candidates: ExpertCandidate[], field: ReceiptFrontendField): ExpertCandidate[] => {
  if (field !== "subtotal" && field !== "tax") return candidates;
  let scopedCandidates = candidates;
  if (field === "subtotal") {
    // Apply the explicit-row preference before per-observation score
    // focusing. A generic “Total excluding GST” candidate can score a few
    // hundredths higher than the real SUBTOTAL in a noisy crop; selecting the
    // local maximum first would otherwise discard the explicit row before we
    // get to use its stronger semantics.
    const exactByObservation = new Set(
      candidates
        .filter((candidate) => explicitSubtotalLabel.test(candidate.financialLabelText) && !subtotalInclusiveLabel.test(candidate.financialLabelText))
        .map((candidate) => candidate.observationKey),
    );
    if (exactByObservation.size) {
      scopedCandidates = candidates.filter((candidate) => !exactByObservation.has(candidate.observationKey)
        || (explicitSubtotalLabel.test(candidate.financialLabelText) && !subtotalInclusiveLabel.test(candidate.financialLabelText)));
    }
  }
  const bestByObservation = new Map<string, number>();
  scopedCandidates.forEach((candidate) => bestByObservation.set(candidate.observationKey, Math.max(bestByObservation.get(candidate.observationKey) ?? 0, candidate.financialAssociation)));
  let locallyFocused = scopedCandidates.filter((candidate) => candidate.financialAssociation >= (bestByObservation.get(candidate.observationKey) ?? 0) - 0.025);
  if (field === "tax") {
    // Zero-rated rows are legitimate only when no charged tax is present in
    // the routed evidence. Apply this across observations as well as within
    // each crop; otherwise a zero-only crop can defeat a positive tax row
    // found in a second crop and make the correct value ambiguous.
    const hasPositiveTax = locallyFocused.some((candidate) => {
      const value = parseAmount(candidate.value);
      return value !== null && value > 0 && candidate.financialStrongLabel && !candidate.financialOpposing
        && (candidate.financialSummaryContext || candidate.financialDirectLabel || candidate.financialSameLine);
    });
    if (hasPositiveTax) locallyFocused = locallyFocused.filter((candidate) => !candidate.financialZeroRate && (parseAmount(candidate.value) ?? 0) > 0);
  }
  // A summary row is a semantic table, not one repeated label. Once the
  // OCR geometry identifies the field's column, keep that role consistent
  // across overlapping crops. Without this second pass, the taxable/base
  // amount can win in one crop and the tax amount in another, leaving the
  // correct value permanently ambiguous. The role score is deliberately a
  // soft margin: if geometry is unavailable (0.5) or the columns are close,
  // we retain all candidates and fail open through the normal agreement gate.
  const summaryCandidates = locallyFocused.filter((candidate) => candidate.financialSummaryContext);
  const bestSummaryRole = Math.max(...summaryCandidates.map((candidate) => candidate.financialSummaryColumnMatch), 0);
  if (bestSummaryRole < 0.65) return locallyFocused;
  return locallyFocused.filter((candidate) => !candidate.financialSummaryContext
    || candidate.financialSummaryColumnMatch >= bestSummaryRole - 0.18);
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
  candidateValue?: CandidateValue,
): ExpertCandidate => {
  const features = expertFeatures(lines, lineIndex, crop.category, crop, pageWidth, pageHeight, value);
  const raw = rawModelProbability(model.experts?.[crop.category], features);
  const probability = modelProbability(model.experts?.[crop.category], features);
  const confidence = clamp(probability * (0.65 + 0.35 * confidenceFraction(line.confidence)));
  const currentText = normalizeLine(line.text);
  const currentBox = geometry(line, lineIndex);
  const association = candidateValue?.financial ?? null;
  const precedingTotalLabel = lines.some((nearby, nearbyIndex) => {
    if (nearbyIndex === lineIndex || !strongTotalLabel.test(normalizeLine(nearby.text))) return false;
    const nearbyBox = geometry(nearby, nearbyIndex);
    const distance = currentBox.centerY - nearbyBox.centerY;
    return distance >= -Math.max(currentBox.height, nearbyBox.height) * 0.35
      && distance <= Math.max(currentBox.height, nearbyBox.height) * 3.2;
  });
  const finalTotalLabel = crop.category === "total" && (strongTotalLabel.test(currentText) || precedingTotalLabel);
  const hardNegative = field === "vendor" ? vendorMetadata.test(currentText)
    : field === "receipt_id" ? receiptIdHardNegative.test(currentText)
      : field === "total" ? !finalTotalLabel
        : field === "subtotal" ? !association || association.score < 0.55 || association.opposing
          : field === "tax" ? !association || association.score < 0.55 || association.opposing
            : false;
  const contextRadius = field === "subtotal" || field === "tax" ? 3 : 2;
  const contextLines = lines.slice(Math.max(0, lineIndex - contextRadius), Math.min(lines.length, lineIndex + contextRadius + 1)).map((nearby) => normalizeLine(nearby.text)).filter(Boolean);
  if (association?.labelText && !contextLines.includes(association.labelText)) contextLines.push(association.labelText);
  return {
    field,
    category: crop.category,
    value,
    canonical: normalizedValue(field, value),
    line,
    lineIndex,
    probability: raw,
    confidence: clamp(probability * (0.65 + 0.35 * confidenceFraction(line.confidence))),
    evidence: contextLines.join(" "),
    observationKey: observation.observationKey,
    cropId: observation.cropId ?? crop.cropId,
    bandIndex: observation.bandIndex,
    cropTop: crop.top,
    cropBottom: crop.bottom,
    isFirstPass: observation.sourcePass === "first-pass",
    // Receipt formats normally print the total label on the same line as, or
    // immediately above, the amount. A following label must not bless the
    // previous amount (e.g. "Total 0% supplies: 12.98" followed by
    // "Total Payable: -1.73").
    // A total label must be on the amount line or immediately above it. Do
    // not let a later "Total (inclusive...)" label bless an earlier GST/tax
    // amount in the same wide crop (the Walmart/GST and adjustment layouts
    // expose exactly this failure mode).
    finalTotalLabel,
    hardNegative,
    financialAssociation: association?.score ?? 0,
    financialLabelText: association?.labelText ?? "",
    financialStrongLabel: association?.strongLabel ?? false,
    financialSameLine: association?.sameLine ?? false,
    financialLabelDistance: association ? Math.abs(lineIndex - association.labelIndex) : 99,
    financialColumnMatch: association?.columnMatch ?? 0,
    financialSummaryColumnMatch: association?.summaryColumnMatch ?? 0.5,
    financialSummaryContext: association?.summaryContext ?? false,
    financialDirectLabel: association?.directLabel ?? false,
    financialTableHeader: association?.tableHeader ?? false,
    financialTaxCodeBase: association?.taxCodeBase ?? false,
    financialZeroRate: association?.zeroRate ?? false,
    financialOpposing: association?.opposing ?? false,
    financialAmountRank: association?.amountRank ?? 0,
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
  allowStrongSingleObservation = false,
  strongPredictionThreshold = 0.92,
  strongConfidenceThreshold = 0.90,
): ReceiptHierarchicalFieldResult => {
  if (!candidates.length) return emptyField();
  candidates = candidates.filter((candidate) => !candidate.hardNegative);
  if (!candidates.length) return emptyField();
  candidates = focusFinancialCandidates(candidates, field);
  if (!candidates.length) return emptyField();
  // Financial specialists must select from explicitly labelled amounts when
  // one is available. This keeps a broad adaptive crop containing item prices,
  // subtotal, tax, and total from turning a merely high model score into a
  // trusted value. If no label is present, fail open for that field.
  const labelled = (field === "subtotal" || field === "tax")
    ? candidates.filter((candidate) => candidate.financialAssociation >= 0.55 && !candidate.financialOpposing)
    : field === "total"
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
    const existing = equivalentGroupKey(field, values.keys(), candidate.canonical);
    values.set(existing ?? candidate.canonical, [...(values.get(existing ?? candidate.canonical) ?? []), candidate]);
  });
  const ranked = [...values.entries()].map(([canonical, supports]) => {
    const independent = independentCandidates(supports);
    const distinctObservations = new Set(independent.map((candidate) => candidate.observationKey));
    const distinctBands = new Set(independent.map((candidate) => candidate.bandIndex));
    const strongest = [...supports].sort((left, right) => right.probability - left.probability)[0];
    return { canonical, supports, independent, strongest, distinctObservations, distinctBands };
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
    (field === "subtotal" || field === "tax") && top.strongest.financialStrongLabel && top.strongest.financialAssociation >= 0.60,
    field === "total" && strongTotalLabel.test(topContext),
  ].some(Boolean);
  const allText = top.independent.map((candidate) => candidate.evidence).join(" ");
  // A bare "TOTAL" is routinely printed beside item/summary amounts.  It is
  // useful routing evidence, but not a conservative value label. Require a
  // semantic final-total label before trusting that specialist; otherwise the
  // field remains available to GPT/review and fails open.
  const excluded = field === "total" && excludedTotal.test(top.strongest.evidence) && !strongTotalLabel.test(top.strongest.evidence);
  const distinctLabelValues = new Set(candidates.filter((candidate) => (field === "subtotal" || field === "tax")
    ? candidate.financialAssociation >= Math.max(0.60, top.strongest.financialAssociation - 0.08) && candidate.financialStrongLabel && !candidate.financialOpposing
    : categoryKeyword(field, candidate.evidence)).map((candidate) => candidate.canonical));
  const noAmbiguousDate = field !== "purchase_date" || normalizeDate(top.strongest.value) !== null;
  const competingWeak = ranked.slice(1).every((candidate) => {
    const ordinaryWeak = candidate.strongest.probability < threshold - 0.05 && candidate.distinctObservations.size < minIndependentObservations;
    if (ordinaryWeak || (field !== "subtotal" && field !== "tax")) return ordinaryWeak;
    // A summary table can contain a net amount and a tax amount under one
    // header. If the candidate is materially less associated with the role
    // label and also scores lower, it is a hard negative for this field—not a
    // reason to discard the correctly aligned amount.
    return candidate.strongest.financialAssociation <= top.strongest.financialAssociation - 0.12
      && candidate.strongest.probability <= top.strongest.probability + 0.02
      && (candidate.strongest.financialAmountRank !== top.strongest.financialAmountRank || !candidate.strongest.financialStrongLabel);
  });
  // Finance thresholds use the calibrated confidence for the optional
  // one-observation path. The raw logistic score is intentionally kept as
  // the ordinary model gate, but calibration is the score that is comparable
  // to OCR confidence and can safely support an explicitly labelled amount.
  const calibratedFinanceSingle = (field === "subtotal" || field === "tax")
    && top.strongest.confidence >= strongPredictionThreshold;
  const strongFinancialSingle = (field === "subtotal" || field === "tax")
    && top.strongest.financialStrongLabel
    && top.strongest.financialAssociation >= 0.60
    && top.strongest.financialLabelDistance <= 2
    && (top.strongest.financialSameLine || top.strongest.financialColumnMatch >= 0.25)
    && !top.strongest.financialOpposing;
  const financeSemanticSingle = (field === "subtotal" && explicitSubtotalLabel.test(top.strongest.financialLabelText)
    && !subtotalInclusiveLabel.test(top.strongest.financialLabelText))
    || (field === "tax" && !taxIncludedLabel.test(top.strongest.financialLabelText)
      && !taxInclusiveDescription.test(top.strongest.financialLabelText)
      && ((top.strongest.financialSummaryContext && top.strongest.financialSummaryColumnMatch >= 0.65)
        || (top.strongest.financialDirectLabel
          && top.strongest.financialAssociation >= 0.70
          && (parseAmount(top.strongest.value) ?? 0) > 0
          && !top.strongest.financialZeroRate
          && !top.strongest.financialTableHeader
          && !top.strongest.financialTaxCodeBase)));
  const financeSingleOcrFallback = (field === "subtotal" || field === "tax")
    && financeSemanticSingle
    && top.strongest.financialStrongLabel
    && top.strongest.financialLabelDistance <= 4
    && !top.strongest.financialOpposing
    && top.strongest.financialAssociation >= 0.64
    && top.strongest.probability >= threshold
    && top.strongest.confidence >= strongConfidenceThreshold
    && confidenceFraction(top.strongest.line.confidence) >= 0.80;
  const strongSingle = allowStrongSingleObservation
    && top.distinctObservations.size === 1
    && ((field === "subtotal" || field === "tax") ? calibratedFinanceSingle : top.strongest.probability >= strongPredictionThreshold)
    && top.strongest.confidence >= strongConfidenceThreshold
    && (confidenceFraction(top.strongest.line.confidence) >= 0.90 || financeSingleOcrFallback)
    && ranked.slice(1).every((candidate) => candidate.strongest.probability < strongPredictionThreshold - 0.10
      && candidate.distinctObservations.size < minIndependentObservations);
  // A strong candidate may be supported by a weaker equivalent observation;
  // only the strongest score must clear the specialist threshold. This is
  // deliberately separate from the router score and preserves independent
  // field gates.
  const enoughIndependentSupport = top.distinctObservations.size >= minIndependentObservations || strongSingle;
  const safe = top.strongest.probability >= threshold
    && top.strongest.confidence >= (expertMinConfidenceOverride ?? configuration?.min_confidence ?? 0.98)
    && margin >= (configuration?.min_margin ?? 0.03)
    && enoughIndependentSupport
    && (strongSingle || top.distinctBands.size >= minIndependentObservations)
    && competingWeak
    && noAmbiguousDate
    && (field === "vendor" || field === "purchase_date" || strongLabel)
    && ((field !== "subtotal" && field !== "tax") || (distinctLabelValues.size === 1 && (top.distinctObservations.size >= minIndependentObservations || (strongSingle && (strongFinancialSingle || financeSingleOcrFallback)))))
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
    agreement: enoughIndependentSupport && competingWeak,
    competingValueCount: ranked.length,
    routedSupportCount: candidates.length,
  };
};

const selectSpecialist = (
  category: "receipt_id" | "item",
  candidates: ExpertCandidate[],
  minIndependentObservations: number,
  expertThresholdOverride?: number,
  expertMinConfidenceOverride?: number,
  allowStrongSingleObservation = false,
  strongPredictionThreshold = 0.92,
  strongConfidenceThreshold = 0.90,
): ReceiptHierarchicalSpecialistResult => {
  if (!candidates.length) return { category, value: null, confidence: 0, status: "missing", evidence: "", supportBandCount: 0, independentObservationCount: 0, routedSupportCount: 0 };
  candidates = candidates.filter((candidate) => !candidate.hardNegative);
  if (!candidates.length) return { category, value: null, confidence: 0, status: "missing", evidence: "", supportBandCount: 0, independentObservationCount: 0, routedSupportCount: 0 };
  const grouped = new Map<string, ExpertCandidate[]>();
  candidates.forEach((candidate) => {
    const existing = equivalentGroupKey(category, grouped.keys(), candidate.canonical);
    grouped.set(existing ?? candidate.canonical, [...(grouped.get(existing ?? candidate.canonical) ?? []), candidate]);
  });
  const ranked = [...grouped.values()].map((supports) => ({ supports, independent: independentCandidates(supports) })).sort((left, right) => right.independent.length - left.independent.length || right.independent[0].probability - left.independent[0].probability);
  const top = ranked[0];
  if (!top) return { category, value: null, confidence: 0, status: "missing", evidence: "", supportBandCount: 0, independentObservationCount: 0, routedSupportCount: 0 };
  const supports = top.supports;
  const independent = top.independent;
  const strongest = [...supports].sort((left, right) => right.probability - left.probability)[0];
  const observations = new Set(independent.map((candidate) => candidate.observationKey));
  const bands = new Set(independent.map((candidate) => candidate.bandIndex));
  const configuration = model.experts?.[category];
  const threshold = expertThresholdOverride ?? configuration?.threshold ?? 0.8;
  const strongSingle = allowStrongSingleObservation && observations.size === 1
    && strongest.probability >= strongPredictionThreshold
    && strongest.confidence >= strongConfidenceThreshold
    && confidenceFraction(strongest.line.confidence) >= 0.90
    && ranked.slice(1).every((candidate) => {
      const candidateStrongest = [...candidate.supports].sort((left, right) => right.probability - left.probability)[0];
      return candidateStrongest.probability < strongPredictionThreshold - 0.10
        && candidate.independent.length < minIndependentObservations;
    });
  const competingWeak = ranked.slice(1).every((candidate) => {
    const candidateStrongest = [...candidate.supports].sort((left, right) => right.probability - left.probability)[0];
    return candidateStrongest.probability < threshold - 0.05 && candidate.independent.length < minIndependentObservations;
  });
  const safe = strongest.probability >= threshold
    && strongest.confidence >= (expertMinConfidenceOverride ?? configuration?.min_confidence ?? 0.98)
    && (observations.size >= minIndependentObservations || strongSingle)
    && competingWeak
    && (strongSingle || bands.size >= minIndependentObservations);
  return { category, value: strongest.value, confidence: strongest.confidence, status: safe ? "trusted" : "uncertain", evidence: `${strongest.evidence} (hierarchical ${Math.round(strongest.confidence * 100)}%)`, supportBandCount: bands.size, independentObservationCount: observations.size, routedSupportCount: candidates.length };
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
): ExpertCandidate[] => candidateValues(lines, field).map((candidate) => makeCandidate(
  lines[candidate.index],
  candidate.index,
  candidate.value,
  field,
  crop,
  lines[candidate.index],
  lines,
  pageWidth,
  pageHeight,
  candidate,
));

const emptySpecialist = (category: "receipt_id" | "item"): ReceiptHierarchicalSpecialistResult => ({ category, value: null, confidence: 0, status: "missing", evidence: "", supportBandCount: 0, independentObservationCount: 0, routedSupportCount: 0 });

type FunnelCategory = ReceiptHierarchicalExtraction["funnel"]["byCategory"][ReceiptHierarchicalSpecialist];

const candidateOverlapRatio = (left: ExpertCandidate, right: ExpertCandidate): number => {
  const overlap = Math.max(0, Math.min(left.cropBottom, right.cropBottom) - Math.max(left.cropTop, right.cropTop));
  return overlap / Math.max(1, Math.min(left.cropBottom - left.cropTop, right.cropBottom - right.cropTop));
};

/**
 * Keep one representative from a crop/view observation. Adjacent first-pass
 * bands can produce nearly identical adaptive windows, and multiple
 * preprocessing views intentionally share the same crop identity. Neither
 * should count as independent agreement. Distinct crops with materially
 * different vertical support remain eligible evidence.
 */
const independentCandidates = (candidates: ExpertCandidate[]): ExpertCandidate[] => {
  const selected: ExpertCandidate[] = [];
  [...candidates].sort((left, right) => right.probability - left.probability).forEach((candidate) => {
    const duplicate = selected.some((other) => other.observationKey === candidate.observationKey
      || (candidateOverlapRatio(other, candidate) >= 0.86
        && Math.abs((other.cropTop + other.cropBottom) / 2 - (candidate.cropTop + candidate.cropBottom) / 2)
          <= Math.min(other.cropBottom - other.cropTop, candidate.cropBottom - candidate.cropTop) * 0.22));
    if (!duplicate) selected.push(candidate);
  });
  return selected;
};

const agreementCandidateCount = (
  candidates: ExpertCandidate[],
  minimum: number,
  allowStrongSingleObservation = false,
  strongPredictionThreshold = 0.92,
  strongConfidenceThreshold = 0.90,
): number => {
  const grouped = new Map<string, ExpertCandidate[]>();
  candidates.filter((candidate) => !candidate.hardNegative).forEach((candidate) => {
    const existing = equivalentGroupKey(candidate.field, grouped.keys(), candidate.canonical);
    const key = existing ?? candidate.canonical;
    grouped.set(key, [...(grouped.get(key) ?? []), candidate]);
  });
  return [...grouped.values()].filter((supports) => {
    const independent = independentCandidates(supports);
    const observations = new Set(independent.map((candidate) => candidate.observationKey));
    const bands = new Set(independent.map((candidate) => candidate.bandIndex));
    const strongest = [...supports].sort((left, right) => right.probability - left.probability)[0];
    const calibratedFinanceSingle = (strongest.field === "subtotal" || strongest.field === "tax")
      && strongest.confidence >= strongPredictionThreshold;
    const strongSingle = allowStrongSingleObservation
      && observations.size === 1
      && ((strongest.field === "subtotal" || strongest.field === "tax") ? calibratedFinanceSingle : strongest.probability >= strongPredictionThreshold)
      && strongest.confidence >= strongConfidenceThreshold
      && confidenceFraction(strongest.line.confidence) >= 0.90;
    return (strongSingle || observations.size >= minimum) && (strongSingle || bands.size >= minimum);
  }).length;
};

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
    includeDiagnostics?: boolean;
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
  const fieldCandidates = Object.fromEntries(FIELDS.map((field) => [field, candidatesFor(field)])) as Record<ReceiptFrontendField, ExpertCandidate[]>;
  const fields = Object.fromEntries(FIELDS.map((field) => {
    const category = FIELD_CATEGORY[field];
    const minimum = config.minIndependentObservationsByCategory?.[category] ?? config.minIndependentObservations;
    return [field, selectCandidates(
      field,
      fieldCandidates[field],
      minimum,
      config.expertThresholds?.[category],
      config.expertMinConfidence?.[category],
      config.allowStrongSingleObservation?.[category] ?? false,
      config.strongPredictionThreshold?.[category] ?? 0.92,
      config.strongConfidenceThreshold?.[category] ?? 0.90,
    )];
  })) as Record<ReceiptFrontendField, ReceiptHierarchicalFieldResult>;
  // Keep specialist candidate lists stable and evaluate each list once. This
  // also makes the routing funnel auditable without changing trust behavior.
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
  const specialistCandidateLists = {
    receipt_id: specialistCandidates("receipt_id"),
    item: specialistCandidates("item"),
  };
  const specialists = {
    receipt_id: specialistCandidateLists.receipt_id.length ? selectSpecialist(
      "receipt_id",
      specialistCandidateLists.receipt_id,
      config.minIndependentObservationsByCategory?.receipt_id ?? config.minIndependentObservations,
      config.expertThresholds?.receipt_id,
      config.expertMinConfidence?.receipt_id,
      config.allowStrongSingleObservation?.receipt_id ?? false,
      config.strongPredictionThreshold?.receipt_id ?? 0.92,
      config.strongConfidenceThreshold?.receipt_id ?? 0.90,
    ) : emptySpecialist("receipt_id"),
    item: specialistCandidateLists.item.length ? selectSpecialist(
      "item",
      specialistCandidateLists.item,
      config.minIndependentObservationsByCategory?.item ?? config.minIndependentObservations,
      config.expertThresholds?.item,
      config.expertMinConfidence?.item,
      config.allowStrongSingleObservation?.item ?? false,
      config.strongPredictionThreshold?.item ?? 0.92,
      config.strongConfidenceThreshold?.item ?? 0.90,
    ) : emptySpecialist("item"),
  };
  const merged = deduplicateReceiptBandLines(allLines);
  const routedCategoryCounts = Object.fromEntries(RECEIPT_HIERARCHICAL_CATEGORIES.filter((category): category is ReceiptHierarchicalSpecialist => category !== "other").map((category) => [category, predictions.filter((prediction) => prediction.routes.includes(category)).length])) as Record<ReceiptHierarchicalSpecialist, number>;
  const trustedRoutes = predictions.filter((prediction) => prediction.routes.length).length;
  const unresolvedFields = FIELDS.filter((field) => fields[field].status !== "trusted");
  const funnelCategories = [...RECEIPT_HIERARCHICAL_CATEGORIES].filter((category): category is ReceiptHierarchicalSpecialist => category !== "other");
  const funnel = Object.fromEntries(funnelCategories.map((category) => {
    const field = FIELDS.find((candidate) => FIELD_CATEGORY[candidate] === category);
    const candidates = field ? fieldCandidates[field] : specialistCandidateLists[category as "receipt_id" | "item"];
    const configuration = model.experts?.[category];
    const threshold = field ? config.expertThresholds?.[category] ?? configuration?.threshold ?? 0.8 : configuration?.threshold ?? 0.8;
    const minimumConfidence = field ? config.expertMinConfidence?.[category] ?? configuration?.min_confidence ?? 0.98 : configuration?.min_confidence ?? 0.98;
    const categoryCrops = crops.filter((crop) => crop.category === category);
    const categoryGroups = [...groups.values()].filter((lines) => lines[0]?.expertCategory === category);
    const headerPrior = (prediction: ReceiptRouterPrediction): number => clamp(1 - ((prediction.top + prediction.bottom) / 2 / Math.max(1, dimensions.height)) / 0.42);
    const minimumObservations = config.minIndependentObservationsByCategory?.[category] ?? config.minIndependentObservations;
    const allowStrongSingle = config.allowStrongSingleObservation?.[category] ?? false;
    const strongPredictionThreshold = config.strongPredictionThreshold?.[category] ?? 0.92;
    const strongConfidenceThreshold = config.strongConfidenceThreshold?.[category] ?? 0.90;
    const routerEligibleBands = predictions.filter((prediction) => prediction.probabilities[category] >= routerThreshold(category, config.routerThresholds)
      || (category === "vendor" && config.vendorHeaderPrior && headerPrior(prediction) >= 0.35 && prediction.probabilities[category] >= Math.min(routerThreshold(category, config.routerThresholds), 0.18))).length;
    let eligibleCandidates = candidates.filter((candidate) => !candidate.hardNegative);
    if (field && (field === "subtotal" || field === "tax")) eligibleCandidates = eligibleCandidates.filter((candidate) => candidate.financialAssociation >= 0.55 && !candidate.financialOpposing);
    if (field === "total") eligibleCandidates = eligibleCandidates.filter((candidate) => categoryKeyword(field, candidate.evidence));
    if (field) eligibleCandidates = focusFinancialCandidates(eligibleCandidates, field);
    if (field === "total") eligibleCandidates = eligibleCandidates.filter((candidate) => candidate.finalTotalLabel);
    const modelPassing = eligibleCandidates.filter((candidate) => candidate.probability >= threshold && candidate.confidence >= minimumConfidence).length;
    const funnelItem: FunnelCategory = {
      routerEligibleBands,
      routedBands: predictions.filter((prediction) => prediction.routes.includes(category)).length,
      cropsProposed: categoryCrops.length,
      ocrCrops: categoryGroups.length,
      ocrLines: categoryGroups.reduce((sum, lines) => sum + lines.length, 0),
      candidateValues: eligibleCandidates.length,
      modelPassing,
      agreementEligible: agreementCandidateCount(eligibleCandidates.filter((candidate) => candidate.probability >= threshold && candidate.confidence >= minimumConfidence), minimumObservations, allowStrongSingle, strongPredictionThreshold, strongConfidenceThreshold),
      trusted: field ? (fields[field].status === "trusted" ? 1 : 0) : (specialists[category as "receipt_id" | "item"].status === "trusted" ? 1 : 0),
    };
    return [category, funnelItem];
  })) as Record<ReceiptHierarchicalSpecialist, FunnelCategory>;
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
    funnel: { byCategory: funnel },
    ...(options.includeDiagnostics ? {
      diagnostics: {
        candidates: Object.fromEntries(FIELDS.map((field) => [field, fieldCandidates[field].map((candidate) => ({
          value: candidate.value,
          canonical: candidate.canonical,
          probability: candidate.probability,
          confidence: candidate.confidence,
          hardNegative: candidate.hardNegative,
          financialAssociation: candidate.financialAssociation,
          financialStrongLabel: candidate.financialStrongLabel,
          financialSameLine: candidate.financialSameLine,
          financialColumnMatch: candidate.financialColumnMatch,
          financialSummaryColumnMatch: candidate.financialSummaryColumnMatch,
          financialSummaryContext: candidate.financialSummaryContext,
          financialDirectLabel: candidate.financialDirectLabel,
          financialTableHeader: candidate.financialTableHeader,
          financialTaxCodeBase: candidate.financialTaxCodeBase,
          financialZeroRate: candidate.financialZeroRate,
          financialOpposing: candidate.financialOpposing,
          financialAmountRank: candidate.financialAmountRank,
          ocrConfidence: candidate.line.confidence,
          cropTop: candidate.cropTop,
          cropBottom: candidate.cropBottom,
          financialLabelText: candidate.financialLabelText,
          financialLabelDistance: candidate.financialLabelDistance,
          evidence: candidate.evidence,
          observationKey: candidate.observationKey,
          bandIndex: candidate.bandIndex,
        }))])) as NonNullable<ReceiptHierarchicalExtraction["diagnostics"]>["candidates"],
      },
    } : {}),
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
