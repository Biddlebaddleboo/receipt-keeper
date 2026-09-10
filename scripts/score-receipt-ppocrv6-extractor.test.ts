import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  extractReceiptFieldsFromOcrLines,
  type ReceiptFrontendField,
  type ReceiptFrontendFields,
} from "@/lib/receiptFrontendExtractor";
import { extractReceiptFieldsFromPpocrV6Lines } from "@/lib/receiptPpocrV6Extractor";
import type { ReceiptOcrLine } from "@/lib/receiptOcr";

const root = process.cwd();
const fields: ReceiptFrontendField[] = ["vendor", "purchase_date", "subtotal", "tax", "total"];
const knownFields: ReceiptFrontendField[] = ["vendor", "purchase_date", "total"];
const duplicateGroup = new Map([[12, 12], [15, 12], [16, 12], [18, 12], [277, 277], [452, 277]]);

const splitFor = (id: string): "tuning" | "validation" | "final" => {
  const representative = duplicateGroup.get(Number(id)) ?? Number(id);
  return representative < 300 ? "tuning" : representative < 400 ? "validation" : "final";
};

interface BenchmarkRow {
  id: string;
  durationMs?: number;
  text?: string;
  lines?: ReceiptOcrLine[];
  fields: ReceiptFrontendFields;
  unresolvedFields?: ReceiptFrontendField[];
  category?: string;
  ocrError?: boolean;
}

interface ModernInput {
  dataset: "sroie" | "production";
  sampleSize: number;
  engines: Record<string, { rows: BenchmarkRow[] }>;
}

interface TesseractInput {
  strategies: Record<string, BenchmarkRow[]>;
}

const exists = async (filePath: string): Promise<boolean> => stat(filePath).then(() => true).catch(() => false);

const normalizeText = (value: string): string => value.toUpperCase().replace(/[^A-Z0-9]/g, "");
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
  const cleaned = value.replace(/[A-Za-z$€£\s()]/g, "").replace(/,/g, "");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
};

const fieldCorrect = (field: ReceiptFrontendField, predicted: string | null, expected: string | null): boolean => {
  if (!predicted || !expected) return false;
  if (field === "vendor") {
    const actual = normalizeText(predicted);
    const target = normalizeText(expected);
    return actual.includes(target) || target.includes(actual);
  }
  if (field === "purchase_date") return predicted === expected;
  const actual = numeric(predicted);
  const target = numeric(expected);
  return actual !== null && target !== null && Math.abs(actual - target) < 0.005;
};

const expectedFor = async (id: string): Promise<Partial<Record<ReceiptFrontendField, string | null>>> => {
  const label = JSON.parse(await readFile(path.join(root, "benchmarks/sroie500/labels", `${id}.json`), "utf8")) as { company?: string; date?: string; total?: string };
  return { vendor: label.company ?? null, purchase_date: expectedDate(label.date), total: label.total ?? null };
};

const fieldMode = (row: BenchmarkRow, mode: "rules" | "adapted"): ReceiptFrontendFields => {
  if (mode === "rules") return row.fields;
  return extractReceiptFieldsFromPpocrV6Lines(row.lines ?? [], row.text).fields;
};

const emptyMetric = () => ({ expected: 0, trusted: 0, correct: 0, wrongTrusted: 0, confidence: 0 });

const summarizeMetric = (metric: ReturnType<typeof emptyMetric>, sampleSize: number) => ({
  expected: metric.expected,
  trusted: metric.trusted,
  trustedCoverage: metric.trusted / Math.max(1, sampleSize),
  abstentionRate: 1 - metric.trusted / Math.max(1, sampleSize),
  precision: metric.trusted ? metric.correct / Math.max(1, metric.correct + metric.wrongTrusted) : null,
  recall: metric.expected ? metric.correct / metric.expected : null,
  correctTrusted: metric.correct,
  wrongTrusted: metric.wrongTrusted,
  meanTrustedConfidence: metric.trusted ? metric.confidence / metric.trusted : null,
});

