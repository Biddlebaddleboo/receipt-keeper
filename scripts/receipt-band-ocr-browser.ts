import {
  createHorizontalBands,
  extractReceiptFieldsFromPpocrV6Bands,
  mapReceiptBandLineToSource,
  RECEIPT_BAND_SCREENING_CONFIGS,
  type ReceiptBandConfig,
  type ReceiptBandExtraction,
  type ReceiptBandObservation,
  type ReceiptHorizontalBand,
} from "@/lib/receiptBandOcr";
import { preprocessReceiptPixels } from "@/lib/receiptOcr";
import {
  RECEIPT_MODERN_OCR_ENGINES,
  receiptOcrLinesFromPaddleItems,
  type ReceiptModernOcrLine,
} from "@/lib/receiptModernOcr";

type Dataset = "sroie" | "production";

const params = new URLSearchParams(window.location.search);
const dataset = (params.get("dataset") ?? "sroie") as Dataset;
const subset = params.get("subset") ?? "all";
const limit = Number(params.get("limit") ?? "0");
const requestedConfig = params.get("config") ?? RECEIPT_BAND_SCREENING_CONFIGS[0].name;
const config = RECEIPT_BAND_SCREENING_CONFIGS.find((candidate) => candidate.name === requestedConfig)
  ?? RECEIPT_BAND_SCREENING_CONFIGS[0];
const output = document.querySelector("#output");

const publicModels = {
  det: "/benchmarks/modern-ocr-models/PP-OCRv6_tiny_det_onnx_infer.tar",
  rec: "/benchmarks/modern-ocr-models/PP-OCRv6_tiny_rec_onnx_infer.tar",
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
      category: /walmart/i.test(String(entry.vendor ?? "")) ? "walmart" : "other",
    }));
  }
  const ids = Array.from({ length: 500 }, (_, index) => index)
    .filter((index) => subset === "all" || splitFor(index) === subset);
  const selected = limit > 0 ? ids.slice(0, limit) : ids;
  return selected.map((index) => ({
    id: String(index).padStart(3, "0"),
    url: `/benchmarks/sroie500/images/${String(index).padStart(3, "0")}.jpg`,
  }));
};

interface PreparedInput {
  canvas: HTMLCanvasElement;
  scale: number;
  bandIndex: number;
  bandTop: number;
  bandBottom: number;
  observationKey: string;
}

interface ImageDimensions {
  width: number;
  height: number;
}

const loadImage = async (url: string): Promise<HTMLImageElement> => {
  const image = new Image();
  const loaded = new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error(`Unable to decode ${url}`));
  });
  image.src = url;
  await loaded;
  return image;
};

const imageDimensions = (image: HTMLImageElement): ImageDimensions => ({
  width: image.naturalWidth || image.width,
  height: image.naturalHeight || image.height,
});

const inputScale = (width: number, height: number, candidate: ReceiptBandConfig): number => Math.min(
  Math.max(0.25, candidate.maxScale),
  candidate.maxDimension / Math.max(1, width, height),
);

const renderInput = (
  image: HTMLImageElement,
  dimensions: ImageDimensions,
  band: ReceiptHorizontalBand,
  candidate: ReceiptBandConfig,
  bandIndex: number,
  observationKey: string,
): PreparedInput => {
  const scale = Math.max(0.25, inputScale(band.width, band.height, candidate));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(band.width * scale));
  canvas.height = Math.max(1, Math.round(band.height * scale));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas 2D context unavailable");
  context.drawImage(
    image,
    0,
    band.top,
    dimensions.width,
    band.height,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  if (candidate.preprocessing !== "original") {
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    imageData.data.set(preprocessReceiptPixels(imageData.data, canvas.width, canvas.height, candidate.preprocessing));
    context.putImageData(imageData, 0, 0);
  }
  return { canvas, scale, bandIndex, bandTop: band.top, bandBottom: band.bottom, observationKey };
};

