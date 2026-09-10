import type { ReceiptFrontendExtraction, ReceiptFrontendField, ReceiptFrontendFields, ReceiptFrontendFieldResult } from "@/lib/receiptFrontendExtractor";
import { extractReceiptFieldsFromOcrLines } from "@/lib/receiptFrontendExtractor";
import { extractReceiptFieldsFromPpocrV6Lines } from "@/lib/receiptPpocrV6Extractor";
import type { ReceiptOcrBox, ReceiptOcrLine, ReceiptOcrPreprocessing } from "@/lib/receiptOcr";

/**
 * Browser-safe horizontal-band OCR configuration.  The image work happens in
 * the benchmark/browser adapter; this file contains the deterministic geometry
 * and aggregation policy shared by that adapter and unit tests.
 */
export type ReceiptBandHeightMode = "fraction" | "pixels" | "line-heights";

export type ReceiptBandSelector = "rules" | "adapted" | "rules-ml-hybrid";

/** Per-field presence is deliberately independent from value selection. */
export type ReceiptBandPresence = "not-present" | "uncertain" | "present";

export interface ReceiptBandConfig {
  name: string;
  bandHeightMode: ReceiptBandHeightMode;
  /** Fraction of image height, pixels, or number of detected line heights. */
  bandHeight: number;
  overlap: number;
  preprocessing: ReceiptOcrPreprocessing;
  /** Target long side for a band input. A larger value is more expensive. */
  maxDimension: number;
  /** Allow small receipt bands to be upscaled, bounded by maxDimension. */
  maxScale: number;
  includeWholeImage: boolean;
  selector: ReceiptBandSelector;
  /** Require this many distinct OCR band observations before trust. */
  minIndependentBands: number;
  /** Optional detector setting passed through by the browser runner. */
  textDetectionBoxThreshold?: number;
  /** Optional PP-OCR detector input side limit, separate from canvas scale. */
  textDetectionLimitSideLen?: number;
}

export interface ReceiptHorizontalBand {
  index: number;
  top: number;
  bottom: number;
  height: number;
  width: number;
}

export interface ReceiptBandObservation extends ReceiptOcrLine {
  /** -1 identifies the whole-image observation when it is enabled. */
  bandIndex: number;
  bandTop: number;
  bandBottom: number;
  /** A unique OCR pass/config key. Duplicate lines from one pass never count twice. */
  observationKey: string;
}

export interface ReceiptMergedLine extends ReceiptOcrLine {
  supportCount: number;
  independentBandCount: number;
  sourceBands: number[];
  sourceObservationKeys: string[];
  supportTextVariants: string[];
}

export interface ReceiptBandFieldObservation {
  bandIndex: number;
  observationKey: string;
  result: ReceiptFrontendFieldResult;
  /** The merged view is useful evidence but is never an independent vote. */
  isMerged?: boolean;
}

export interface ReceiptBandFieldResult extends ReceiptFrontendFieldResult {
  /** A presence result never implies that the value itself is safe to trust. */
  presence: ReceiptBandPresence;
  supportBandCount: number;
  independentObservationCount: number;
  trustedSupportCount: number;
  agreement: boolean;
  competingValueCount: number;
}

export interface ReceiptBandExtraction extends Omit<ReceiptFrontendExtraction, "fields"> {
  engine: "ppocrv6-bands";
  fields: Record<ReceiptFrontendField, ReceiptBandFieldResult>;
  mergedLines: ReceiptMergedLine[];
  bandResults: Array<{
    bandIndex: number;
    observationKey: string;
    fields: ReceiptFrontendFields;
    unresolvedFields: ReceiptFrontendField[];
  }>;
  deduplication: {
    inputLineCount: number;
    mergedLineCount: number;
    duplicateLineCount: number;
    meanSupportCount: number;
    multiBandLineCount: number;
  };
}

export interface ReceiptBandExtractionOptions {
  selector?: ReceiptBandSelector;
  minIndependentBands?: number;
  /** Keep a single very-high-confidence whole-image result as a fallback. */
  allowSingleWholeImage?: boolean;
}

const FIELDS: readonly ReceiptFrontendField[] = ["vendor", "purchase_date", "subtotal", "tax", "total"];

