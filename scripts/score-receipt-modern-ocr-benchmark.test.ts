import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ReceiptFrontendField, ReceiptFrontendFields } from "@/lib/receiptFrontendExtractor";
import type { ReceiptOcrLine } from "@/lib/receiptOcr";
import { RECEIPT_MODERN_OCR_SHARED_RUNTIME_BYTES } from "@/lib/receiptModernOcr";

const root = process.cwd();
const fields: ReceiptFrontendField[] = ["vendor", "purchase_date", "subtotal", "tax", "total"];
const duplicateGroup = new Map([[12, 12], [15, 12], [16, 12], [18, 12], [277, 277], [452, 277]]);
const splitFor = (id: string): "tuning" | "validation" | "final" => {
  const index = Number(id);
  const representative = duplicateGroup.get(index) ?? index;
  return representative < 300 ? "tuning" : representative < 400 ? "validation" : "final";
};

interface ModernRow {
  id: string;
  durationMs: number;
  lineCount: number;
  wordCount: number;
  ocrError?: boolean;
  text?: string;
  lines?: ReceiptOcrLine[];
  fields: ReceiptFrontendFields;
  unresolvedFields?: ReceiptFrontendField[];
  category?: string;
  heapBefore?: number | null;
  heapAfter?: number | null;
}

interface ProductionFieldRecord {
  value?: unknown;
  evidence?: unknown;
}

interface ModernEngineResult {
  spec: { name: string; label: string; modelBytes: number; runtimeBytes: number; license: string };
  initializationMs: number;
  firstInferenceMs: number | null;
  inferenceTimes: number[];
  heapAfterInitialization?: number | null;
  initializationError?: string;
  rows: ModernRow[];
}

interface ModernBenchmark {
  dataset: "sroie" | "production";
  subset: string;
  variant?: string;
  sampleSize: number;
  engines: Record<string, ModernEngineResult>;
}

const normalizeText = (value: string): string => value.toUpperCase().replace(/[^A-Z0-9]/g, "");
const normalizeDigits = (value: string): string => value.replace(/\D/g, "");

const expectedDate = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const iso = value.match(/^(20\d{2})[/.-](\d{1,2})[/.-](\d{1,2})$/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const match = value.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](20\d{2}|\d{2})$/);
  if (!match) return null;
  const year = match[3].length === 2 ? `20${match[3]}` : match[3];
  if (Number(match[1]) > 12) return `${year}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
  if (Number(match[2]) > 12) return `${year}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}`;
  return `${year}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
};

const numeric = (value: string): number | null => {
  const cleaned = value.replace(/[$€£\s]/g, "").replace(/,/g, "");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
};

const amountTokens = (text: string): number[] => Array.from(text.matchAll(/(?:[$€£]\s*)?\(?\s*\d{1,6}(?:[,.]\d{3})*(?:[,.]\d{2})\s*\)?/g))
  .map((match) => numeric(match[0]))
  .filter((value): value is number => value !== null);

const fieldCorrect = (field: ReceiptFrontendField, predicted: string | null, expected: string | null): boolean => {
  if (!predicted || !expected) return false;
  if (field === "vendor") {
    const a = normalizeText(predicted);
    const b = normalizeText(expected);
    return a.includes(b) || b.includes(a);
  }
  if (field === "purchase_date") return predicted === expected;
  const a = numeric(predicted);
  const b = numeric(expected);
  return a !== null && b !== null && Math.abs(a - b) < 0.005;
};

const rawExpectedHit = (field: ReceiptFrontendField, text: string, expected: string | null): boolean => {
  if (!expected) return false;
  if (field === "vendor") return normalizeText(text).includes(normalizeText(expected));
  if (field === "purchase_date") {
    const normalized = normalizeDigits(text);
    const iso = expected.match(/^(20\d{2})-(\d{1,2})-(\d{1,2})$/);
    if (!iso) return false;
    const [year, month, day] = [iso[1], iso[2].padStart(2, "0"), iso[3].padStart(2, "0")];
    return [year + month + day, day + month + year, month + day + year]
      .some((digits) => digits.length >= 6 && normalized.includes(digits));
  }
  const expectedAmount = numeric(expected);
  return expectedAmount !== null && amountTokens(text).some((value) => Math.abs(value - expectedAmount) < 0.005);
};