const scoreSroie = async (rows: BenchmarkRow[], mode: "rules" | "adapted", subset: string) => {
  const selected = subset === "all" ? rows : rows.filter((row) => splitFor(row.id) === subset);
  const metrics = Object.fromEntries(fields.map((field) => [field, emptyMetric()])) as Record<ReceiptFrontendField, ReturnType<typeof emptyMetric>>;
  let unresolved = 0;
  let fallbackReceipts = 0;
  let trustedSlots = 0;
  const selectorTimes: number[] = [];
  const ocrTimes = selected.map((row) => row.durationMs ?? 0).filter((value) => value > 0);
  const fixed: string[] = [];
  const worse: string[] = [];
  for (const row of selected) {
    const before = performance.now();
    const selectedFields = fieldMode(row, mode);
    selectorTimes.push(performance.now() - before);
    const selectedUnresolved = fields.filter((field) => selectedFields[field].status !== "trusted");
    unresolved += selectedUnresolved.length;
    if (selectedUnresolved.length) fallbackReceipts += 1;
    trustedSlots += fields.filter((field) => selectedFields[field].status === "trusted").length;
    const expected = await expectedFor(row.id);
    fields.forEach((field) => {
      const metric = metrics[field];
      if (expected[field]) metric.expected += 1;
      const item = selectedFields[field];
      if (item.status !== "trusted") return;
      metric.trusted += 1;
      metric.confidence += item.confidence;
      if (!expected[field]) return;
      if (fieldCorrect(field, item.value, expected[field] ?? null)) metric.correct += 1;
      else metric.wrongTrusted += 1;
    });
    if (mode === "adapted") {
      const old = fieldMode(row, "rules");
      knownFields.forEach((field) => {
        const oldCorrect = old[field].status === "trusted" && fieldCorrect(field, old[field].value, expected[field] ?? null);
        const newCorrect = selectedFields[field].status === "trusted" && fieldCorrect(field, selectedFields[field].value, expected[field] ?? null);
        if (!oldCorrect && newCorrect) fixed.push(`${row.id}:${field}`);
        if (oldCorrect && !newCorrect) worse.push(`${row.id}:${field}`);
      });
    }
  }
  return {
    subset,
    sampleSize: selected.length,
    trustedSlots,
    trustedFieldRate: trustedSlots / Math.max(1, selected.length * fields.length),
    meanUnresolvedFields: unresolved / Math.max(1, selected.length),
    receiptFallbackRate: fallbackReceipts / Math.max(1, selected.length),
    ocrRuntimeMs: {
      mean: ocrTimes.reduce((sum, value) => sum + value, 0) / Math.max(1, ocrTimes.length),
      p95: [...ocrTimes].sort((a, b) => a - b)[Math.min(ocrTimes.length - 1, Math.floor(ocrTimes.length * 0.95))] ?? 0,
    },
    selectorRuntimeMs: {
      mean: selectorTimes.reduce((sum, value) => sum + value, 0) / Math.max(1, selectorTimes.length),
      p95: [...selectorTimes].sort((a, b) => a - b)[Math.min(selectorTimes.length - 1, Math.floor(selectorTimes.length * 0.95))] ?? 0,
    },
    fields: Object.fromEntries(fields.map((field) => [field, summarizeMetric(metrics[field], selected.length)])),
    examples: mode === "adapted" ? { fixed: fixed.slice(0, 40), worse: worse.slice(0, 40), fixedCount: fixed.length, worseCount: worse.length } : undefined,
  };
};