/** Configurations used for screening. The full-corpus winner is recorded by name in the report. */
export const RECEIPT_BAND_SCREENING_CONFIGS: readonly ReceiptBandConfig[] = [
  {
    name: "fraction30-overlap20-original-1600-band-only",
    bandHeightMode: "fraction",
    bandHeight: 0.30,
    overlap: 0.20,
    preprocessing: "original",
    maxDimension: 1600,
    maxScale: 1,
    includeWholeImage: false,
    selector: "adapted",
    minIndependentBands: 2,
    textDetectionLimitSideLen: 960,
  },
  {
    name: "fraction40-overlap30-contrast-2200-band-only",
    bandHeightMode: "fraction",
    bandHeight: 0.40,
    overlap: 0.30,
    preprocessing: "contrast",
    maxDimension: 2200,
    maxScale: 1.25,
    includeWholeImage: false,
    selector: "adapted",
    minIndependentBands: 2,
    textDetectionLimitSideLen: 1280,
  },
  {
    name: "fraction50-overlap40-sharpen-2200-band-only",
    bandHeightMode: "fraction",
    bandHeight: 0.50,
    overlap: 0.40,
    preprocessing: "sharpen",
    maxDimension: 2200,
    maxScale: 1.25,
    includeWholeImage: false,
    selector: "adapted",
    minIndependentBands: 2,
    textDetectionLimitSideLen: 1280,
  },
  {
    name: "fraction40-overlap50-contrast-2800-whole-plus-band",
    bandHeightMode: "fraction",
    bandHeight: 0.40,
    overlap: 0.50,
    preprocessing: "contrast",
    maxDimension: 2800,
    maxScale: 1.5,
    includeWholeImage: true,
    selector: "adapted",
    minIndependentBands: 2,
    textDetectionLimitSideLen: 1280,
  },
  {
    name: "fraction50-overlap60-adaptive-2200-whole-plus-band",
    bandHeightMode: "fraction",
    bandHeight: 0.50,
    overlap: 0.60,
    preprocessing: "adaptive",
    maxDimension: 2200,
    maxScale: 1.25,
    includeWholeImage: true,
    selector: "adapted",
    minIndependentBands: 2,
    textDetectionLimitSideLen: 1280,
  },
  {
    name: "pixels480-overlap40-sharpen-2800-whole-plus-band",
    bandHeightMode: "pixels",
    bandHeight: 480,
    overlap: 0.40,
    preprocessing: "sharpen",
    maxDimension: 2800,
    maxScale: 1.5,
    includeWholeImage: true,
    selector: "adapted",
    minIndependentBands: 2,
    textDetectionLimitSideLen: 1280,
  },
  {
    name: "line-heights4-overlap40-original-2200-band-only",
    bandHeightMode: "line-heights",
    bandHeight: 4,
    overlap: 0.40,
    preprocessing: "original",
    maxDimension: 2200,
    maxScale: 1.25,
    includeWholeImage: false,
    selector: "adapted",
    minIndependentBands: 2,
    textDetectionLimitSideLen: 960,
  },
  {
    name: "line-heights6-overlap50-contrast-2800-whole-plus-band",
    bandHeightMode: "line-heights",
    bandHeight: 6,
    overlap: 0.50,
    preprocessing: "contrast",
    maxDimension: 2800,
    maxScale: 1.5,
    includeWholeImage: true,
    selector: "adapted",
    minIndependentBands: 2,
    textDetectionLimitSideLen: 1280,
  },
  {
    name: "fraction40-overlap40-contrast-2200-rules-hybrid",
    bandHeightMode: "fraction",
    bandHeight: 0.40,
    overlap: 0.40,
    preprocessing: "contrast",
    maxDimension: 2200,
    maxScale: 1.25,
    includeWholeImage: true,
    selector: "rules-ml-hybrid",
    minIndependentBands: 2,
    textDetectionLimitSideLen: 1280,
  },
];

/** Validation-selected candidate; intentionally not wired into production OCR. */
export const RECEIPT_BAND_EXPERIMENTAL_CONFIG: ReceiptBandConfig = {
  name: "fraction40-overlap40-contrast-2200-rules-hybrid",
  bandHeightMode: "fraction",
  bandHeight: 0.40,
  overlap: 0.40,
  preprocessing: "contrast",
  maxDimension: 2200,
  maxScale: 1.25,
  includeWholeImage: true,
  selector: "rules-ml-hybrid",
  minIndependentBands: 2,
  textDetectionLimitSideLen: 1280,
};

const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(high, value));

const finitePositive = (value: number | undefined, fallback: number): number => (
  value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback
);