const paddleOptions = (candidate: ReceiptBandConfig) => ({
  textDetectionModelName: "PP-OCRv6_tiny_det",
  textDetectionModelAsset: { url: publicModels.det },
  textRecognitionModelName: "PP-OCRv6_tiny_rec",
  textRecognitionModelAsset: { url: publicModels.rec },
  textDetectionBatchSize: 1,
  textRecognitionBatchSize: 6,
  textDetLimitSideLen: candidate.textDetectionLimitSideLen ?? 960,
  textDetLimitType: "max" as const,
  textDetBoxThresh: candidate.textDetectionBoxThreshold ?? 0.6,
  textRecScoreThresh: 0,
  ortOptions: {
    backend: "wasm" as const,
    wasmPaths: "/node_modules/onnxruntime-web/dist/",
    numThreads: 1,
    simd: true,
  },
});

const heapBytes = (): number | null => {
  const memory = (performance as Performance & { memory?: { usedJSHeapSize?: number } }).memory;
  return typeof memory?.usedJSHeapSize === "number" ? memory.usedJSHeapSize : null;
};

const serializableLine = (line: ReceiptBandObservation) => ({
  text: line.text,
  confidence: line.confidence,
  bbox: line.bbox,
  polygon: line.polygon,
  bandIndex: line.bandIndex,
  bandTop: line.bandTop,
  bandBottom: line.bandBottom,
  observationKey: line.observationKey,
});

const serializableField = (field: ReceiptBandExtraction["fields"][keyof ReceiptBandExtraction["fields"]], includeValue: boolean) => ({
  ...(includeValue ? { value: field.value, evidence: field.evidence } : {}),
  ...(("presence" in field) ? { presence: field.presence } : {}),
  confidence: field.confidence,
  status: field.status,
  source: field.source,
  supportBandCount: field.supportBandCount,
  independentObservationCount: field.independentObservationCount,
  trustedSupportCount: field.trustedSupportCount,
  agreement: field.agreement,
  competingValueCount: field.competingValueCount,
});

const serializableExtraction = (extraction: ReceiptBandExtraction, includeValues: boolean) => ({
  fields: Object.fromEntries(Object.entries(extraction.fields).map(([field, value]) => [field, serializableField(value, includeValues)])),
  unresolvedFields: extraction.unresolvedFields,
  deduplication: extraction.deduplication,
  bandResults: extraction.bandResults.map((band) => ({
    bandIndex: band.bandIndex,
    observationKey: band.observationKey,
    unresolvedFields: band.unresolvedFields,
    fields: Object.fromEntries(Object.entries(band.fields).map(([field, value]) => [field, serializableField(value as ReceiptBandExtraction["fields"][keyof ReceiptBandExtraction["fields"]], includeValues)])),
  })),
});

