import {
  extractReceiptFieldsFromOcrLines,
  type ReceiptFrontendFields,
  type ReceiptOcrLine,
} from "@/lib/receiptFrontendExtractor";
import { extractReceiptFieldsFromPpocrV6Lines } from "@/lib/receiptPpocrV6Extractor";
import {
  RECEIPT_MODERN_OCR_ENGINES,
  receiptModernOcrPass,
  receiptOcrLinesFromGutenyeLines,
  receiptOcrLinesFromPaddleItems,
  type ReceiptModernOcrEngineName,
  type ReceiptModernOcrLine,
} from "@/lib/receiptModernOcr";

type Dataset = "sroie" | "production";
type EngineSpec = (typeof RECEIPT_MODERN_OCR_ENGINES)[number];

interface ModernOcrRunner {
  detect: (url: string) => Promise<{ lines: ReceiptModernOcrLine[]; durationMs: number; engineMs?: number }>;
  dispose?: () => Promise<void> | void;
  initialization?: unknown;
}

const params = new URLSearchParams(window.location.search);
const dataset = (params.get("dataset") ?? "sroie") as Dataset;
const subset = params.get("subset") ?? "all";
const limit = Number(params.get("limit") ?? "0");
const variant = params.get("variant") ?? "default";
const extractor = params.get("extractor") ?? "old-rules";
const requestedEngines = new Set((params.get("engines") ?? "")
  .split(",")
  .map((name) => name.trim())
  .filter(Boolean));
const engines = RECEIPT_MODERN_OCR_ENGINES.filter((engine) => (
  !requestedEngines.size || requestedEngines.has(engine.name)
));
const output = document.querySelector("#output");

const publicModels = {
  paddleV5Det: "/benchmarks/modern-ocr-models/PP-OCRv5_mobile_det_onnx_infer.tar",
  paddleV5Rec: "/benchmarks/modern-ocr-models/PP-OCRv5_mobile_rec_onnx_infer.tar",
  paddleV6TinyDet: "/benchmarks/modern-ocr-models/PP-OCRv6_tiny_det_onnx_infer.tar",
  paddleV6TinyRec: "/benchmarks/modern-ocr-models/PP-OCRv6_tiny_rec_onnx_infer.tar",
  gutenyeDet: "/benchmarks/modern-ocr-models/ch_PP-OCRv4_det_infer.onnx",
  gutenyeRec: "/benchmarks/modern-ocr-models/ch_PP-OCRv4_rec_infer.onnx",
  gutenyeCls: "/benchmarks/modern-ocr-models/ch_ppocr_mobile_v2.0_cls_infer.onnx",
  gutenyeDictionary: "/benchmarks/modern-ocr-models/ppocr_keys_v1.txt",
} as const;

const duplicateGroup = new Map([[12, 12], [15, 12], [16, 12], [18, 12], [277, 277], [452, 277]]);
const splitFor = (index: number): "tuning" | "validation" | "final" => {
  const representative = duplicateGroup.get(index) ?? index;
  return representative < 300 ? "tuning" : representative < 400 ? "validation" : "final";
};

