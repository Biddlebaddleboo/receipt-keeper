import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { extractReceiptFieldsFromOcrLines, type ReceiptFrontendField, type ReceiptFrontendFields, type ReceiptOcrLine } from "@/lib/receiptFrontendExtractor";

const root = process.cwd();
const fields: ReceiptFrontendField[] = ["vendor", "purchase_date", "subtotal", "tax", "total"];
type StrategyName = "rules" | "ml" | "combined";

interface OcrRow {
  id: string;
  durationMs: number;
  lineCount: number;
  wordCount: number;
  meanConfidence: number;
  text?: string;
  lines?: ReceiptOcrLine[];
  fields: ReceiptFrontendFields;
  mlFields?: ReceiptFrontendFields;
  combinedFields?: ReceiptFrontendFields;
  ocrError?: boolean;
  reference?: { vendor?: string | null; purchase_date?: string | null };
}

interface BenchmarkFile {
  dataset: "sroie" | "production";
  subset: string;
  sampleSize: number;
  strategies: Record<string, OcrRow[]>;
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

const parseCsvBox = (line: string): { text: string; bbox: { x0: number; y0: number; x1: number; y1: number } } | null => {
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
  const intersectionLeft = Math.max(left.x0, right.x0);
  const intersectionTop = Math.max(left.y0, right.y0);
  const intersectionRight = Math.min(left.x1, right.x1);
  const intersectionBottom = Math.min(left.y1, right.y1);
  const intersection = Math.max(0, intersectionRight - intersectionLeft) * Math.max(0, intersectionBottom - intersectionTop);
  const leftArea = Math.max(0, left.x1 - left.x0) * Math.max(0, left.y1 - left.y0);
  const rightArea = Math.max(0, right.x1 - right.x0) * Math.max(0, right.y1 - right.y0);
  return intersection / Math.max(1, leftArea + rightArea - intersection);
};

const lineMetrics = async (id: string, predicted: ReceiptOcrLine[]) => {
  const raw = await readFile(path.join(root, "benchmarks/sroie500/ocr", `${id}.csv`), "utf8");
  const expected = raw.split(/\r?\n/).map(parseCsvBox).filter((item): item is NonNullable<typeof item> => Boolean(item));
  const used = new Set<number>();
  let matched = 0;
  let bboxMatched = 0;
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
      bboxMatched += 1;
      iou += boxIoU(predicted[bestIndex].bbox, target.bbox);
    }
  }
  return {
    expectedLines: expected.length,
    predictedLines: predicted.length,
    matchedLines: matched,
    linesWithBoxes: bboxMatched,
    lineRecall: matched / Math.max(1, expected.length),
    linePrecision: matched / Math.max(1, predicted.length),
    meanMatchedBoxIoU: bboxMatched ? iou / bboxMatched : 0,
    boxPresence: predicted.length ? bboxMatched / predicted.length : 0,
  };
};

const numeric = (value: string): number | null => {
  const cleaned = value.replace(/[$€£\s]/g, "").replace(/,/g, "");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
};

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

const amountTokens = (text: string): number[] => Array.from(text.matchAll(/(?:[$€£]\s*)?\(?\s*\d{1,6}(?:[,.]\d{3})*(?:[,.]\d{2})\s*\)?/g))
  .map((match) => numeric(match[0]))
  .filter((value): value is number => value !== null);

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

const emptyFieldMetric = () => ({ trusted: 0, expected: 0, evaluated: 0, correct: 0, rawHits: 0, confidence: 0 });

const metricSummary = (metric: ReturnType<typeof emptyFieldMetric>, sampleSize: number) => ({
  trusted: metric.trusted,
  precision: metric.evaluated ? metric.correct / metric.evaluated : null,
  recall: metric.expected ? metric.correct / metric.expected : null,
  coverage: metric.trusted / Math.max(1, sampleSize),
  abstention: 1 - metric.trusted / Math.max(1, sampleSize),
  rawTextHitRate: metric.expected ? metric.rawHits / metric.expected : null,
  meanConfidence: metric.trusted ? metric.confidence / metric.trusted : null,
});

const fieldsForStrategy = (row: OcrRow, strategy: StrategyName): ReceiptFrontendFields => {
  if (strategy === "ml") return row.mlFields ?? row.fields;
  if (strategy === "combined") return row.combinedFields ?? row.fields;
  return row.fields;
};

