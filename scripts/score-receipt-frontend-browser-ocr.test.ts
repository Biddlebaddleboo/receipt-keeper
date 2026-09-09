import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { extractReceiptFieldsFromText, type ReceiptFrontendField } from "@/lib/receiptFrontendExtractor";

const root = process.cwd();
const fields: ReceiptFrontendField[] = ["vendor", "purchase_date", "subtotal", "tax", "total"];
const normalizeText = (value: string): string => value.toUpperCase().replace(/[^A-Z0-9]/g, "");
const expectedDate = (value: string): string | null => {
  const match = value?.match(/^(\d{1,2})\/(\d{1,2})\/(20\d{2})$/);
  return match ? `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}` : null;
};

describe("receipt browser OCR score", () => {
  it("re-scores raw OCR with the locked current rules", async () => {
    const raw = await readFile(path.join(root, "benchmarks/receipt-frontend-browser-ocr.jsonl"), "utf8");
    const metrics = Object.fromEntries(fields.map((field) => [field, { trusted: 0, evaluated: 0, correct: 0, expected: 0 }]));
    const rows = raw.split(/\r?\n/).filter(Boolean);
    for (const line of rows) {
      const row = JSON.parse(line) as { id: string; text: string };
      const label = JSON.parse(await readFile(path.join(root, "benchmarks/sroie500/labels", `${row.id}.json`), "utf8"));
      const expected: Partial<Record<ReceiptFrontendField, string>> = { vendor: label.company, purchase_date: expectedDate(label.date), total: label.total };
      const fieldsNow = extractReceiptFieldsFromText(row.text).fields;
      for (const field of fields) {
        if (expected[field]) metrics[field].expected += 1;
        if (fieldsNow[field].status !== "trusted") continue;
        metrics[field].trusted += 1;
        if (!expected[field]) continue;
        metrics[field].evaluated += 1;
        const predicted = fieldsNow[field].value ?? "";
        const correct = field === "vendor"
          ? normalizeText(predicted).includes(normalizeText(expected[field])) || normalizeText(expected[field]).includes(normalizeText(predicted))
          : field === "purchase_date" ? predicted === expected[field] : Number(predicted.replace(/[$,]/g, "")) === Number(expected[field]);
        if (correct) metrics[field].correct += 1;
      }
    }
    const summary = Object.fromEntries(fields.map((field) => {
      const metric = metrics[field];
      return [field, { trusted: metric.trusted, precision: metric.evaluated ? metric.correct / metric.evaluated : null, recall: metric.expected ? metric.correct / metric.expected : null }];
    }));
    await writeFile(path.join(root, "benchmarks/receipt-frontend-browser-ocr-results.json"), JSON.stringify({ sample_size: rows.length, per_field: summary }, null, 2));
    expect(rows).toHaveLength(500);
  }, 120_000);
});
