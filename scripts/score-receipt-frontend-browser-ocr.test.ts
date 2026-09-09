import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { extractReceiptFieldsFromOcrLines, extractReceiptFieldsFromText, type ReceiptFrontendField, type ReceiptFrontendFields, type ReceiptOcrLine } from "@/lib/receiptFrontendExtractor";

const root = process.cwd();
const fields: ReceiptFrontendField[] = ["vendor", "purchase_date", "subtotal", "tax", "total"];
const splitFor = (index: number): "tuning" | "validation" | "final" => {
  const representative = new Map([[12, 12], [15, 12], [16, 12], [18, 12], [277, 277], [452, 277]]).get(index) ?? index;
  return representative < 300 ? "tuning" : representative < 400 ? "validation" : "final";
};
const normalizeText = (value: string): string => value.toUpperCase().replace(/[^A-Z0-9]/g, "");
const expectedDate = (value: string): string | null => {
  const iso = value?.match(/^(20\d{2})[/.-](\d{1,2})[/.-](\d{1,2})$/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const month = value?.match(/^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2}),?\s+(20\d{2})$/i);
  if (month) return `${month[3]}-${String(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(month[1].toLowerCase().slice(0, 3)) + 1).padStart(2, "0")}-${month[2].padStart(2, "0")}`;
  const match = value?.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](20\d{2}|\d{2})$/);
  if (!match) return null;
  const year = match[3].length === 2 ? `20${match[3]}` : match[3];
  if (Number(match[1]) > 12) return `${year}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
  if (Number(match[2]) > 12) return `${year}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}`;
  return `${year}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
};