const sourceEntries = async (): Promise<Array<{ id: string; url: string; category?: string }>> => {
  if (dataset === "production") {
    const manifest = await (await fetch("/benchmarks/real-receipt-manifest.json")).json() as Array<Record<string, unknown>>;
    return manifest.map((entry) => ({
      id: String(entry.filename),
      url: `/benchmarks/real-receipts/${encodeURIComponent(String(entry.filename))}`,
      // Keep only a coarse public benchmark category; do not persist vendor
      // names, OCR text, or extracted field values for production images.
      category: /walmart/i.test(String(entry.vendor ?? "")) ? "walmart" : "other",
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

const heapBytes = (): number | null => {
  const memory = (performance as Performance & { memory?: { usedJSHeapSize?: number } }).memory;
  return typeof memory?.usedJSHeapSize === "number" ? memory.usedJSHeapSize : null;
};

const serializableLines = (lines: ReceiptOcrLine[]) => lines.map((line) => ({
  text: line.text,
  confidence: line.confidence,
  bbox: line.bbox,
  polygon: line.polygon,
  wordCount: line.words?.length ?? 0,
}));

const serializableFields = (fields: ReceiptFrontendFields, includeValues: boolean) => Object.fromEntries(
  Object.entries(fields).map(([field, value]) => [field, {
    ...(includeValues ? { value: value.value, evidence: value.evidence } : {}),
    confidence: value.confidence,
    status: value.status,
    source: value.source,
  }]),
);

const paddleOptions = (spec: ReceiptModernOcrEngineName) => {
  const tiny = spec === "paddleocr-js-ppocrv6-tiny";
  const variantOptions = tiny && variant === "high-resolution"
    ? { textDetLimitSideLen: 1280 }
    : tiny && variant === "permissive-detector"
      ? { textDetBoxThresh: 0.5 }
      : tiny && variant === "strict-recognizer"
        ? { textRecScoreThresh: 0.5 }
        : {};
  return {
    textDetectionModelName: tiny ? "PP-OCRv6_tiny_det" : "PP-OCRv5_mobile_det",
    textDetectionModelAsset: { url: tiny ? publicModels.paddleV6TinyDet : publicModels.paddleV5Det },
    textRecognitionModelName: tiny ? "PP-OCRv6_tiny_rec" : "PP-OCRv5_mobile_rec",
    textRecognitionModelAsset: { url: tiny ? publicModels.paddleV6TinyRec : publicModels.paddleV5Rec },
    textDetectionBatchSize: 1,
    textRecognitionBatchSize: 6,
    textDetLimitSideLen: 960,
    textDetLimitType: "max" as const,
    textDetBoxThresh: 0.6,
    textRecScoreThresh: 0,
    ortOptions: {
      backend: "wasm" as const,
      wasmPaths: "/node_modules/onnxruntime-web/dist/",
      numThreads: 1,
      simd: true,
    },
    ...variantOptions,
  };
};

const createPaddleRunner = async (spec: EngineSpec): Promise<ModernOcrRunner> => {
  const { PaddleOCR } = await import("@paddleocr/paddleocr-js");
  const ocr = await PaddleOCR.create(paddleOptions(spec.name));
  return {
    initialization: ocr.getInitializationSummary?.(),
    detect: async (url) => {
      const blob = await (await fetch(url)).blob();
      const started = performance.now();
      const results = await ocr.predict(blob);
      const result = results[0] ?? { items: [] };
      return {
        lines: receiptOcrLinesFromPaddleItems(result.items),
        durationMs: performance.now() - started,
        engineMs: result.metrics?.totalMs,
      };
    },
    dispose: () => ocr.dispose(),
  };
};

const createGutenyeRunner = async (): Promise<ModernOcrRunner> => {
  // The browser package uses its own ONNX Runtime import. Setting the shared
  // runtime environment before construction keeps WASM local/offline and
  // makes the benchmark independent of the public CDN.
  const ort = await import("onnxruntime-web");
  const wasm = (ort as typeof ort & { env?: { wasm?: Record<string, unknown> } }).env?.wasm;
  if (wasm) {
    wasm.wasmPaths = "/node_modules/onnxruntime-web/dist/";
    wasm.numThreads = 1;
    wasm.simd = true;
  }
  const module = await import("@gutenye/ocr-browser");
  const ocr = await module.default.create({
    models: {
      detectionPath: publicModels.gutenyeDet,
      recognitionPath: publicModels.gutenyeRec,
      dictionaryPath: publicModels.gutenyeDictionary,
    },
  });
  return {
    detect: async (url) => {
      const started = performance.now();
      const lines = receiptOcrLinesFromGutenyeLines(await ocr.detect(url));
      return { lines, durationMs: performance.now() - started };
    },
  };
};

const createRunner = async (spec: EngineSpec): Promise<ModernOcrRunner> => (
  spec.name === "gutenye-ppocrv4" ? createGutenyeRunner() : createPaddleRunner(spec)
);

const runEngine = async (spec: EngineSpec, entries: Array<{ id: string; url: string; category?: string }>) => {
  const initializationStarted = performance.now();
  let runner: ModernOcrRunner | undefined;
  let initializationError: string | undefined;
  try {
    runner = await createRunner(spec);
  } catch (error) {
    initializationError = String(error);
  }
  const initializationMs = performance.now() - initializationStarted;
  const heapAfterInitialization = heapBytes();
  const rows: Array<Record<string, unknown>> = [];
  const inferenceTimes: number[] = [];
  let firstInferenceMs: number | null = null;
  let completed = 0;
  for (const entry of entries) {
    const beforeHeap = heapBytes();
    let lines: ReceiptModernOcrLine[] = [];
    let durationMs = 0;
    let engineMs: number | undefined;
    let ocrError = Boolean(initializationError);
    try {
      if (!runner) throw new Error(initializationError ?? "OCR engine unavailable");
      const result = await runner.detect(entry.url);
      lines = result.lines;
      durationMs = result.durationMs;
      engineMs = result.engineMs;
      inferenceTimes.push(durationMs);
      if (firstInferenceMs === null) firstInferenceMs = durationMs;
    } catch {
      ocrError = true;
    }
    const pass = receiptModernOcrPass(spec.name, lines, durationMs);
    const extraction = extractor === "ppocrv6-adapted"
      ? extractReceiptFieldsFromPpocrV6Lines(lines, pass.text)
      : extractReceiptFieldsFromOcrLines(lines, "rules-only", pass.text);
    const row: Record<string, unknown> = {
      id: entry.id,
      extractor,
      durationMs,
      engineMs: engineMs ?? null,
      lineCount: lines.length,
      wordCount: pass.wordBoxes,
      meanConfidence: lines.length
        ? lines.reduce((sum, line) => sum + line.confidence, 0) / lines.length
        : 0,
      ocrError,
      unresolvedFields: extraction.unresolvedFields,
      fields: serializableFields(extraction.fields, dataset === "sroie"),
      heapBefore: beforeHeap,
      heapAfter: heapBytes(),
    };
    if (dataset === "sroie") {
      row.text = pass.text;
      row.lines = serializableLines(lines);
    } else {
      row.category = entry.category ?? "other";
    }
    rows.push(row);
    completed += 1;
    if (completed % 10 === 1) console.log(`modern OCR ${spec.name} ${dataset}/${subset} ${completed}/${entries.length}`);
  }
  await runner?.dispose?.();
  return {
    spec,
    initializationMs,
    firstInferenceMs,
    inferenceTimes,
    heapAfterInitialization,
    initializationError,
    initialization: runner?.initialization,
    rows,
  };
};

const run = async () => {
  const entries = await sourceEntries();
  const results: Record<string, unknown> = { dataset, subset, variant, sampleSize: entries.length, engines: {} };
  for (const spec of engines) {
    results.engines[spec.name] = await runEngine(spec, entries);
  }
  if (output) output.textContent = JSON.stringify(results);
};

try {
  await run();
} catch (error) {
  if (output) output.textContent = JSON.stringify({ error: String(error) });
}