/** Return a robust median without mutating the caller's array. */
export const median = (values: number[]): number => {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

const detectedLineHeight = (lines: ReceiptOcrLine[] | undefined, imageHeight: number): number => {
  const heights = (lines ?? [])
    .map((line) => line.bbox ? Math.abs(line.bbox.y1 - line.bbox.y0) : 0)
    .filter((height) => height > 0 && height < imageHeight * 0.25);
  return median(heights) || Math.max(12, imageHeight / 40);
};

/**
 * Build bands that cover the complete image. The final band is anchored to the
 * bottom edge so the footer is never omitted by rounding or step arithmetic.
 */
export const createHorizontalBands = (
  width: number,
  height: number,
  config: Pick<ReceiptBandConfig, "bandHeightMode" | "bandHeight" | "overlap">,
  seedLines?: ReceiptOcrLine[],
): ReceiptHorizontalBand[] => {
  const safeWidth = Math.max(1, Math.round(finitePositive(width, 1)));
  const safeHeight = Math.max(1, Math.round(finitePositive(height, 1)));
  const lineHeight = detectedLineHeight(seedLines, safeHeight);
  const requestedHeight = config.bandHeightMode === "fraction"
    ? safeHeight * clamp(config.bandHeight, 0.05, 1)
    : config.bandHeightMode === "pixels"
      ? config.bandHeight
      : lineHeight * clamp(config.bandHeight, 1, 12);
  const bandHeight = Math.max(1, Math.min(safeHeight, Math.round(finitePositive(requestedHeight, safeHeight))));
  const overlap = clamp(config.overlap, 0, 0.9);
  const step = Math.max(1, Math.round(bandHeight * (1 - overlap)));
  const tops: number[] = [0];
  while (true) {
    const next = tops[tops.length - 1] + step;
    if (next + bandHeight >= safeHeight) break;
    tops.push(next);
  }
  const bottomTop = Math.max(0, safeHeight - bandHeight);
  if (tops[tops.length - 1] !== bottomTop) tops.push(bottomTop);
  return tops.map((top, index) => ({
    index,
    top,
    bottom: Math.min(safeHeight, top + bandHeight),
    height: Math.min(safeHeight, top + bandHeight) - top,
    width: safeWidth,
  }));
};

const normalizedText = (value: string): string => value
  .toUpperCase()
  .replace(/[|¦]/g, "I")
  .replace(/[^A-Z0-9]+/g, "")
  .trim();

const tokens = (value: string): string[] => value.toUpperCase().match(/[A-Z0-9]+/g) ?? [];

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
      previous[column] = Math.min(
        previous[column] + 1,
        previous[column - 1] + 1,
        diagonal + (left[row - 1] === right[column - 1] ? 0 : 1),
      );
      diagonal = saved;
    }
  }
  return 1 - previous[right.length] / Math.max(left.length, right.length);
};

const intersection = (left: ReceiptOcrBox, right: ReceiptOcrBox): ReceiptOcrBox | null => {
  const x0 = Math.max(Math.min(left.x0, left.x1), Math.min(right.x0, right.x1));
  const y0 = Math.max(Math.min(left.y0, left.y1), Math.min(right.y0, right.y1));
  const x1 = Math.min(Math.max(left.x0, left.x1), Math.max(right.x0, right.x1));
  const y1 = Math.min(Math.max(left.y0, left.y1), Math.max(right.y0, right.y1));
  return x1 > x0 && y1 > y0 ? { x0, y0, x1, y1 } : null;
};

const area = (box: ReceiptOcrBox): number => Math.max(0, box.x1 - box.x0) * Math.max(0, box.y1 - box.y0);

const boxIoU = (left: ReceiptOcrBox | undefined, right: ReceiptOcrBox | undefined): number => {
  if (!left || !right) return 0;
  const overlap = intersection(left, right);
  if (!overlap) return 0;
  return area(overlap) / Math.max(1, area(left) + area(right) - area(overlap));
};

const verticalOverlap = (left: ReceiptOcrBox | undefined, right: ReceiptOcrBox | undefined): number => {
  if (!left || !right) return 0;
  const leftTop = Math.min(left.y0, left.y1);
  const rightTop = Math.min(right.y0, right.y1);
  const leftBottom = Math.max(left.y0, left.y1);
  const rightBottom = Math.max(right.y0, right.y1);
  return Math.max(0, Math.min(leftBottom, rightBottom) - Math.max(leftTop, rightTop))
    / Math.max(1, Math.min(leftBottom - leftTop, rightBottom - rightTop));
};