describe("receipt OCR benchmark scorer", () => {
  it("scores each OCR strategy without persisting OCR text in the report", async () => {
    const inputPath = process.env.RECEIPT_OCR_SCORE_INPUT ?? path.join(root, "benchmarks/receipt-frontend-ocr-sroie-all.json");
    const benchmark = JSON.parse(await readFile(inputPath, "utf8")) as BenchmarkFile;
    const strategyNames = Object.keys(benchmark.strategies);
    const result: Record<string, unknown> = {
      dataset: benchmark.dataset,
      subset: benchmark.subset,
      sampleSize: benchmark.sampleSize,
      strategies: {},
    };

    for (const strategy of strategyNames) {
      const rows = benchmark.strategies[strategy];
      const fieldsByMode: Record<StrategyName, Record<ReceiptFrontendField, ReturnType<typeof emptyFieldMetric>>> = Object.fromEntries(
        (["rules", "ml", "combined"] as StrategyName[]).map((mode) => [mode, Object.fromEntries(fields.map((field) => [field, emptyFieldMetric()]))]),
      ) as typeof fieldsByMode;
      const lineTotals = { expectedLines: 0, predictedLines: 0, matchedLines: 0, linesWithBoxes: 0, lineRecall: 0, linePrecision: 0, meanMatchedBoxIoU: 0, boxPresence: 0 };
      let runtime = 0;
      const runtimes: number[] = [];
      let receiptsWithUnresolved = 0;
      let ocrErrors = 0;

      for (const row of rows) {
        runtime += row.durationMs || 0;
        runtimes.push(row.durationMs || 0);
        if ((row.unresolvedFields ?? []).length) receiptsWithUnresolved += 1;
        if (row.ocrError) ocrErrors += 1;
        if (benchmark.dataset === "sroie") {
          const label = JSON.parse(await readFile(path.join(root, "benchmarks/sroie500/labels", `${row.id}.json`), "utf8")) as { company?: string; date?: string; total?: string };
          const expected: Partial<Record<ReceiptFrontendField, string | null>> = {
            vendor: label.company ?? null,
            purchase_date: expectedDate(label.date),
            total: label.total ?? null,
          };
          const lines = row.lines ?? [];
          const line = await lineMetrics(row.id, lines);
          (Object.keys(lineTotals) as Array<keyof typeof lineTotals>).forEach((key) => { lineTotals[key] += line[key]; });
          (Object.keys(fieldsByMode) as StrategyName[]).forEach((mode) => fields.forEach((field) => {
            const metric = fieldsByMode[mode][field];
            if (expected[field]) metric.expected += 1;
            if (rawExpectedHit(field, row.text ?? "", expected[field] ?? null)) metric.rawHits += 1;
            const item = fieldsForStrategy(row, mode)[field];
            if (item.status !== "trusted") return;
            metric.trusted += 1;
            metric.confidence += item.confidence;
            if (!expected[field]) return;
            metric.evaluated += 1;
            if (fieldCorrect(field, item.value, expected[field] ?? null)) metric.correct += 1;
          }));
        } else {
          // Production metadata is application reference metadata, not an
          // independent image annotation. It is reported as descriptive only.
          (Object.keys(fieldsByMode) as StrategyName[]).forEach((mode) => fields.forEach((field) => {
            const item = fieldsForStrategy(row, mode)[field];
            if (item.status === "trusted") {
              fieldsByMode[mode][field].trusted += 1;
              fieldsByMode[mode][field].confidence += item.confidence;
            }
            if (field === "vendor" && row.reference?.vendor) {
              fieldsByMode[mode][field].expected += 1;
              if (item.status === "trusted") {
                fieldsByMode[mode][field].evaluated += 1;
                if (fieldCorrect(field, item.value, row.reference.vendor)) fieldsByMode[mode][field].correct += 1;
              }
            }
            if (field === "purchase_date" && row.reference?.purchase_date) {
              fieldsByMode[mode][field].expected += 1;
              if (item.status === "trusted") {
                fieldsByMode[mode][field].evaluated += 1;
                if (fieldCorrect(field, item.value, expectedDate(row.reference.purchase_date))) fieldsByMode[mode][field].correct += 1;
              }
            }
          }));
        }
      }

      const sortedRuntimes = runtimes.sort((left, right) => left - right);
      const percentile = (ratio: number) => sortedRuntimes[Math.min(sortedRuntimes.length - 1, Math.floor(sortedRuntimes.length * ratio))] ?? 0;
      const strategyResult = {
        runtimeMs: {
          mean: runtime / Math.max(1, rows.length),
          median: percentile(0.5),
          p95: percentile(0.95),
        },
        receiptFallbackRate: receiptsWithUnresolved / Math.max(1, rows.length),
        ocrErrorRate: ocrErrors / Math.max(1, rows.length),
        fields: Object.fromEntries(Object.entries(fieldsByMode).map(([mode, modeFields]) => [
          mode,
          Object.fromEntries(fields.map((field) => [field, metricSummary(modeFields[field], rows.length)])),
        ])),
        lineQuality: benchmark.dataset === "sroie" ? {
          textRecall: lineTotals.matchedLines / Math.max(1, lineTotals.expectedLines),
          textPrecision: lineTotals.matchedLines / Math.max(1, lineTotals.predictedLines),
          meanMatchedBoxIoU: lineTotals.meanMatchedBoxIoU / Math.max(1, rows.length),
          boxPresence: lineTotals.linesWithBoxes / Math.max(1, lineTotals.predictedLines),
          meanExpectedLines: lineTotals.expectedLines / Math.max(1, rows.length),
          meanPredictedLines: lineTotals.predictedLines / Math.max(1, rows.length),
        } : null,
        productionReferenceMetadata: benchmark.dataset === "production" ? "vendor/date values from application metadata; not independent image ground truth" : null,
      };
      (result.strategies as Record<string, unknown>)[strategy] = strategyResult;
    }
    const outputPath = process.env.RECEIPT_OCR_SCORE_OUTPUT ?? path.join(root, "benchmarks/receipt-frontend-ocr-results.json");
    await writeFile(outputPath, JSON.stringify(result, null, 2));
    expect(Object.values(benchmark.strategies).every((rows) => rows.length === benchmark.sampleSize)).toBe(true);
  }, 180_000);
});
