import { appendFile, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { extractReceiptFieldsFromImage, extractReceiptFieldsFromText, type ReceiptFrontendField } from "@/lib/receiptFrontendExtractor";

const root = process.cwd();
const sampleRoot = path.join(root, "benchmarks/sroie500");
const fields: ReceiptFrontendField[] = ["vendor", "purchase_date", "subtotal", "tax", "total"];

const csvText = (raw: string): string => raw.split(/\r?\n/).filter(Boolean).map((line) => line.split(",").slice(8).join(",")).join("\n");
const normalizeText = (value: string): string => value.toUpperCase().replace(/[^A-Z0-9]/g, "");
const normalizeDate = (value: string): string | null => {
  const match = value.match(/^(\d{1,2})\/(\d{1,2})\/(20\d{2})$/);
  return match ? `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}` : null;
};
const duplicateGroup = new Map([[12, 12], [15, 12], [16, 12], [18, 12], [277, 277], [452, 277]]);
const splitFor = (index: number): "tuning" | "validation" | "final" => {
  const representative = duplicateGroup.get(index) ?? index;
  return representative < 300 ? "tuning" : representative < 400 ? "validation" : "final";
};

describe("receipt frontend benchmark", () => {
  it("scores strict rules on the 500 labelled OCR records and inventories real receipts", async () => {
    const results: Array<Record<string, unknown>> = [];
    const metric = Object.fromEntries(fields.map((field) => [field, { predicted: 0, evaluatedPredicted: 0, correct: 0, expected: 0 }]));
    for (let index = 0; index < 500; index += 1) {
      const id = String(index).padStart(3, "0");
      const [ocrRaw, labelRaw] = await Promise.all([
        readFile(path.join(sampleRoot, "ocr", `${id}.csv`), "utf8"),
        readFile(path.join(sampleRoot, "labels", `${id}.json`), "utf8"),
      ]);
      const label = JSON.parse(labelRaw) as { company?: string; date?: string; total?: string };
      const extraction = extractReceiptFieldsFromText(csvText(ocrRaw));
      const expected: Partial<Record<ReceiptFrontendField, string>> = {
        vendor: label.company,
        purchase_date: label.date ? normalizeDate(label.date) ?? undefined : undefined,
        total: label.total,
      };
      const row: Record<string, unknown> = {
        id,
        split: splitFor(index),
        unresolved: extraction.unresolvedFields,
        trusted_fields: fields.filter((field) => extraction.fields[field].status === "trusted"),
      };
      fields.forEach((field) => {
        if (expected[field]) metric[field as keyof typeof metric].expected += 1;
        if (extraction.fields[field].status === "trusted") {
          metric[field as keyof typeof metric].predicted += 1;
          const predicted = extraction.fields[field].value ?? "";
          if (!expected[field]) return;
          metric[field as keyof typeof metric].evaluatedPredicted += 1;
          const correct = field === "vendor"
            ? normalizeText(predicted).includes(normalizeText(expected[field] ?? "")) || normalizeText(expected[field] ?? "").includes(normalizeText(predicted))
            : field === "purchase_date" ? predicted === expected[field] : Number(predicted.replace(/[$,]/g, "")) === Number(expected[field]);
          if (correct) metric[field as keyof typeof metric].correct += 1;
        }
      });
      results.push(row);
    }
    const realFiles = await readdir(path.join(root, "benchmarks/real-receipts")).catch(() => []);
    const summary = {
      dataset: "ICDAR 2019 SROIE public OCR/label sample",
      sample_size: 500,
      per_field: Object.fromEntries(fields.map((field) => {
        const values = metric[field];
        return [field, {
          precision: values.evaluatedPredicted ? values.correct / values.evaluatedPredicted : null,
          recall: values.expected ? values.correct / values.expected : null,
          trusted: values.predicted,
          correct: values.correct,
          expected: values.expected,
        }];
      })),
      any_field_unresolved_rate: results.filter((row) => (row.unresolved as string[]).length > 0).length / results.length,
      split_counts: Object.fromEntries(["tuning", "validation", "final"].map((split) => [split, results.filter((row) => row.split === split).length])),
      real_receipt_images_cached: realFiles.length,
      real_receipt_ground_truth: "unknown; review queue required",
      rows: results,
    };
    await writeFile(path.join(root, "benchmarks/receipt-frontend-benchmark-results.json"), JSON.stringify(summary, null, 2));
    expect(results).toHaveLength(500);
  }, 120_000);

  it.skipIf(process.env.RUN_BROWSER_OCR !== "1")("runs browser OCR over all 500 sample images", async () => {
    const outputPath = path.join(root, "benchmarks/receipt-frontend-browser-ocr.jsonl");
    await writeFile(outputPath, "");
    const { createWorker } = await import("tesseract.js");
    const workers = await Promise.all([0, 1].map(() => createWorker("eng", 1)));
    let nextIndex = 0;
    let completed = 0;
    const runWorker = async (worker: Awaited<ReturnType<typeof createWorker>>) => {
      while (true) {
        const index = nextIndex++;
        if (index >= 500) return;
        const id = String(index).padStart(3, "0");
        let extraction;
        try {
          const recognized = await Promise.race([
            worker.recognize(path.join(sampleRoot, "images", `${id}.jpg`)),
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error("OCR image timeout")), 45_000)),
          ]);
          extraction = extractReceiptFieldsFromText(recognized.data.text ?? "", "tesseract.js");
        } catch {
          extraction = extractReceiptFieldsFromText("", "unavailable");
        }
        await appendFile(outputPath, `${JSON.stringify({ id, ...extraction })}\n`);
        completed += 1;
        if (completed % 10 === 1) console.log(`browser OCR ${completed}/500`);
      }
    };
    try {
      await Promise.all(workers.map(runWorker));
    } finally {
      await Promise.all(workers.map((worker) => worker.terminate()));
    }
    const output = (await readFile(outputPath, "utf8")).split(/\r?\n/).filter(Boolean);
    expect(output).toHaveLength(500);
  }, 1_800_000);

  it.skipIf(process.env.RUN_BROWSER_OCR !== "1")("runs browser OCR over every cached production receipt without persisting OCR text", async () => {
    const productionRoot = path.join(root, "benchmarks/real-receipts");
    const imageNames = (await readdir(productionRoot)).filter((name) => /\.(?:jpe?g|png|webp)$/i.test(name));
    const output: string[] = [];
    const { createWorker } = await import("tesseract.js");
    const workers = await Promise.all([0, 1].map(() => createWorker("eng", 1)));
    let nextIndex = 0;
    let completed = 0;
    const runWorker = async (worker: Awaited<ReturnType<typeof createWorker>>) => {
      while (true) {
        const index = nextIndex++;
        if (index >= imageNames.length) return;
        const name = imageNames[index];
        let extraction;
        try {
          const recognized = await Promise.race([
            worker.recognize(path.join(productionRoot, name)),
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error("OCR image timeout")), 45_000)),
          ]);
          extraction = extractReceiptFieldsFromText(recognized.data.text ?? "", "tesseract.js");
        } catch {
          extraction = extractReceiptFieldsFromText("", "unavailable");
        }
        output[index] = JSON.stringify({ id: name, fields: extraction.fields, unresolvedFields: extraction.unresolvedFields, engine: extraction.engine });
        completed += 1;
        if (completed % 10 === 1) console.log(`production browser OCR ${completed}/${imageNames.length}`);
      }
    };
    try {
      await Promise.all(workers.map(runWorker));
    } finally {
      await Promise.all(workers.map((worker) => worker.terminate()));
    }
    await writeFile(path.join(root, "benchmarks/receipt-frontend-production-browser-ocr.jsonl"), `${output.join("\n")}\n`);
    expect(output).toHaveLength(imageNames.length);
  }, 600_000);
});