const centerDistance = (left: ReceiptOcrBox | undefined, right: ReceiptOcrBox | undefined): { x: number; y: number } => ({
  x: left && right ? Math.abs((left.x0 + left.x1) / 2 - (right.x0 + right.x1) / 2) : Number.POSITIVE_INFINITY,
  y: left && right ? Math.abs((left.y0 + left.y1) / 2 - (right.y0 + right.y1) / 2) : Number.POSITIVE_INFINITY,
});

const fieldHint = (text: string): string => {
  const value = text.toLowerCase();
  if (/\b(?:sub[ -]?total|before\s+tax)\b/.test(value)) return "subtotal";
  if (/\b(?:tax|gst|hst|vat|sales\s+tax)\b/.test(value)) return "tax";
  if (/\b(?:grand\s+total|total\s+due|amount\s+due|balance\s+due|payable|total)\b/.test(value)) return "total";
  if (/\b(?:date|issued|invoice)\b|\b\d{1,2}[/. -]\d{1,2}[/. -](?:20)?\d{2}\b/.test(value)) return "date";
  if (/\d+[.,]\d{2}/.test(value)) return "amount";
  return "text";
};

const amountKey = (text: string): string | null => {
  const match = text.match(/(?:[$€£]|\b(?:rm|usd|cad|gbp)\b)?\s*(\d{1,6}(?:[,.]\d{3})*(?:[,.]\d{2}))/i);
  if (!match) return null;
  const raw = match[1];
  const comma = raw.lastIndexOf(",");
  const dot = raw.lastIndexOf(".");
  const normalized = comma > dot ? raw.replace(/\./g, "").replace(",", ".") : raw.replace(/,/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed.toFixed(2) : null;
};

const dateKey = (text: string): string | null => {
  const match = text.match(/\b(?:20\d{2}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.](?:20)?\d{2})\b/);
  return match ? match[0].replace(/[/.]/g, "-") : null;
};

const lineValueKey = (text: string): string => amountKey(text) ?? dateKey(text) ?? normalizedText(text);

const lineMatch = (left: ReceiptBandObservation, right: ReceiptBandObservation): boolean => {
  const leftText = normalizedText(left.text);
  const rightText = normalizedText(right.text);
  if (!leftText || !rightText) return false;
  const sameValue = lineValueKey(left.text) === lineValueKey(right.text);
  const sameHint = fieldHint(left.text) === fieldHint(right.text);
  const textSimilarity = editSimilarity(leftText, rightText);
  const iou = boxIoU(left.bbox, right.bbox);
  const yOverlap = verticalOverlap(left.bbox, right.bbox);
  const distance = centerDistance(left.bbox, right.bbox);
  const maxHeight = Math.max(left.bbox ? Math.abs(left.bbox.y1 - left.bbox.y0) : 1, right.bbox ? Math.abs(right.bbox.y1 - right.bbox.y0) : 1);
  const near = distance.y <= Math.max(12, maxHeight * 1.35) && distance.x <= Math.max(80, maxHeight * 8);
  if (iou >= 0.18 || (yOverlap >= 0.5 && near)) {
    if (textSimilarity >= 0.62) return true;
    if (sameValue && sameHint && textSimilarity >= 0.42) return true;
  }
  // Geometry is absent in a few fallback OCR records. Exact text can still be
  // merged only when it comes from different bands; within one pass the
  // observation key guard below prevents accidental collapsing of same-text
  // separate lines.
  return !left.bbox && !right.bbox && left.observationKey !== right.observationKey && leftText === rightText;
};

const observationQuality = (line: ReceiptBandObservation): number => {
  const confidence = line.confidence === undefined || !Number.isFinite(line.confidence)
    ? 0.75
    : line.confidence > 1 ? line.confidence / 100 : line.confidence;
  const geometry = line.bbox ? 0.04 : 0;
  const polygon = line.polygon && line.polygon.length >= 4 ? 0.02 : 0;
  return Math.max(0, Math.min(1, confidence)) + geometry + polygon;
};