const scoreProduction = (rows: BenchmarkRow[], subset: string) => {
  const selected = subset === "all" ? rows : rows.filter((row) => row.category === subset);
  const result = {
    sampleSize: selected.length,
    trustedSlots: 0,
    trustedFieldCounts: Object.fromEntries(fields.map((field) => [field, 0])) as Record<ReceiptFrontendField, number>,
    fallbackReceipts: 0,
    meanUnresolvedFields: 0,
  };
  selected.forEach((row) => {
    const unresolved = row.unresolvedFields ?? fields.filter((field) => row.fields[field].status !== "trusted");
    result.meanUnresolvedFields += unresolved.length;
    if (unresolved.length) result.fallbackReceipts += 1;
    fields.forEach((field) => {
      if (row.fields[field].status === "trusted") {
        result.trustedSlots += 1;
        result.trustedFieldCounts[field] += 1;
      }
    });
  });
  return {
    ...result,
    trustedFieldRate: result.trustedSlots / Math.max(1, selected.length * fields.length),
    receiptFallbackRate: result.fallbackReceipts / Math.max(1, selected.length),
    meanUnresolvedFields: result.meanUnresolvedFields / Math.max(1, selected.length),
    ocrRuntimeMs: {
      mean: selected.reduce((sum, row) => sum + (row.durationMs ?? 0), 0) / Math.max(1, selected.length),
    },
  };
};

type SroieScore = Awaited<ReturnType<typeof scoreSroie>>;
type ProductionScore = ReturnType<typeof scoreProduction>;
type ModelGate = { precision?: number; coverage?: number; threshold?: number; margin?: number };
type TrainingComparison = Record<string, { logistic_validation?: ModelGate; stump_forest_validation?: ModelGate }>;
type ProductionResults = Record<"ppocrv6-old-rules" | "ppocrv6-adapted", Record<"all" | "walmart" | "other", ProductionScore>>;
type BenchmarkReport = {
  dataset: string;
  sampleSize: number;
  splits: Record<string, Record<string, SroieScore>>;
  model: { bytes: number; browserInference: string; gates: Record<string, unknown>; trainingComparison: TrainingComparison | null };
  production?: ProductionResults | { note: string };
};

const markdownPercent = (value: number | null | undefined): string => value == null ? "n/a" : `${(value * 100).toFixed(1)}%`;
const markdownMetricTable = (result: SroieScore): string => {
  const rows = fields.map((field) => {
    const metric = result.fields[field];
    return `| ${field} | ${metric.trusted} | ${markdownPercent(metric.precision)} | ${markdownPercent(metric.recall)} | ${markdownPercent(metric.trustedCoverage)} | ${metric.wrongTrusted} |`;
  });
  return [
    "| field | trusted | precision | recall | trusted coverage | wrong trusted |",
    "|---|---:|---:|---:|---:|---:|",
    ...rows,
  ].join("\n");
};

const modelComparisonTable = (comparison: TrainingComparison | null): string => {
  if (!comparison) return "Model training metadata unavailable.";
  return [
    "| field | logistic validation precision / coverage | stump-forest validation precision / coverage |",
    "|---|---:|---:|",
    ...fields.map((field) => {
      const item = comparison[field] ?? {};
      const logistic = item.logistic_validation ?? {};
      const forest = item.stump_forest_validation ?? {};
      return `| ${field} | ${markdownPercent(logistic.precision)} / ${markdownPercent(logistic.coverage)} | ${markdownPercent(forest.precision)} / ${markdownPercent(forest.coverage)} |`;
    }),
  ].join("\n");
};