const run = async () => {
  const beforeInit = performance.now();
  const { PaddleOCR } = await import("@paddleocr/paddleocr-js");
  const ocr = await PaddleOCR.create(paddleOptions(config));
  const initializationMs = performance.now() - beforeInit;
  const entries = await sourceEntries();
  const includeValues = dataset === "sroie";
  const rows: Array<Record<string, unknown>> = [];
  const inferenceTimes: number[] = [];
  const preparationTimes: number[] = [];
  let completed = 0;
  try {
    for (const entry of entries) {
      const started = performance.now();
      let image: HTMLImageElement | undefined;
      const observations: ReceiptBandObservation[] = [];
      let dimensions: ImageDimensions = { width: 0, height: 0 };
      let bands: ReceiptHorizontalBand[] = [];
      let ocrError = false;
      let preparationMs = 0;
      let engineMs: number | null = null;
      let heapBefore: number | null = heapBytes();
      try {
        image = await loadImage(entry.url);
        dimensions = imageDimensions(image);
        const preparationStarted = performance.now();
        bands = createHorizontalBands(dimensions.width, dimensions.height, config);
        const inputs = bands.map((band) => renderInput(
          image as HTMLImageElement,
          dimensions,
          band,
          config,
          band.index,
          `${config.name}:band:${band.index}`,
        ));
        if (config.includeWholeImage) {
          inputs.unshift(renderInput(
            image as HTMLImageElement,
            dimensions,
            { index: -1, top: 0, bottom: dimensions.height, height: dimensions.height, width: dimensions.width },
            config,
            -1,
            `${config.name}:whole`,
          ));
        }
        preparationMs = performance.now() - preparationStarted;
        preparationTimes.push(preparationMs);
        const recognition = await ocr.predict(inputs.map((input) => input.canvas));
        const outputResults = Array.isArray(recognition) ? recognition : [];
        const elapsed = performance.now() - started;
        inferenceTimes.push(elapsed - preparationMs);
        outputResults.forEach((result, index) => {
          const input = inputs[index];
          if (!input) return;
          const lines = receiptOcrLinesFromPaddleItems(result?.items).map((line: ReceiptModernOcrLine) => (
            mapReceiptBandLineToSource(line, input.bandTop, input.scale)
          ));
          observations.push(...lines.map((line) => ({
            ...line,
            bandIndex: input.bandIndex,
            bandTop: input.bandTop,
            bandBottom: input.bandBottom,
            observationKey: input.observationKey,
          })));
          if (result?.metrics?.totalMs !== undefined) engineMs = Number(result.metrics.totalMs);
        });
        // Release references as soon as the model has consumed the canvases.
        inputs.forEach((input) => { input.canvas.width = 1; input.canvas.height = 1; });
        heapBefore = heapBytes();
      } catch {
        ocrError = true;
      }
      const extraction = extractReceiptFieldsFromPpocrV6Bands(observations, {
        selector: config.selector,
        minIndependentBands: config.minIndependentBands,
      });
      const row: Record<string, unknown> = {
        id: entry.id,
        category: entry.category ?? undefined,
        config: config.name,
        bandCount: bands.length,
        includeWholeImage: config.includeWholeImage,
        ocrError,
        durationMs: performance.now() - started,
        engineMs,
        preparationMs,
        lineCount: observations.length,
        mergedLineCount: extraction.mergedLines.length,
        heapBefore,
        heapAfter: heapBytes(),
        extraction: serializableExtraction(extraction, includeValues),
      };
      if (includeValues) {
        row.observations = observations.map(serializableLine);
        row.mergedLines = extraction.mergedLines.map((line) => ({
          text: line.text,
          confidence: line.confidence,
          bbox: line.bbox,
          supportCount: line.supportCount,
          independentBandCount: line.independentBandCount,
          sourceBands: line.sourceBands,
          supportTextVariants: line.supportTextVariants,
        }));
      }
      rows.push(row);
      completed += 1;
      if (completed % 10 === 1) console.log(`band OCR ${config.name} ${dataset}/${subset} ${completed}/${entries.length}`);
    }
  } finally {
    await ocr.dispose();
  }
  const sorted = [...inferenceTimes].sort((left, right) => left - right);
  return {
    dataset,
    subset,
    config,
    sampleSize: entries.length,
    model: RECEIPT_MODERN_OCR_ENGINES.find((engine) => engine.name === "paddleocr-js-ppocrv6-tiny"),
    initializationMs,
    inferenceMs: {
      mean: inferenceTimes.reduce((sum, value) => sum + value, 0) / Math.max(1, inferenceTimes.length),
      median: sorted[Math.floor(sorted.length / 2)] ?? 0,
      p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0,
    },
    preparationMs: {
      mean: preparationTimes.reduce((sum, value) => sum + value, 0) / Math.max(1, preparationTimes.length),
    },
    rows,
  };
};

try {
  if (output) output.textContent = JSON.stringify(await run());
} catch (error) {
  if (output) output.textContent = JSON.stringify({ error: String(error) });
}