const mergedLine = (group: ReceiptBandObservation[]): ReceiptMergedLine => {
  const best = [...group].sort((left, right) => observationQuality(right) - observationQuality(left))[0];
  const sourceBands = [...new Set(group.map((line) => line.bandIndex))].sort((left, right) => left - right);
  const sourceObservationKeys = [...new Set(group.map((line) => line.observationKey))].sort();
  return {
    ...best,
    supportCount: group.length,
    independentBandCount: sourceBands.length,
    sourceBands,
    sourceObservationKeys,
    supportTextVariants: [...new Set(group.map((line) => line.text))],
  };
};

/**
 * Merge line detections before field extraction. A line seen in three
 * overlapping bands is one line, not three votes; the metadata records the
 * independent pass count for the later safety gate.
 */
export const deduplicateReceiptBandLines = (observations: ReceiptBandObservation[]): ReceiptMergedLine[] => {
  const groups: ReceiptBandObservation[][] = [];
  const ordered = [...observations].filter((line) => line.text.trim().length > 0).sort((left, right) => (
    (left.bbox?.y0 ?? 0) - (right.bbox?.y0 ?? 0)
  ));
  ordered.forEach((line) => {
    const match = groups.find((group) => {
      const representative = group[0];
      // A single observation cannot represent two separate OCR lines from the
      // same band. This also protects receipts that print the same amount twice.
      if (representative.observationKey === line.observationKey && representative.bandIndex === line.bandIndex) return false;
      return lineMatch(representative, line);
    });
    if (match) match.push(line);
    else groups.push([line]);
  });
  return groups
    .map(mergedLine)
    .sort((left, right) => (left.bbox?.y0 ?? 0) - (right.bbox?.y0 ?? 0));
};

const canonicalFieldValue = (field: ReceiptFrontendField, value: string): string => {
  if (field === "vendor") return normalizedText(value);
  if (field === "purchase_date") return dateKey(value) ?? value;
  return amountKey(value) ?? normalizedText(value);
};

const independentKeys = (observations: ReceiptBandFieldObservation[]): string[] => [...new Set(
  observations.filter((item) => !item.isMerged).map((item) => item.observationKey),
)];

/**
 * Presence gate used before value aggregation. A candidate can be present but
 * uncertain; that state must continue to GPT/review rather than becoming a
 * trusted value merely because another field was trusted.
 */
export const classifyReceiptBandFieldPresence = (observations: ReceiptBandFieldObservation[]): ReceiptBandPresence => {
  const candidates = observations.filter((item) => Boolean(item.result.value));
  if (!candidates.length) return "not-present";
  return candidates.some((item) => item.result.status === "trusted") ? "present" : "uncertain";
};

const supportsIndependentBands = (observations: ReceiptBandFieldObservation[]): number => new Set(
  observations.filter((item) => !item.isMerged).map((item) => item.bandIndex),
).size;

const resultWithBandEvidence = (
  field: ReceiptFrontendField,
  value: string,
  supports: ReceiptBandFieldObservation[],
  competingValueCount: number,
  minIndependentBands: number,
  allowSingleWholeImage: boolean,
): ReceiptBandFieldResult => {
  const bandCount = supportsIndependentBands(supports);
  const observationCount = independentKeys(supports).length;
  const trustedSupports = supports.filter((item) => item.result.status === "trusted");
  const maxConfidence = Math.max(...supports.map((item) => item.result.confidence), 0);
  const hasWholeImage = supports.some((item) => item.bandIndex < 0);
  const hasIndependentAgreement = bandCount >= minIndependentBands && observationCount >= minIndependentBands;
  const agreement = hasIndependentAgreement || (allowSingleWholeImage && hasWholeImage && trustedSupports.length > 0);
  const strongest = [...supports].sort((left, right) => right.result.confidence - left.result.confidence)[0];
  const confidence = Math.min(0.999, maxConfidence + (hasIndependentAgreement ? 0.01 : 0));
  const trusted = agreement
    && trustedSupports.length >= Math.min(minIndependentBands, bandCount)
    && competingValueCount <= 1
    // Existing browser rules calibrate strong dates/vendors at .95-.97;
    // requiring two independently trusted observations is the safety margin
    // for those candidates. PP-OCRv6's adapted selector commonly reports 1.0.
    && confidence >= 0.95;
  const evidence = `${strongest.result.evidence || value} (dedup ${bandCount} band${bandCount === 1 ? "" : "s"}, ${observationCount} independent pass${observationCount === 1 ? "" : "es"}${competingValueCount > 1 ? ", competing values" : ""})`;
  return {
    value,
    confidence,
    status: trusted ? "trusted" : "uncertain",
    source: "ml",
    evidence,
    presence: trusted ? "present" : "uncertain",
    supportBandCount: bandCount,
    independentObservationCount: observationCount,
    trustedSupportCount: trustedSupports.length,
    agreement,
    competingValueCount,
  };
};

