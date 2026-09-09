import type { ReceiptOcrBox, ReceiptOcrLine } from "@/lib/receiptOcr";

/**
 * The benchmark adapters intentionally stop at the OCR/layout boundary. The
 * existing rules and shadow ML extractor consume ReceiptOcrLine, so changing
 * an OCR engine cannot silently change field-selection policy.
 */
export type ReceiptModernOcrEngineName =
  | "paddleocr-js-ppocrv5-mobile"
  | "paddleocr-js-ppocrv6-tiny"
  | "gutenye-ppocrv4";

export interface ReceiptModernOcrItem {
  text?: unknown;
  score?: unknown;
  poly?: unknown;
  box?: unknown;
  frame?: unknown;
}

export interface ReceiptModernOcrLine extends ReceiptOcrLine {
  /** Modern OCR engines expose a line confidence, but generally no word boxes. */
  confidence: number;
}

export interface ReceiptModernOcrPass {
  engine: ReceiptModernOcrEngineName;
  lines: ReceiptModernOcrLine[];
  text: string;
  durationMs: number;
  modelBytes: number;
  wordBoxes: number;
}

export interface ReceiptModernOcrEngineSpec {
  name: ReceiptModernOcrEngineName;
  label: string;
  model: string;
  modelBytes: number;
  runtimeBytes: number;
  license: string;
}

/**
 * Shared raw browser runtime assets measured from the benchmark install:
 * OpenCV.js, the ONNX Runtime JS bundle, and the SIMD WASM binary. Model
 * bytes are reported separately so an engine comparison cannot hide runtime
 * cost behind a small detector/recognizer archive.
 */
export const RECEIPT_MODERN_OCR_SHARED_RUNTIME_BYTES = 10_378_215 + 400_877 + 11_210_254;

/**
 * Download sizes are the public model archives/assets used by the benchmark.
 * They are kept in source so a report can explain the browser cost without
 * requiring private data or a model download during unit tests.
 */
export const RECEIPT_MODERN_OCR_ENGINES: readonly ReceiptModernOcrEngineSpec[] = [
  {
    name: "paddleocr-js-ppocrv5-mobile",
    label: "PaddleOCR.js PP-OCRv5 mobile",
    model: "PP-OCRv5 mobile det + rec",
    modelBytes: 4_843_520 + 16_701_440,
    runtimeBytes: RECEIPT_MODERN_OCR_SHARED_RUNTIME_BYTES,
    license: "Apache-2.0",
  },
  {
    name: "paddleocr-js-ppocrv6-tiny",
    label: "PaddleOCR.js PP-OCRv6 tiny",
    model: "PP-OCRv6 tiny det + rec",
    modelBytes: 1_792_000 + 4_526_080,
    runtimeBytes: RECEIPT_MODERN_OCR_SHARED_RUNTIME_BYTES,
    license: "Apache-2.0",
  },
  {
    name: "gutenye-ppocrv4",
    label: "Guten OCR browser PP-OCRv4",
    model: "PP-OCRv4 det + rec + angle classifier + dictionary",
    modelBytes: 4_745_517 + 10_822_323 + 578_966 + 26_249,
    runtimeBytes: RECEIPT_MODERN_OCR_SHARED_RUNTIME_BYTES,
    license: "MIT wrapper / PaddleOCR model license",
  },
] as const;

const finite = (value: unknown): number | null => {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
};

const point = (value: unknown): [number, number] | null => {
  if (!Array.isArray(value) || value.length < 2) return null;
  const x = finite(value[0]);
  const y = finite(value[1]);
  return x === null || y === null ? null : [x, y];
};

const polygon = (value: unknown): Array<[number, number]> => {
  if (!Array.isArray(value)) return [];
  return value.map(point).filter((candidate): candidate is [number, number] => Boolean(candidate));
};

export const receiptOcrBoxFromPolygon = (value: unknown): ReceiptOcrBox | undefined => {
  const points = polygon(value);
  if (points.length < 4) return undefined;
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  return {
    x0: Math.min(...xs),
    y0: Math.min(...ys),
    x1: Math.max(...xs),
    y1: Math.max(...ys),
  };
};

const scoreAsPercent = (value: unknown): number => {
  const score = finite(value) ?? 0;
  return Math.max(0, Math.min(100, score <= 1 ? score * 100 : score));
};

const textValue = (value: unknown): string => typeof value === "string" ? value.trim() : "";

const sortLines = (lines: ReceiptModernOcrLine[]): ReceiptModernOcrLine[] => [...lines]
  .filter((line) => line.text.length > 0)
  .sort((left, right) => {
    const leftY = left.bbox?.y0 ?? 0;
    const rightY = right.bbox?.y0 ?? 0;
    const rowHeight = Math.max(left.bbox?.y1 ?? 0, right.bbox?.y1 ?? 0) - Math.min(leftY, rightY);
    return Math.abs(leftY - rightY) <= Math.max(8, rowHeight * 0.4)
      ? (left.bbox?.x0 ?? 0) - (right.bbox?.x0 ?? 0)
      : leftY - rightY;
  });

/** Convert PaddleOCR.js OcrResultItem[] to the app's stable OCR line shape. */
export const receiptOcrLinesFromPaddleItems = (items: unknown): ReceiptModernOcrLine[] => {
  if (!Array.isArray(items)) return [];
  return sortLines(items.map((item): ReceiptModernOcrLine => {
    const typed = (item ?? {}) as ReceiptModernOcrItem;
    return {
      text: textValue(typed.text),
      confidence: scoreAsPercent(typed.score),
      bbox: receiptOcrBoxFromPolygon(typed.poly ?? typed.box),
    };
  }));
};

/** Convert Guten OCR's { text, mean, box } line records. */
export const receiptOcrLinesFromGutenyeLines = (items: unknown): ReceiptModernOcrLine[] => {
  if (!Array.isArray(items)) return [];
  return sortLines(items.map((item): ReceiptModernOcrLine => {
    const typed = (item ?? {}) as ReceiptModernOcrItem;
    const frame = typed.frame as Record<string, unknown> | undefined;
    const frameBox = frame ? {
      x0: finite(frame.left) ?? 0,
      y0: finite(frame.top) ?? 0,
      x1: (finite(frame.left) ?? 0) + (finite(frame.width) ?? 0),
      y1: (finite(frame.top) ?? 0) + (finite(frame.height) ?? 0),
    } : undefined;
    return {
      text: textValue(typed.text),
      confidence: scoreAsPercent((item as { mean?: unknown } | null)?.mean ?? typed.score),
      bbox: frameBox ?? receiptOcrBoxFromPolygon(typed.box ?? typed.poly),
    };
  }));
};

export const receiptOcrTextFromModernLines = (lines: ReceiptOcrLine[]): string => lines
  .map((line) => line.text.replace(/[|¦]/g, " ").replace(/\s+/g, " ").trim())
  .filter(Boolean)
  .join("\n");

export const receiptModernOcrPass = (
  engine: ReceiptModernOcrEngineName,
  lines: ReceiptModernOcrLine[],
  durationMs: number,
): ReceiptModernOcrPass => ({
  engine,
  lines,
  text: receiptOcrTextFromModernLines(lines),
  durationMs,
  modelBytes: RECEIPT_MODERN_OCR_ENGINES.find((candidate) => candidate.name === engine)?.modelBytes ?? 0,
  wordBoxes: lines.reduce((count, line) => count + (line.words?.length ?? 0), 0),
});