const parseCsvBox = (line: string): { text: string; bbox: ReceiptOcrLine["bbox"] } | null => {
  const parts = line.split(",");
  if (parts.length < 9) return null;
  const values = parts.slice(0, 8).map(Number);
  if (values.some((value) => !Number.isFinite(value))) return null;
  return {
    text: parts.slice(8).join(",").trim(),
    bbox: {
      x0: Math.min(values[0], values[2], values[4], values[6]),
      y0: Math.min(values[1], values[3], values[5], values[7]),
      x1: Math.max(values[0], values[2], values[4], values[6]),
      y1: Math.max(values[1], values[3], values[5], values[7]),
    },
  };
};

const levenshtein = (left: string, right: string): number => {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
    const current = [leftIndex + 1];
    for (let rightIndex = 0; rightIndex < right.length; rightIndex += 1) {
      current.push(Math.min(
        current[rightIndex] + 1,
        previous[rightIndex + 1] + 1,
        previous[rightIndex] + (left[leftIndex] === right[rightIndex] ? 0 : 1),
      ));
    }
    for (let index = 0; index < current.length; index += 1) previous[index] = current[index];
  }
  return previous[right.length];
};

const textSimilarity = (left: string, right: string): number => {
  const a = normalizeText(left);
  const b = normalizeText(right);
  if (!a || !b) return 0;
  if (a.includes(b) || b.includes(a)) return 1;
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
};

const boxIoU = (left: ReceiptOcrLine["bbox"], right: ReceiptOcrLine["bbox"]): number => {
  if (!left || !right) return 0;
  const x0 = Math.max(left.x0, right.x0);
  const y0 = Math.max(left.y0, right.y0);
  const x1 = Math.min(left.x1, right.x1);
  const y1 = Math.min(left.y1, right.y1);
  const intersection = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  const leftArea = Math.max(0, left.x1 - left.x0) * Math.max(0, left.y1 - left.y0);
  const rightArea = Math.max(0, right.x1 - right.x0) * Math.max(0, right.y1 - right.y0);
  return intersection / Math.max(1, leftArea + rightArea - intersection);
};

const lineQuality = async (id: string, predicted: ReceiptOcrLine[]) => {
  const raw = await readFile(path.join(root, "benchmarks/sroie500/ocr", `${id}.csv`), "utf8");
  const expected = raw.split(/\r?\n/).map(parseCsvBox).filter((item): item is NonNullable<typeof item> => Boolean(item));
  const used = new Set<number>();
  let matched = 0;
  let withBoxes = 0;
  let iou = 0;
  for (const target of expected) {
    let bestIndex = -1;
    let bestSimilarity = 0;
    predicted.forEach((candidate, index) => {
      if (used.has(index)) return;
      const similarity = textSimilarity(target.text, candidate.text);
      if (similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestIndex = index;
      }
    });
    if (bestIndex < 0 || bestSimilarity < 0.62) continue;
    used.add(bestIndex);
    matched += 1;
    if (predicted[bestIndex].bbox) {
      withBoxes += 1;
      iou += boxIoU(predicted[bestIndex].bbox, target.bbox);
    }
  }
  return {
    expected: expected.length,
    predicted: predicted.length,
    matched,
    withBoxes,
    recall: matched / Math.max(1, expected.length),
    precision: matched / Math.max(1, predicted.length),
    meanIoU: withBoxes ? iou / withBoxes : 0,
    boxPresence: predicted.length ? withBoxes / predicted.length : 0,
  };
};

const splitRows = (rows: ModernRow[], subset: string): ModernRow[] => (
  subset === "all" ? rows : rows.filter((row) => splitFor(row.id) === subset)
);

const fileExists = async (filePath: string): Promise<boolean> => access(filePath).then(() => true).catch(() => false);

const emptyFieldMetric = () => ({ expected: 0, trusted: 0, evaluated: 0, correct: 0, rawHits: 0, confidence: 0 });

const percentile = (values: number[], fraction: number): number | null => {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
};