const emptyBandField = (): ReceiptBandFieldResult => ({
  value: null,
  confidence: 0,
  status: "missing",
  source: "ml",
  evidence: "",
  presence: "not-present",
  supportBandCount: 0,
  independentObservationCount: 0,
  trustedSupportCount: 0,
  agreement: false,
  competingValueCount: 0,
});

const selectBandField = (
  field: ReceiptFrontendField,
  observations: ReceiptBandFieldObservation[],
  minIndependentBands: number,
  allowSingleWholeImage: boolean,
): ReceiptBandFieldResult => {
  const presence = classifyReceiptBandFieldPresence(observations);
  if (presence === "not-present") return emptyBandField();
  const values = new Map<string, ReceiptBandFieldObservation[]>();
  observations.forEach((item) => {
    if (!item.result.value) return;
    const key = canonicalFieldValue(field, item.result.value);
    const existing = [...values.keys()].find((candidate) => candidate === key || (
      field === "vendor" && editSimilarity(candidate, key) >= 0.92
    ));
    const target = existing ?? key;
    values.set(target, [...(values.get(target) ?? []), item]);
  });
  if (!values.size) return emptyBandField();
  const ranked = [...values.entries()].sort((left, right) => {
    const leftSupports = new Set(left[1].map((item) => item.observationKey)).size;
    const rightSupports = new Set(right[1].map((item) => item.observationKey)).size;
    const leftTrusted = left[1].filter((item) => item.result.status === "trusted").length;
    const rightTrusted = right[1].filter((item) => item.result.status === "trusted").length;
    const leftConfidence = Math.max(...left[1].map((item) => item.result.confidence), 0);
    const rightConfidence = Math.max(...right[1].map((item) => item.result.confidence), 0);
    return (rightTrusted - leftTrusted) || (rightSupports - leftSupports) || (rightConfidence - leftConfidence);
  });
  const [key, supports] = ranked[0];
  return resultWithBandEvidence(field, supports[0].result.value ?? key, supports, ranked.length, minIndependentBands, allowSingleWholeImage);
};

const bandSelector = (lines: ReceiptOcrLine[], selector: ReceiptBandSelector, text: string): ReceiptFrontendExtraction => {
  const applyTotalSafetyGuard = (extraction: ReceiptFrontendExtraction): ReceiptFrontendExtraction => {
    const total = extraction.fields.total;
    const evidence = total.evidence ?? "";
    const salesSubtotalLike = /\bsales?\b/i.test(evidence) && !/\b(?:after|grand|due|payable|final)\b/i.test(evidence);
    const unsafeTotalContext = /\b(?:suppl(?:y|ies)|saving|discount|gst\s+summary|tax\s+summary|rounding\s+(?:adjustment|adj))\b/i.test(evidence)
      || /\b\d+(?:[.,]\d+)?\s*%/.test(evidence)
      || salesSubtotalLike;
    if (!unsafeTotalContext || total.status === "missing") return extraction;
    return {
      ...extraction,
      fields: {
        ...extraction.fields,
        total: {
          ...total,
          status: "uncertain",
          evidence: `${evidence}; conservative total-context guard`,
        },
      },
      unresolvedFields: FIELDS.filter((field) => field === "total" || extraction.fields[field].status !== "trusted"),
    };
  };
  if (selector === "rules") return applyTotalSafetyGuard(extractReceiptFieldsFromOcrLines(lines, "ppocrv6", text, { useModel: false }));
  if (selector === "rules-ml-hybrid") {
    const rules = extractReceiptFieldsFromOcrLines(lines, "ppocrv6", text, { useModel: false });
    const adapted = extractReceiptFieldsFromPpocrV6Lines(lines, text);
    const fields = Object.fromEntries(FIELDS.map((field) => [
      field,
      adapted.fields[field].status === "trusted" ? adapted.fields[field] : rules.fields[field],
    ])) as ReceiptFrontendFields;
    return applyTotalSafetyGuard({
      ...adapted,
      fields,
      unresolvedFields: FIELDS.filter((field) => fields[field].status !== "trusted"),
      engine: "ppocrv6",
    });
  }
  return applyTotalSafetyGuard(extractReceiptFieldsFromPpocrV6Lines(lines, text));
};

