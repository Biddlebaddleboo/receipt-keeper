import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  extractReceiptFieldsFromOcrLines,
  extractReceiptFieldsFromText,
  parseReceiptAmount,
  RECEIPT_FRONTEND_FIELDS,
  type ReceiptFrontendField,
  type ReceiptFrontendFieldResult,
  type ReceiptOcrLine,
} from "@/lib/receiptFrontendExtractor";

const root = process.cwd();
const sampleRoot = path.join(root, "benchmarks/sroie500");
const fields: ReceiptFrontendField[] = [...RECEIPT_FRONTEND_FIELDS];
const splitFor = (index: number): "tuning" | "validation" | "final" => {
  const representative = new Map([[12, 12], [15, 12], [16, 12], [18, 12], [277, 277], [452, 277]]).get(index) ?? index;
  return representative < 300 ? "tuning" : representative < 400 ? "validation" : "final";
};

const csvRows = (raw: string): string[][] => raw.split(/\r?\n/).filter(Boolean).map((line) => {
  const parts = line.split(",");
  return [parts.slice(0, 8).join(","), parts.slice(8).join(",")];
});

const parseOcr = (raw: string): ReceiptOcrLine[] => csvRows(raw).flatMap(([coordinates, text]) => {
  const values = coordinates.split(",").map(Number);
  if (values.length !== 8 || values.some((value) => !Number.isFinite(value))) return [];
  return [{
    text,
    bbox: { x0: values[0], y0: values[1], x1: values[4], y1: values[5] },
  }];
});

const normalizeText = (value: string): string => value.toUpperCase().replace(/[^A-Z0-9]/g, "");
const normalizeDate = (value: string | undefined): string | undefined => {
  if (!value) return undefined;
  const iso = value.match(/^(20\d{2})[/.-](\d{1,2})[/.-](\d{1,2})$/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const month = value.match(/^(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2}),?\s+(20\d{2})$/i);
  if (month) {
    const monthNumber = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(month[1].slice(0, 3).toLowerCase()) + 1;
    return `${month[3]}-${String(monthNumber).padStart(2, "0")}-${month[2].padStart(2, "0")}`;
  }
  const numeric = value.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](20\d{2}|\d{2})$/);
  if (!numeric) return undefined;
  const year = numeric[3].length === 2 ? `20${numeric[3]}` : numeric[3];
  // SROIE is predominantly day-first.  A value with an impossible day or
  // month is still unambiguous and is interpreted accordingly.
  if (Number(numeric[1]) > 12) return `${year}-${numeric[2].padStart(2, "0")}-${numeric[1].padStart(2, "0")}`;
  if (Number(numeric[2]) > 12) return `${year}-${numeric[1].padStart(2, "0")}-${numeric[2].padStart(2, "0")}`;
  return `${year}-${numeric[2].padStart(2, "0")}-${numeric[1].padStart(2, "0")}`;
};

const isCorrect = (field: ReceiptFrontendField, result: ReceiptFrontendFieldResult, expected: string | undefined): boolean => {
  if (!expected || !result.value) return false;
  if (field === "vendor") {
    const predicted = normalizeText(result.value);
    const target = normalizeText(expected);
    return predicted.includes(target) || target.includes(predicted);
  }
  if (field === "purchase_date") return result.value === expected;
  const predicted = parseReceiptAmount(result.value);
  const target = parseReceiptAmount(expected);
  return predicted !== null && target !== null && Math.abs(predicted - target) < 0.011;
};

type Metric = { trusted: number; correct: number; wrong: number; expected: number; confidenceSum: number; confidenceCorrect: number };
const emptyMetric = (): Metric => ({ trusted: 0, correct: 0, wrong: 0, expected: 0, confidenceSum: 0, confidenceCorrect: 0 });

const summarise = (metrics: Record<ReceiptFrontendField, Metric>) => Object.fromEntries(fields.map((field) => {
  const metric = metrics[field];
  return [field, {
    trusted: metric.trusted,
    correct: metric.correct,
    wrong: metric.wrong,
    expected: metric.expected || null,
    precision: metric.trusted ? metric.correct / metric.trusted : null,
    recall: metric.expected ? metric.correct / metric.expected : null,
    coverage: metric.trusted / 500,
    abstention: 1 - metric.trusted / 500,
    mean_trusted_confidence: metric.trusted ? metric.confidenceSum / metric.trusted : null,
    mean_correct_confidence: metric.confidenceCorrect ? metric.confidenceCorrect / metric.correct : null,
  }];
}));

const score = (
  extraction: { fields: Record<ReceiptFrontendField, ReceiptFrontendFieldResult> },
  expected: Partial<Record<ReceiptFrontendField, string>>,
  metrics: Record<ReceiptFrontendField, Metric>,
) => fields.forEach((field) => {
  const metric = metrics[field];
  if (expected[field]) metric.expected += 1;
  const result = extraction.fields[field];
  if (result.status !== "trusted") return;
  metric.trusted += 1;
  metric.confidenceSum += result.confidence;
  if (isCorrect(field, result, expected[field])) {
    metric.correct += 1;
    metric.confidenceCorrect += result.confidence;
  } else metric.wrong += 1;
});