const scoreEngine = async (name: string, rows: ModernRow[], dataset: "sroie" | "production", subset: string) => {
  const selectedRows = splitRows(rows, subset);
  const metrics = Object.fromEntries(fields.map((field) => [field, emptyFieldMetric()])) as Record<ReceiptFrontendField, ReturnType<typeof emptyFieldMetric>>;
  const lineTotals = { expected: 0, predicted: 0, matched: 0, withBoxes: 0, recall: 0, precision: 0, meanIoU: 0, boxPresence: 0 };
  const runtimes = selectedRows.map((row) => row.durationMs || 0).filter((value) => value > 0);
  let unresolved = 0;
  let receiptsWithUnresolved = 0;
  let ocrErrors = 0;
  let walmart = 0;
  let walmartUnresolved = 0;
  let trustedSlots = 0;
  let knownExpected = 0;
  let knownCorrect = 0;
  for (const row of selectedRows) {
    const unresolvedFields = row.unresolvedFields ?? fields.filter((field) => row.fields[field]?.status !== "trusted");
    unresolved += unresolvedFields.length;
    if (unresolvedFields.length) receiptsWithUnresolved += 1;
    if (row.ocrError) ocrErrors += 1;
    trustedSlots += fields.filter((field) => row.fields[field]?.status === "trusted").length;
    if (row.category === "walmart") {
      walmart += 1;
      if (unresolvedFields.length) walmartUnresolved += 1;
    }
    if (dataset !== "sroie") continue;
    const label = JSON.parse(await readFile(path.join(root, "benchmarks/sroie500/labels", `${row.id}.json`), "utf8")) as { company?: string; date?: string; total?: string };
    const expected: Partial<Record<ReceiptFrontendField, string | null>> = {
      vendor: label.company ?? null,
      purchase_date: expectedDate(label.date),
      total: label.total ?? null,
    };
    const line = await lineQuality(row.id, row.lines ?? []);
    (Object.keys(lineTotals) as Array<keyof typeof lineTotals>).forEach((key) => { lineTotals[key] += line[key]; });
    fields.forEach((field) => {
      const metric = metrics[field];
      if (expected[field]) metric.expected += 1;
      if (rawExpectedHit(field, row.text ?? "", expected[field] ?? null)) metric.rawHits += 1;
      const item = row.fields[field];
      if (item?.status !== "trusted") return;
      metric.trusted += 1;
      metric.confidence += item.confidence;
      if (!expected[field]) return;
      metric.evaluated += 1;
      if (fieldCorrect(field, item.value, expected[field] ?? null)) metric.correct += 1;
      knownExpected += 1;
      if (fieldCorrect(field, item.value, expected[field] ?? null)) knownCorrect += 1;
    });
  }
  const summarize = (metric: ReturnType<typeof emptyFieldMetric>) => ({
    expected: metric.expected,
    trusted: metric.trusted,
    precision: metric.evaluated ? metric.correct / metric.evaluated : null,
    recall: metric.expected ? metric.correct / metric.expected : null,
    coverage: metric.trusted / Math.max(1, selectedRows.length),
    rawExactHitRate: metric.expected ? metric.rawHits / metric.expected : null,
    meanTrustedConfidence: metric.trusted ? metric.confidence / metric.trusted : null,
    unsafeTrusted: Math.max(0, metric.evaluated - metric.correct),
  });
  return {
    engine: name,
    dataset,
    subset,
    sampleSize: selectedRows.length,
    runtimeMs: {
      mean: runtimes.length ? runtimes.reduce((sum, value) => sum + value, 0) / runtimes.length : null,
      median: percentile(runtimes, 0.5),
      p95: percentile(runtimes, 0.95),
    },
    cropEquivalentTrustedFieldRate: trustedSlots / Math.max(1, selectedRows.length * fields.length),
    trustedSlots,
    receiptFallbackRate: receiptsWithUnresolved / Math.max(1, selectedRows.length),
    meanUnresolvedFields: unresolved / Math.max(1, selectedRows.length),
    ocrErrorRate: ocrErrors / Math.max(1, selectedRows.length),
    fields: Object.fromEntries(fields.map((field) => [field, summarize(metrics[field])])),
    exact: {
      store: summarize(metrics.vendor).rawExactHitRate,
      date: summarize(metrics.purchase_date).rawExactHitRate,
      total: summarize(metrics.total).rawExactHitRate,
      amount: summarize(metrics.total).rawExactHitRate,
      trustedKnownPrecision: knownExpected ? knownCorrect / (knownCorrect + Math.max(0, knownExpected - knownCorrect)) : null,
    },
    lineQuality: dataset === "sroie" ? {
      textRecall: lineTotals.recall / Math.max(1, selectedRows.length),
      textPrecision: lineTotals.precision / Math.max(1, selectedRows.length),
      meanMatchedBoxIoU: lineTotals.meanIoU / Math.max(1, selectedRows.length),
      boxPresence: lineTotals.boxPresence / Math.max(1, selectedRows.length),
      meanExpectedLines: lineTotals.expected / Math.max(1, selectedRows.length),
      meanPredictedLines: lineTotals.predicted / Math.max(1, selectedRows.length),
      wordBoxPresence: selectedRows.reduce((sum, row) => sum + row.wordCount, 0) / Math.max(1, selectedRows.reduce((sum, row) => sum + row.lineCount, 0)),
    } : null,
    production: dataset === "production" ? {
      walmartReceipts: walmart,
      walmartFallbackRate: walmart ? walmartUnresolved / walmart : null,
      otherFallbackRate: selectedRows.length - walmart ? (receiptsWithUnresolved - walmartUnresolved) / (selectedRows.length - walmart) : null,
    } : null,
  };
};