/**
 * Run the existing independent selector per band and aggregate only after
 * deduplication. Each field has its own support/ambiguity gate; no subtotal,
 * tax, date, vendor, or total result is used as evidence for another field.
 */
export const extractReceiptFieldsFromPpocrV6Bands = (
  observations: ReceiptBandObservation[],
  options: ReceiptBandExtractionOptions = {},
): ReceiptBandExtraction => {
  const selector = options.selector ?? "adapted";
  const minIndependentBands = Math.max(1, Math.round(options.minIndependentBands ?? 2));
  const allowSingleWholeImage = options.allowSingleWholeImage ?? false;
  const groups = new Map<string, ReceiptBandObservation[]>();
  observations.forEach((line) => {
    const group = groups.get(line.observationKey) ?? [];
    group.push(line);
    groups.set(line.observationKey, group);
  });
  const bandResults = [...groups.entries()].map(([observationKey, lines]) => {
    const extraction = bandSelector(lines, selector, lines.map((line) => line.text).join("\n"));
    return {
      bandIndex: lines[0]?.bandIndex ?? -1,
      observationKey,
      fields: extraction.fields,
      unresolvedFields: extraction.unresolvedFields,
    };
  });
  const mergedLines = deduplicateReceiptBandLines(observations);
  const mergedExtraction = bandSelector(mergedLines, selector, mergedLines.map((line) => line.text).join("\n"));
  const fields = Object.fromEntries(FIELDS.map((field) => {
    const fieldObservations: ReceiptBandFieldObservation[] = bandResults.flatMap((band) => {
      const result = band.fields[field];
      return result.value ? [{ bandIndex: band.bandIndex, observationKey: band.observationKey, result }] : [];
    });
    // The merged whole view is a separate candidate only when it was not
    // already represented by a per-pass result. It provides useful evidence
    // for a broad line that straddles a band boundary but cannot by itself
    // bypass the multi-band gate.
    const mergedResult = mergedExtraction.fields[field];
    const mergedKey = "merged-deduplicated";
    if (mergedResult.value && !fieldObservations.some((item) => item.result.value === mergedResult.value)) {
      fieldObservations.push({ bandIndex: -2, observationKey: mergedKey, result: mergedResult, isMerged: true });
    }
    return [field, selectBandField(field, fieldObservations, minIndependentBands, allowSingleWholeImage)];
  })) as ReceiptBandFields;
  const unresolvedFields = FIELDS.filter((field) => fields[field].status !== "trusted");
  const inputLineCount = observations.length;
  const mergedLineCount = mergedLines.length;
  const duplicateLineCount = Math.max(0, inputLineCount - mergedLineCount);
  const meanSupportCount = mergedLineCount
    ? mergedLines.reduce((sum, line) => sum + line.supportCount, 0) / mergedLineCount
    : 0;
  return {
    text: mergedLines.map((line) => line.text).join("\n"),
    fields,
    unresolvedFields,
    durationMs: 0,
    engine: "ppocrv6-bands",
    ocrLines: mergedLines,
    mergedLines,
    bandResults,
    deduplication: {
      inputLineCount,
      mergedLineCount,
      duplicateLineCount,
      meanSupportCount,
      multiBandLineCount: mergedLines.filter((line) => line.independentBandCount > 1).length,
    },
  };
};

type ReceiptBandFields = Record<ReceiptFrontendField, ReceiptBandFieldResult>;

/** Map a local OCR box to source-image coordinates. */
export const mapReceiptBandBoxToSource = (box: ReceiptOcrBox | undefined, top: number, scale: number): ReceiptOcrBox | undefined => {
  if (!box) return undefined;
  const safeScale = finitePositive(scale, 1);
  return {
    x0: box.x0 / safeScale,
    y0: box.y0 / safeScale + top,
    x1: box.x1 / safeScale,
    y1: box.y1 / safeScale + top,
  };
};

export const mapReceiptBandLineToSource = <T extends ReceiptOcrLine>(line: T, top: number, scale: number): T => ({
  ...line,
  bbox: mapReceiptBandBoxToSource(line.bbox, top, scale),
  polygon: line.polygon?.map(([x, y]) => [x / finitePositive(scale, 1), y / finitePositive(scale, 1) + top] as [number, number]),
  words: line.words?.map((word) => ({ ...word, bbox: mapReceiptBandBoxToSource(word.bbox, top, scale) })),
});
