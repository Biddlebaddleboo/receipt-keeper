import { readFile, writeFile } from "node:fs/promises";

const inputPaths = process.argv.slice(2);
const paths = inputPaths.length ? inputPaths : [
  "benchmarks/receipt-hierarchical-sroie-tuning-adaptive-wide-tuned-min2.json",
  "benchmarks/receipt-hierarchical-sroie-validation-adaptive-wide-tuned-min2.json",
  "benchmarks/receipt-hierarchical-sroie-final-adaptive-wide-tuned-min2.json",
];
const outputPath = process.env.RECEIPT_HIERARCHICAL_MERGED_OUTPUT ?? "benchmarks/receipt-hierarchical-sroie-all-adaptive-wide-tuned-min2.json";

const files = await Promise.all(paths.map(async (path) => JSON.parse(await readFile(path, "utf8"))));
const rows = files.flatMap((file) => file.rows ?? []).sort((left, right) => String(left.id).localeCompare(String(right.id)));
const summary = (key) => {
  const values = rows.map((row) => Number(row[key])).filter(Number.isFinite).sort((left, right) => left - right);
  return { mean: values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length), median: values[Math.floor(values.length / 2)] ?? 0, p95: values[Math.min(values.length - 1, Math.floor(values.length * 0.95))] ?? 0 };
};
const first = files[0];
const merged = {
  dataset: "sroie",
  subset: "all",
  config: first.config,
  firstPass: first.firstPass,
  sampleSize: rows.length,
  model: first.model,
  hierarchicalModel: first.hierarchicalModel,
  initializationMs: Math.max(...files.map((file) => Number(file.initializationMs)).filter(Number.isFinite)),
  firstPassMs: summary("firstPassMs"),
  expertMs: summary("expertMs"),
  preparationMs: summary("preparationMs"),
  totalMs: summary("durationMs"),
  rows,
};
await writeFile(outputPath, JSON.stringify(merged));
console.log(`Merged ${rows.length} rows into ${outputPath}`);