describe("modern OCR benchmark scorer", () => {
  it("scores modern engines against SROIE without changing the extractor", async () => {
    const inputPath = process.env.RECEIPT_MODERN_OCR_SCORE_INPUT ?? path.join(root, "benchmarks/receipt-modern-ocr-sroie-validation.json");
    if (!await fileExists(inputPath)) return;
    const benchmark = JSON.parse(await readFile(inputPath, "utf8")) as ModernBenchmark;
    expect(benchmark.dataset).toBe("sroie");
    const output: Record<string, unknown> = {
      dataset: benchmark.dataset,
      subset: benchmark.subset,
      variant: benchmark.variant ?? "default",
      sampleSize: benchmark.sampleSize,
      engines: {},
    };
    for (const [name, engine] of Object.entries(benchmark.engines)) {
      const spec = {
        ...engine.spec,
        runtimeBytes: engine.spec.runtimeBytes || RECEIPT_MODERN_OCR_SHARED_RUNTIME_BYTES,
      };
      output.engines[name] = {
        spec,
        initializationMs: engine.initializationMs,
        firstInferenceMs: engine.firstInferenceMs,
        cachedInferenceMs: engine.inferenceTimes.length > 1
          ? engine.inferenceTimes.slice(1).reduce((sum, value) => sum + value, 0) / (engine.inferenceTimes.length - 1)
          : null,
        heapAfterInitialization: engine.heapAfterInitialization ?? null,
        initializationError: engine.initializationError ?? null,
        metrics: await scoreEngine(name, engine.rows, benchmark.dataset, benchmark.subset),
      };
    }
    const outputPath = process.env.RECEIPT_MODERN_OCR_SCORE_OUTPUT ?? path.join(root, "benchmarks/receipt-modern-ocr-results.json");
    await writeFile(outputPath, JSON.stringify(output, null, 2));
    console.log(JSON.stringify(output, null, 2));
  });

  it("scores the production corpus descriptively without storing OCR text", async () => {
    const inputPath = process.env.RECEIPT_MODERN_OCR_PRODUCTION_INPUT ?? path.join(root, "benchmarks/receipt-modern-ocr-production.json");
    if (!await fileExists(inputPath)) return;
    const benchmark = JSON.parse(await readFile(inputPath, "utf8")) as ModernBenchmark;
    expect(benchmark.dataset).toBe("production");
    const output: Record<string, unknown> = { dataset: benchmark.dataset, subset: benchmark.subset, variant: benchmark.variant ?? "default", sampleSize: benchmark.sampleSize, engines: {} };
    for (const [name, engine] of Object.entries(benchmark.engines)) {
      expect(engine.rows.every((row) => !row.text && !row.lines)).toBe(true);
      expect(engine.rows.every((row) => Object.values(row.fields as Record<string, ProductionFieldRecord>)
        .every((field) => field.value === undefined && field.evidence === undefined))).toBe(true);
      output.engines[name] = {
        spec: {
          ...engine.spec,
          runtimeBytes: engine.spec.runtimeBytes || RECEIPT_MODERN_OCR_SHARED_RUNTIME_BYTES,
        },
        initializationMs: engine.initializationMs,
        firstInferenceMs: engine.firstInferenceMs,
        cachedInferenceMs: engine.inferenceTimes.length > 1
          ? engine.inferenceTimes.slice(1).reduce((sum, value) => sum + value, 0) / (engine.inferenceTimes.length - 1)
          : null,
        heapAfterInitialization: engine.heapAfterInitialization ?? null,
        initializationError: engine.initializationError ?? null,
        metrics: await scoreEngine(name, engine.rows, benchmark.dataset, benchmark.subset),
      };
    }
    const outputPath = process.env.RECEIPT_MODERN_OCR_PRODUCTION_SCORE_OUTPUT ?? path.join(root, "benchmarks/receipt-modern-ocr-production-results.json");
    await writeFile(outputPath, JSON.stringify(output, null, 2));
    console.log(JSON.stringify(output, null, 2));
  });
});
