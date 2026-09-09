import { createWorker } from "tesseract.js";
import {
  extractReceiptFieldsFromOcrLines,
  extractReceiptFieldsFromText,
} from "@/lib/receiptFrontendExtractor";
import {
  RECEIPT_OCR_SCREENING_STRATEGIES,
  recognizeReceiptOcrPass,
  type ReceiptOcrLine,
  type ReceiptOcrPass,
  type ReceiptOcrStrategy,
} from "@/lib/receiptOcr";

type Dataset = "sroie" | "production";

const params = new URLSearchParams(window.location.search);
const dataset = (params.get("dataset") ?? "sroie") as Dataset;
const subset = params.get("subset") ?? "all";
const limit = Number(params.get("limit") ?? "0");
const requestedStrategies = new Set((params.get("strategies") ?? "")
  .split(",")
  .map((name) => name.trim())
  .filter(Boolean));
const strategies = RECEIPT_OCR_SCREENING_STRATEGIES.filter((strategy) => (
  !requestedStrategies.size || requestedStrategies.has(strategy.name)
));
const output = document.querySelector("#output");

const duplicateGroup = new Map([[12, 12], [15, 12], [16, 12], [18, 12], [277, 277], [452, 277]]);
const splitFor = (index: number): "tuning" | "validation" | "final" => {
  const representative = duplicateGroup.get(index) ?? index;
  return representative < 300 ? "tuning" : representative < 400 ? "validation" : "final";
};

const sourceEntries = async (): Promise<Array<{ id: string; url: string; metadata?: Record<string, unknown> }>> => {
  if (dataset === "production") {
    const manifest = await (await fetch("/benchmarks/real-receipt-manifest.json")).json() as Array<Record<string, unknown>>;
    return manifest.map((entry) => ({
      id: String(entry.filename),
      url: `/benchmarks/real-receipts/${encodeURIComponent(String(entry.filename))}`,
      metadata: entry,
    }));
  }
  const ids = Array.from({ length: 500 }, (_, index) => index)
    .filter((index) => subset === "all" || splitFor(index) === subset);
  const selectedIds = limit > 0 ? ids.slice(0, limit) : ids;
  return selectedIds.map((index) => ({
    id: String(index).padStart(3, "0"),
    url: `/benchmarks/sroie500/images/${String(index).padStart(3, "0")}.jpg`,
  }));
};

const serializableLines = (lines: ReceiptOcrLine[]) => lines.map((line) => ({
  text: line.text,
  confidence: line.confidence,
  bbox: line.bbox,
  wordCount: line.words?.length ?? 0,
}));

const serializableFields = (fields: ReturnType<typeof extractReceiptFieldsFromText>["fields"]) => Object.fromEntries(
  Object.entries(fields).map(([field, value]) => [field, {
    value: value.value,
    confidence: value.confidence,
    status: value.status,
    source: value.source,
    ...(dataset === "sroie" ? { evidence: value.evidence } : {}),
  }]),
);

const safeEmptyPass = (strategy: ReceiptOcrStrategy): ReceiptOcrPass => ({
  strategy: strategy.name,
  region: strategy.region?.name ?? "full",
  text: "",
  lines: [],
  meanConfidence: 0,
  durationMs: 0,
});

const run = async () => {
  const entries = await sourceEntries();
  const initializationStarted = performance.now();
  const workers = await Promise.all([0, 1].map(() => createWorker("eng", 1, {
    logger: () => undefined,
    errorHandler: () => undefined,
    // Keep the offline benchmark independent of the public CDN. These files
    // are local development dependencies; the app's normal lazy OCR path
    // keeps its existing deployment asset configuration.
    workerPath: "/node_modules/tesseract.js/dist/worker.min.js",
    corePath: "/node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js",
    langPath: "/",
    gzip: false,
  })));
  const initializationMs = performance.now() - initializationStarted;
  let firstInferenceMs: number | null = null;
  const strategyResults: Record<string, Array<Record<string, unknown>>> = Object.fromEntries(
    strategies.map((strategy) => [strategy.name, []]),
  );
  let nextIndex = 0;
  let completed = 0;

  const runWorker = async (worker: Awaited<ReturnType<typeof createWorker>>) => {
    while (true) {
      const index = nextIndex++;
      if (index >= entries.length) return;
      const entry = entries[index];
      for (const strategy of strategies) {
        let pass = safeEmptyPass(strategy);
        let ocrError = false;
        try {
          pass = await recognizeReceiptOcrPass(worker, entry.url, strategy);
          if (firstInferenceMs === null) firstInferenceMs = pass.durationMs;
        } catch {
          // A decode/worker error is a measured fail-open row, not a reason to
          // remove the image from the denominator.
          ocrError = true;
        }
        const parsed = pass.lines.length
          ? extractReceiptFieldsFromOcrLines(pass.lines, "tesseract.js", pass.text)
          : extractReceiptFieldsFromText(pass.text, pass.text ? "tesseract.js" : "unavailable");
        const mlParsed = pass.lines.length
          ? extractReceiptFieldsFromOcrLines(pass.lines, "tesseract.js", pass.text, { fallbackToRules: false, useModel: true })
          : parsed;
        const combinedParsed = pass.lines.length
          ? extractReceiptFieldsFromOcrLines(pass.lines, "tesseract.js", pass.text, { useModel: true })
          : parsed;
        const row: Record<string, unknown> = {
          id: entry.id,
          durationMs: pass.durationMs,
          lineCount: pass.lines.length,
          wordCount: pass.lines.reduce((sum, line) => sum + (line.words?.length ?? 0), 0),
          meanConfidence: pass.meanConfidence,
          ocrError,
          fields: serializableFields(parsed.fields),
          mlFields: serializableFields(mlParsed.fields),
          combinedFields: serializableFields(combinedParsed.fields),
          unresolvedFields: parsed.unresolvedFields,
        };
        if (dataset === "sroie") {
          row.text = pass.text;
          row.lines = serializableLines(pass.lines);
        } else if (entry.metadata) {
          // Metadata is used only for local aggregate checks; do not persist
          // OCR text or field evidence for production receipts.
          row.reference = {
            vendor: entry.metadata.vendor ?? null,
            purchase_date: entry.metadata.purchase_date ?? null,
          };
        }
        strategyResults[strategy.name].push(row);
      }
      completed += 1;
      if (completed % 10 === 1) console.log(`receipt OCR ${dataset}/${subset} ${completed}/${entries.length}`);
    }
  };

  try {
    await Promise.all(workers.map(runWorker));
  } finally {
    await Promise.all(workers.map((worker) => worker.terminate()));
  }
  const ordered = Object.fromEntries(Object.entries(strategyResults).map(([name, rows]) => [
    name,
    rows.sort((left, right) => String(left.id).localeCompare(String(right.id))),
  ]));
  if (output) output.textContent = JSON.stringify({
    dataset,
    subset,
    sampleSize: entries.length,
    initializationMs,
    firstInferenceMs,
    strategies: ordered,
  });
};

try {
  await run();
} catch (error) {
  if (output) output.textContent = JSON.stringify({ error: String(error) });
}