describe("PP-OCRv6 adapted field extractor benchmark", () => {
  it("compares rules and the adapted model on tuning, validation, and untouched final data", async () => {
    const modernPath = path.join(root, "benchmarks/receipt-modern-ocr-sroie-all-v6.json");
    if (!await exists(modernPath)) return;
    const modern = JSON.parse(await readFile(modernPath, "utf8")) as ModernInput;
    const v6Rows = modern.engines["paddleocr-js-ppocrv6-tiny"].rows;
    const tesseractPath = path.join(root, "benchmarks/receipt-frontend-ocr-sroie-all-sharpen.json");
    const tesseract = JSON.parse(await readFile(tesseractPath, "utf8")) as TesseractInput;
    const tesseractRows = tesseract.strategies[Object.keys(tesseract.strategies)[0]];
    const results: BenchmarkReport = { dataset: "sroie", sampleSize: v6Rows.length, splits: {}, model: { bytes: 0, browserInference: "", gates: {}, trainingComparison: null } };
    for (const subset of ["tuning", "validation", "final", "all"]) {
      const rules = await scoreSroie(v6Rows, "rules", subset);
      const adapted = await scoreSroie(v6Rows, "adapted", subset);
      const tesseractResult = await scoreSroie(tesseractRows, "rules", subset);
      results.splits[subset] = { "tesseract-rules": tesseractResult, "ppocrv6-old-rules": rules, "ppocrv6-adapted": adapted };
    }
    const modelSize = await stat(path.join(root, "src/lib/receiptPpocrV6FieldModel.json"));
    const modelArtifact = JSON.parse(await readFile(path.join(root, "src/lib/receiptPpocrV6FieldModel.json"), "utf8")) as { training_comparison?: TrainingComparison; fields?: Record<string, unknown> };
    results.model = {
      bytes: modelSize.size,
      browserInference: "five independent logistic dot products; no runtime dependency",
      gates: modelArtifact.fields ?? {},
      trainingComparison: modelArtifact.training_comparison ?? null,
    };

    const productionOldPath = path.join(root, "benchmarks/receipt-modern-ocr-production-v6.json");
    const productionAdaptedPath = path.join(root, "benchmarks/receipt-modern-ocr-production-v6-adapted.json");
    if (await exists(productionOldPath) && await exists(productionAdaptedPath)) {
      const productionOld = JSON.parse(await readFile(productionOldPath, "utf8")) as ModernInput;
      const productionAdapted = JSON.parse(await readFile(productionAdaptedPath, "utf8")) as ModernInput;
      const oldRows = productionOld.engines["paddleocr-js-ppocrv6-tiny"].rows;
      const adaptedRows = productionAdapted.engines["paddleocr-js-ppocrv6-tiny"].rows;
      results.production = {
        "ppocrv6-old-rules": { all: scoreProduction(oldRows, "all"), walmart: scoreProduction(oldRows, "walmart"), other: scoreProduction(oldRows, "other") },
        "ppocrv6-adapted": { all: scoreProduction(adaptedRows, "all"), walmart: scoreProduction(adaptedRows, "walmart"), other: scoreProduction(adaptedRows, "other") },
      };
    } else {
      results.production = { note: "Run the read-only production PP-OCRv6 replay before publishing production counts." };
    }

    const validation = results.splits.validation;
    const final = results.splits.final;
    const report = [
      "# PP-OCRv6 adapted receipt field extractor benchmark",
      "",
      "The PP-OCRv6 path is experimental. It uses the public SROIE labels and cached PP-OCRv6 line geometry; no receipt image or OCR text is written to this report.",
      "",
      "## Method",
      "",
      "- Tuning: 301 SROIE IDs (duplicate groups kept together) for logistic coefficients.",
      "- Validation: 100 receipt IDs for model/gate selection; no final IDs used for tuning.",
      "- Final: 99 untouched receipt IDs, evaluated after the configuration was frozen.",
      "- Models compared: independent logistic regressions and tiny stump forests offline; the browser artifact is logistic only.",
      "- Subtotal/tax have no SROIE key labels, so their precision/recall is reported as n/a rather than treated as correct.",
      "",
      "## Validation",
      "",
      "### Current Tesseract + rules",
      "",
      markdownMetricTable(validation["tesseract-rules"]),
      "",
      "### PP-OCRv6 + old rules",
      "",
      markdownMetricTable(validation["ppocrv6-old-rules"]),
      "",
      "### PP-OCRv6 + adapted selector",
      "",
      markdownMetricTable(validation["ppocrv6-adapted"]),
      "",
      `Validation trusted field rate: ${markdownPercent(validation["ppocrv6-adapted"].trustedFieldRate)}; mean unresolved fields: ${validation["ppocrv6-adapted"].meanUnresolvedFields.toFixed(2)}; selector mean/p95: ${validation["ppocrv6-adapted"].selectorRuntimeMs.mean.toFixed(3)}/${validation["ppocrv6-adapted"].selectorRuntimeMs.p95.toFixed(3)} ms; fixed known-field cases vs old PP-OCRv6 rules: ${validation["ppocrv6-adapted"].examples.fixedCount}; made worse: ${validation["ppocrv6-adapted"].examples.worseCount}.`,
      `Against PP-OCRv6 + old rules, the adapted selector changes unresolved-field work by ${((validation["ppocrv6-old-rules"].meanUnresolvedFields - validation["ppocrv6-adapted"].meanUnresolvedFields) / Math.max(0.001, validation["ppocrv6-old-rules"].meanUnresolvedFields) * 100).toFixed(1)}% (negative means more GPT work).`,
      `The cached PP-OCRv6 OCR pass itself averaged ${validation["ppocrv6-adapted"].ocrRuntimeMs.mean.toFixed(1)} ms (p95 ${validation["ppocrv6-adapted"].ocrRuntimeMs.p95.toFixed(1)} ms); the adapted selector excludes OCR from its ${validation["ppocrv6-adapted"].selectorRuntimeMs.mean.toFixed(3)} ms mean.`,
      "",
      "## Untouched final evaluation",
      "",
      "### PP-OCRv6 + old rules",
      "",
      markdownMetricTable(final["ppocrv6-old-rules"]),
      "",
      "### PP-OCRv6 + adapted selector",
      "",
      markdownMetricTable(final["ppocrv6-adapted"]),
      "",
      `Final trusted field rate: ${markdownPercent(final["ppocrv6-adapted"].trustedFieldRate)}; mean unresolved fields: ${final["ppocrv6-adapted"].meanUnresolvedFields.toFixed(2)}. This is an empirical result on ${final["ppocrv6-adapted"].sampleSize} receipts, not a 99.5%/99.9% statistical guarantee.`,
      "",
      "## All 500 SROIE receipts",
      "",
      "### PP-OCRv6 + old rules",
      "",
      markdownMetricTable(results.splits.all["ppocrv6-old-rules"]),
      "",
      "### PP-OCRv6 + adapted selector",
      "",
      markdownMetricTable(results.splits.all["ppocrv6-adapted"]),
      "",
      `Model artifact: ${results.model.bytes} bytes. The adapter runtime is five scalar logistic dot products; measured validation selector mean/p95 is ${validation["ppocrv6-adapted"].selectorRuntimeMs.mean.toFixed(3)}/${validation["ppocrv6-adapted"].selectorRuntimeMs.p95.toFixed(3)} ms, excluding OCR.`,
      "",
      "## Offline model comparison",
      "",
      modelComparisonTable(results.model.trainingComparison),
      "",
      "## Decision",
      "",
      "The adapted path remains experimental: validation does not show a material coverage improvement over PP-OCRv6 + old rules, and the adapted path is not a safe drop-in promotion despite eliminating known labeled-field errors on validation. The existing live Tesseract + rules path is unchanged.",
      "",
      "## Production metadata replay",
      "",
      "Production results are descriptive status counts only: the bucket corpus has no independent field annotations in this repository, and no private values are emitted.",
      "",
      results.production && "note" in results.production
        ? results.production.note
        : results.production
          ? `PP-OCRv6 + old rules: ${JSON.stringify(results.production["ppocrv6-old-rules"].all)}; PP-OCRv6 + adapted: ${JSON.stringify(results.production["ppocrv6-adapted"].all)}; Walmart old/adapted: ${JSON.stringify(results.production["ppocrv6-old-rules"].walmart)} / ${JSON.stringify(results.production["ppocrv6-adapted"].walmart)}.`
          : "Production results unavailable.",
      "",
    ].join("\n");
    await writeFile(path.join(root, "benchmarks/receipt-ppocrv6-extractor-results.json"), JSON.stringify(results, null, 2));
    await writeFile(path.join(root, "benchmarks/receipt-ppocrv6-extractor-report.md"), report);
    expect(v6Rows.length).toBe(500);
    expect(new Set(v6Rows.map((row) => splitFor(row.id))).size).toBe(3);
  }, 180_000);
});