describe("receipt browser OCR score", () => {
  it("compares rules, ML-only, and combined extraction on the cached browser OCR", async () => {
    const raw = await readFile(path.join(root, "benchmarks/receipt-frontend-browser-ocr.jsonl"), "utf8");
    const metrics = Object.fromEntries(["rules", "ml", "combined"].map((strategy) => [strategy, Object.fromEntries(fields.map((field) => [field, { trusted: 0, evaluated: 0, correct: 0, expected: 0, confidence: 0, confidenceCorrect: 0, calibration: [] as Array<{ confidence: number; correct: number }> }]))]));
    const splitMetrics = Object.fromEntries(["tuning", "validation", "final"].map((split) => [split, Object.fromEntries(["rules", "ml", "combined"].map((strategy) => [strategy, Object.fromEntries(fields.map((field) => [field, { trusted: 0, evaluated: 0, correct: 0, expected: 0, confidence: 0, confidenceCorrect: 0, calibration: [] as Array<{ confidence: number; correct: number }> }]))]))]));
    const rows = raw.split(/\r?\n/).filter(Boolean);
    for (const line of rows) {
      const row = JSON.parse(line) as { id: string; text: string; ocrLines?: ReceiptOcrLine[]; rulesFields?: ReceiptFrontendFields; mlFields?: ReceiptFrontendFields; fields?: ReceiptFrontendFields };
      const label = JSON.parse(await readFile(path.join(root, "benchmarks/sroie500/labels", `${row.id}.json`), "utf8"));
      const expected: Partial<Record<ReceiptFrontendField, string>> = { vendor: label.company, purchase_date: expectedDate(label.date), total: label.total };
      const rulesFields = row.rulesFields ?? extractReceiptFieldsFromText(row.text).fields;
      const refreshedMl = row.ocrLines?.length
        ? extractReceiptFieldsFromOcrLines(row.ocrLines, "tesseract.js", row.text, { fallbackToRules: false, useModel: true }).fields
        : undefined;
      const refreshedCombined = row.ocrLines?.length
        ? extractReceiptFieldsFromOcrLines(row.ocrLines, "tesseract.js", row.text, { useModel: true }).fields
        : undefined;
      const strategyFields = {
        rules: rulesFields,
        ml: refreshedMl ?? row.mlFields ?? rulesFields,
        combined: refreshedCombined ?? row.fields ?? rulesFields,
      };
      const split = splitFor(Number(row.id));
      Object.entries(strategyFields).forEach(([strategy, fieldsNow]) => fields.forEach((field) => {
        if (expected[field]) metrics[strategy][field].expected += 1;
        if (expected[field]) splitMetrics[split][strategy][field].expected += 1;
        const item = fieldsNow[field];
        if (item.status !== "trusted") return;
        metrics[strategy][field].trusted += 1;
        metrics[strategy][field].confidence += item.confidence;
        splitMetrics[split][strategy][field].trusted += 1;
        splitMetrics[split][strategy][field].confidence += item.confidence;
        if (!expected[field]) return;
        metrics[strategy][field].evaluated += 1;
        splitMetrics[split][strategy][field].evaluated += 1;
        const predicted = item.value ?? "";
        const correct = field === "vendor"
          ? normalizeText(predicted).includes(normalizeText(expected[field])) || normalizeText(expected[field]).includes(normalizeText(predicted))
          : field === "purchase_date" ? predicted === expected[field] : Number(predicted.replace(/[$,]/g, "")) === Number(expected[field]);
        metrics[strategy][field].calibration.push({ confidence: item.confidence, correct: correct ? 1 : 0 });
        splitMetrics[split][strategy][field].calibration.push({ confidence: item.confidence, correct: correct ? 1 : 0 });
        if (correct) {
          metrics[strategy][field].correct += 1;
          metrics[strategy][field].confidenceCorrect += item.confidence;
          splitMetrics[split][strategy][field].correct += 1;
          splitMetrics[split][strategy][field].confidenceCorrect += item.confidence;
        }
      }));
    }
    const summary: Record<string, Record<string, unknown>> = {};
    const calibrationSummary = (calibration: Array<{ confidence: number; correct: number }>) => {
      if (!calibration.length) return { expected_calibration_error: null, brier_score: null, labeled_trusted_predictions: 0 };
      const bins = Array.from({ length: 10 }, (_, index) => calibration.filter((item) => item.confidence >= index / 10 && item.confidence < (index + 1) / 10));
      const expectedCalibrationError = bins.reduce((sum, bin) => {
        if (!bin.length) return sum;
        const meanConfidence = bin.reduce((total, item) => total + item.confidence, 0) / bin.length;
        const accuracy = bin.reduce((total, item) => total + item.correct, 0) / bin.length;
        return sum + (bin.length / calibration.length) * Math.abs(meanConfidence - accuracy);
      }, 0);
      return {
        expected_calibration_error: expectedCalibrationError,
        brier_score: calibration.reduce((sum, item) => sum + (item.confidence - item.correct) ** 2, 0) / calibration.length,
        labeled_trusted_predictions: calibration.length,
      };
    };
    Object.entries(metrics).forEach(([strategy, fieldsNow]) => {
      summary[strategy] = {};
      fields.forEach((field) => {
        const metric = fieldsNow[field];
        summary[strategy][field] = {
          trusted: metric.trusted,
          precision: metric.evaluated ? metric.correct / metric.evaluated : null,
          recall: metric.expected ? metric.correct / metric.expected : null,
          coverage: metric.trusted / rows.length,
          abstention: 1 - metric.trusted / rows.length,
          mean_confidence: metric.trusted ? metric.confidence / metric.trusted : null,
          mean_correct_confidence: metric.correct ? metric.confidenceCorrect / metric.correct : null,
          calibration: calibrationSummary(metric.calibration),
        };
      });
    });
    const splitSummary: Record<string, Record<string, Record<string, unknown>>> = {};
    Object.entries(splitMetrics).forEach(([split, strategyValues]) => {
      splitSummary[split] = {};
      Object.entries(strategyValues).forEach(([strategy, fieldsNow]) => {
        splitSummary[split][strategy] = {};
        fields.forEach((field) => {
          const metric = fieldsNow[field];
          splitSummary[split][strategy][field] = {
            trusted: metric.trusted,
            precision: metric.evaluated ? metric.correct / metric.evaluated : null,
            recall: metric.expected ? metric.correct / metric.expected : null,
            coverage: metric.trusted / (split === "tuning" ? 301 : split === "validation" ? 100 : 99),
          };
        });
      });
    });
    await writeFile(path.join(root, "benchmarks/receipt-frontend-browser-ocr-results.json"), JSON.stringify({ sample_size: rows.length, strategies: summary, splits: splitSummary }, null, 2));
    expect(rows).toHaveLength(500);
  }, 120_000);
});