const metricsFor = (): Record<ReceiptFrontendField, Metric> => Object.fromEntries(fields.map((field) => [field, emptyMetric()])) as Record<ReceiptFrontendField, Metric>;

describe("receipt frontend ML benchmark", () => {
  it("compares the rules baseline with the locked logistic candidate model across tuning, validation, and final splits", async () => {
    const byStrategy = {
      rules: metricsFor(),
      ml: metricsFor(),
      combined: metricsFor(),
    };
    const bySplit = Object.fromEntries(["tuning", "validation", "final"].map((split) => [split, {
      rules: metricsFor(), ml: metricsFor(), combined: metricsFor(),
    }]));
    const rows: Array<Record<string, unknown>> = [];
    let modelInferenceMs = 0;
    for (let index = 0; index < 500; index += 1) {
      const id = String(index).padStart(3, "0");
      const [ocrRaw, labelRaw] = await Promise.all([
        readFile(path.join(sampleRoot, "ocr", `${id}.csv`), "utf8"),
        readFile(path.join(sampleRoot, "labels", `${id}.json`), "utf8"),
      ]);
      const label = JSON.parse(labelRaw) as { company?: string; date?: string; total?: string };
      const expected: Partial<Record<ReceiptFrontendField, string>> = {
        vendor: label.company,
        purchase_date: normalizeDate(label.date),
        total: label.total,
      };
      const lines = parseOcr(ocrRaw);
      const rules = extractReceiptFieldsFromText(lines.map((line) => line.text).join("\n"));
      const modelStarted = performance.now();
      const ml = extractReceiptFieldsFromOcrLines(lines, "rules-only", undefined, { fallbackToRules: false, useModel: true });
      const combined = extractReceiptFieldsFromOcrLines(lines, "rules-only", undefined, { useModel: true });
      modelInferenceMs += performance.now() - modelStarted;
      const split = splitFor(index);
      score(rules, expected, byStrategy.rules);
      score(ml, expected, byStrategy.ml);
      score(combined, expected, byStrategy.combined);
      score(rules, expected, bySplit[split].rules);
      score(ml, expected, bySplit[split].ml);
      score(combined, expected, bySplit[split].combined);
      rows.push({ id, split, rules: rules.fields, ml: ml.fields, combined: combined.fields });
    }
    const summary = {
      dataset: "ICDAR 2019 SROIE public OCR boxes + key labels",
      sample_size: rows.length,
      supervised_fields: ["vendor", "purchase_date", "total"],
      weak_or_unlabelled_fields: ["subtotal", "tax"],
      model_size_bytes: JSON.stringify((await import("@/lib/receiptFieldModel.json")).default).length,
      model_inference_ms: modelInferenceMs,
      model_inference_ms_per_receipt: modelInferenceMs / rows.length,
      strategies: Object.fromEntries(Object.entries(byStrategy).map(([name, metric]) => [name, summarise(metric)])),
      splits: Object.fromEntries(Object.entries(bySplit).map(([name, value]) => [name, Object.fromEntries(Object.entries(value).map(([strategy, metric]) => [strategy, summarise(metric)]))])),
      rows,
    };
    await writeFile(path.join(root, "benchmarks/receipt-frontend-ml-results.json"), JSON.stringify(summary, null, 2));
    expect(rows).toHaveLength(500);
  }, 120_000);

  it("inventories every cached production receipt without persisting its OCR text", async () => {
    const productionRoot = path.join(root, "benchmarks/real-receipts");
    const imageNames = (await readdir(productionRoot)).filter((name) => /\.(?:jpe?g|png|webp)$/i.test(name));
    const previous = await readFile(path.join(root, "benchmarks/receipt-frontend-production-browser-ocr.jsonl"), "utf8").catch(() => "");
    const rows = previous.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as { id: string; fields?: Record<string, unknown>; unresolvedFields?: string[]; mlShadowTrustedFields?: string[]; mlCombinedTrustedFields?: string[] });
    const fieldCounts = Object.fromEntries(fields.map((field) => [field, rows.filter((row) => row.fields?.[field] && (row.fields[field] as { status?: string }).status === "trusted").length]));
    const mlShadowCounts = Object.fromEntries(fields.map((field) => [field, rows.filter((row) => row.mlShadowTrustedFields?.includes(field)).length]));
    const mlCombinedCounts = Object.fromEntries(fields.map((field) => [field, rows.filter((row) => row.mlCombinedTrustedFields?.includes(field)).length]));
    const unresolved = rows.filter((row) => (row.unresolvedFields ?? fields).length > 0).length;
    await writeFile(path.join(root, "benchmarks/receipt-frontend-ml-production-summary.json"), JSON.stringify({
      image_count: imageNames.length,
      ocr_records: rows.length,
      trusted_by_field: fieldCounts,
      ml_shadow_trusted_by_field: mlShadowCounts,
      ml_combined_trusted_by_field: mlCombinedCounts,
      unresolved_receipts: unresolved,
      note: "Production images have no field ground truth; review queue remains authoritative.",
    }, null, 2));
    expect(rows.length === 0 || rows.length === imageNames.length).toBe(true);
  }, 30_000);
});
