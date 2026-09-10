import {
  buildAdaptiveExpertCrops,
  classifyReceiptBands,
  extractReceiptFieldsFromHierarchicalBands,
  hierarchicalModelInfo,
  RECEIPT_HIERARCHICAL_EXPERIMENTAL_CONFIG,
  RECEIPT_HIERARCHICAL_SCREENING_CONFIGS,
  type ReceiptExpertCrop,
  type ReceiptHierarchicalConfig,
  type ReceiptHierarchicalExtraction,
  type ReceiptHierarchicalObservation,
  type ReceiptRouterBandInput,
} from "@/lib/receiptHierarchicalBandOcr";
import {
  createHorizontalBands,
  mapReceiptBandLineToSource,
  RECEIPT_BAND_SCREENING_CONFIGS,
  type ReceiptBandConfig,
  type ReceiptHorizontalBand,
} from "@/lib/receiptBandOcr";
import { preprocessReceiptPixels } from "@/lib/receiptOcr";
import { RECEIPT_MODERN_OCR_ENGINES, receiptOcrLinesFromPaddleItems, type ReceiptModernOcrLine } from "@/lib/receiptModernOcr";

type Dataset = "sroie" | "production";
const params = new URLSearchParams(window.location.search);
const dataset = (params.get("dataset") ?? "sroie") as Dataset;
const subset = params.get("subset") ?? "all";
const limit = Number(params.get("limit") ?? "0");
const requestedConfig = params.get("config") ?? RECEIPT_HIERARCHICAL_EXPERIMENTAL_CONFIG.name;
const config = RECEIPT_HIERARCHICAL_SCREENING_CONFIGS.find((candidate) => candidate.name === requestedConfig) ?? RECEIPT_HIERARCHICAL_EXPERIMENTAL_CONFIG;
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
    return manifest.map((entry) => ({ id: String(entry.filename), url: `/benchmarks/real-receipts/${encodeURIComponent(String(entry.filename))}`, category: /walmart/i.test(String(entry.vendor ?? "")) ? "walmart" : "other" }));
  }
  const ids = Array.from({ length: 500 }, (_, index) => index).filter((index) => subset === "all" || splitFor(index) === subset);
  return (limit > 0 ? ids.slice(0, limit) : ids).map((index) => ({ id: String(index).padStart(3, "0"), url: `/benchmarks/sroie500/images/${String(index).padStart(3, "0")}.jpg` }));
};

interface ImageDimensions { width: number; height: number; }
interface PreparedInput { canvas: HTMLCanvasElement; scale: number; top: number; bottom: number; bandIndex: number; observationKey: string; }

const loadImage = async (url: string): Promise<HTMLImageElement> => {
  const image = new Image();
  await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error(`Unable to decode ${url}`)); image.src = url; });
  return image;
};

const dims = (image: HTMLImageElement): ImageDimensions => ({ width: image.naturalWidth || image.width, height: image.naturalHeight || image.height });

const firstPassConfig = (): ReceiptBandConfig => ({
  ...RECEIPT_BAND_SCREENING_CONFIGS.find((candidate) => candidate.name === (config.firstPassConfigName ?? "fraction40-overlap40-contrast-2200-rules-hybrid")) ?? RECEIPT_BAND_SCREENING_CONFIGS[0],
  name: `hierarchical-first-pass-${config.name}`,
  includeWholeImage: false,
});

const inputScale = (width: number, height: number, candidate: ReceiptBandConfig): number => Math.max(0.25, Math.min(Math.max(0.25, candidate.maxScale), candidate.maxDimension / Math.max(1, width, height)));

const renderBand = (image: HTMLImageElement, dimensions: ImageDimensions, top: number, bottom: number, width: number, candidate: ReceiptBandConfig, bandIndex: number, observationKey: string): PreparedInput => {
  const sourceHeight = Math.max(1, bottom - top);
  const scale = inputScale(width, sourceHeight, candidate);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas 2D context unavailable");
  context.drawImage(image, 0, top, dimensions.width, sourceHeight, 0, 0, canvas.width, canvas.height);
  if (candidate.preprocessing !== "original") {
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    pixels.data.set(preprocessReceiptPixels(pixels.data, canvas.width, canvas.height, candidate.preprocessing));
    context.putImageData(pixels, 0, 0);
  }
  return { canvas, scale, top, bottom, bandIndex, observationKey };
};

const renderExpert = (image: HTMLImageElement, dimensions: ImageDimensions, crop: ReceiptExpertCrop, candidate: ReceiptBandConfig, preprocessing = candidate.preprocessing): PreparedInput => renderBand(image, dimensions, crop.top, crop.bottom, dimensions.width, { ...candidate, preprocessing }, crop.sourceBandIndex, crop.cropId);

const paddleOptions = (candidate: ReceiptBandConfig) => ({
  textDetectionModelName: "PP-OCRv6_tiny_det",
  textDetectionModelAsset: { url: publicModels.det },
  textRecognitionModelName: "PP-OCRv6_tiny_rec",
  textRecognitionModelAsset: { url: publicModels.rec },
  textDetectionBatchSize: 1,
  textRecognitionBatchSize: 6,
  textDetLimitSideLen: candidate.textDetectionLimitSideLen ?? 1280,
  textDetLimitType: "max" as const,
  textDetBoxThresh: candidate.textDetectionBoxThreshold ?? 0.6,
  textRecScoreThresh: 0,
  ortOptions: { backend: "wasm" as const, wasmPaths: "/node_modules/onnxruntime-web/dist/", numThreads: 1, simd: true },
});

const heapBytes = (): number | null => {
  const memory = (performance as Performance & { memory?: { usedJSHeapSize?: number } }).memory;
  return typeof memory?.usedJSHeapSize === "number" ? memory.usedJSHeapSize : null;
};

const serializableLine = (line: ReceiptHierarchicalObservation) => ({ text: line.text, confidence: line.confidence, bbox: line.bbox, polygon: line.polygon, bandIndex: line.bandIndex, bandTop: line.bandTop, bandBottom: line.bandBottom, observationKey: line.observationKey, sourcePass: line.sourcePass, expertCategory: line.expertCategory, cropId: line.cropId, routerProbability: line.routerProbability });
const serializableExtraction = (extraction: ReceiptHierarchicalExtraction, includeValues: boolean) => ({
  fields: Object.fromEntries(Object.entries(extraction.fields).map(([field, value]) => [field, includeValues ? value : { confidence: value.confidence, status: value.status, source: value.source, supportBandCount: value.supportBandCount, independentObservationCount: value.independentObservationCount, routedSupportCount: value.routedSupportCount }])),
  specialists: Object.fromEntries(Object.entries(extraction.specialists).map(([field, value]) => [field, includeValues ? value : { confidence: value.confidence, status: value.status, supportBandCount: value.supportBandCount, independentObservationCount: value.independentObservationCount }])),
  unresolvedFields: extraction.unresolvedFields,
  routing: extraction.routing,
  deduplication: extraction.deduplication,
  funnel: extraction.funnel,
  routerPredictions: extraction.routerPredictions.map((prediction) => ({ bandIndex: prediction.bandIndex, top: prediction.top, bottom: prediction.bottom, probabilities: prediction.probabilities, rankingScores: prediction.rankingScores, routes: prediction.routes, dominantCategory: prediction.dominantCategory, lineCount: prediction.lineCount })),
  expertCrops: extraction.expertCrops.map((crop) => ({ cropId: crop.cropId, category: crop.category, mode: crop.mode, top: crop.top, bottom: crop.bottom, height: crop.height, routerProbability: crop.routerProbability, sourceBandIndex: crop.sourceBandIndex, sourceBandIndices: crop.sourceBandIndices })),
});

const run = async () => {
  const candidate = firstPassConfig();
  const beforeInit = performance.now();
  const { PaddleOCR } = await import("@paddleocr/paddleocr-js");
  const ocr = await PaddleOCR.create(paddleOptions(candidate));
  const initializationMs = performance.now() - beforeInit;
  const entries = await sourceEntries();
  const includeValues = dataset === "sroie";
  const rows: Array<Record<string, unknown>> = [];
  const firstPassTimes: number[] = [];
  const expertTimes: number[] = [];
  const totalTimes: number[] = [];
  const preparationTimes: number[] = [];
  let completed = 0;
  try {
    for (const entry of entries) {
      const started = performance.now();
      const firstPassObservations: ReceiptHierarchicalObservation[] = [];
      const expertObservations: ReceiptHierarchicalObservation[] = [];
      let image: HTMLImageElement | undefined;
      let dimensions: ImageDimensions = { width: 0, height: 0 };
      let firstBands: ReceiptHorizontalBand[] = [];
      let crops: ReceiptExpertCrop[] = [];
      let predictions = [] as ReturnType<typeof classifyReceiptBands>;
      let ocrError = false;
      let preparationMs = 0;
      let firstPassMs = 0;
      let expertMs = 0;
      let specialistViewInvocations = 0;
      let specialistCropsSkippedEarly = 0;
      const heapBefore = heapBytes();
      try {
        image = await loadImage(entry.url);
        dimensions = dims(image);
        const prepStarted = performance.now();
        firstBands = createHorizontalBands(dimensions.width, dimensions.height, candidate);
        const firstInputs = firstBands.map((band) => renderBand(image as HTMLImageElement, dimensions, band.top, band.bottom, band.width, candidate, band.index, `first:${config.name}:band:${band.index}`));
        preparationMs += performance.now() - prepStarted;
        const firstStarted = performance.now();
        const firstResults = await ocr.predict(firstInputs.map((input) => input.canvas));
        firstPassMs = performance.now() - firstStarted;
        (Array.isArray(firstResults) ? firstResults : []).forEach((result, index) => {
          const input = firstInputs[index];
          if (!input) return;
          const lines = receiptOcrLinesFromPaddleItems(result?.items).map((line: ReceiptModernOcrLine) => mapReceiptBandLineToSource(line, input.top, input.scale));
          firstPassObservations.push(...lines.map((line) => ({ ...line, bandIndex: input.bandIndex, bandTop: input.top, bandBottom: input.bottom, observationKey: input.observationKey, sourcePass: "first-pass" as const })));
        });
        const routerBands: ReceiptRouterBandInput[] = firstBands.map((band) => ({
          bandIndex: band.index,
          observationKey: `first:${config.name}:band:${band.index}`,
          top: band.top,
          bottom: band.bottom,
          width: dimensions.width,
          height: band.height,
          lines: firstPassObservations.filter((line) => line.observationKey === `first:${config.name}:band:${band.index}`),
        }));
        predictions = classifyReceiptBands(routerBands, config);
        crops = buildAdaptiveExpertCrops(routerBands, predictions, config);
        const expertStarted = performance.now();
        const trustedCategories = new Set<string>();
        const fieldForCategory: Record<string, string | undefined> = { vendor: "vendor", purchase_date: "purchase_date", subtotal: "subtotal", tax: "tax", total: "total" };
        const views = config.expertPreprocessingVariants?.length ? [...config.expertPreprocessingVariants] : [candidate.preprocessing];
        const byCategory = new Map<string, ReceiptExpertCrop[]>();
        crops.forEach((crop) => byCategory.set(crop.category, [...(byCategory.get(crop.category) ?? []), crop]));
        const categoryOrder = ["vendor", "purchase_date", "subtotal", "tax", "total", "receipt_id", "item"];
        const processExpertBatch = async (batch: ReceiptExpertCrop[]) => {
          if (!batch.length) return;
          const prepBatchStarted = performance.now();
          const expertInputs = batch.flatMap((crop) => views.map((view) => renderExpert(image as HTMLImageElement, dimensions, crop, candidate, view)));
          preparationMs += performance.now() - prepBatchStarted;
          const expertResults = expertInputs.length ? await ocr.predict(expertInputs.map((input) => input.canvas)) : [];
          specialistViewInvocations += expertInputs.length;
          (Array.isArray(expertResults) ? expertResults : []).forEach((result, index) => {
            const input = expertInputs[index];
            const crop = batch[Math.floor(index / views.length)];
            if (!input || !crop) return;
            const lines = receiptOcrLinesFromPaddleItems(result?.items).map((line: ReceiptModernOcrLine) => mapReceiptBandLineToSource(line, input.top, input.scale));
            // All preprocessing views of one crop retain the same observation
            // identity. They can corroborate text, but cannot manufacture an
            // independent agreement vote.
            expertObservations.push(...lines.map((line) => ({ ...line, bandIndex: crop.sourceBandIndex, bandTop: crop.top, bandBottom: crop.bottom, observationKey: crop.cropId, sourcePass: "expert" as const, expertCategory: crop.category, cropId: crop.cropId, routerProbability: crop.routerProbability })));
          });
          expertInputs.forEach((input) => { input.canvas.width = 1; input.canvas.height = 1; });
        };
        for (const category of categoryOrder) {
          const categoryCrops = byCategory.get(category) ?? [];
          if (!categoryCrops.length) continue;
          if (!config.earlyStopTrustedFields) {
            await processExpertBatch(categoryCrops);
            continue;
          }
          if (trustedCategories.has(category)) {
            specialistCropsSkippedEarly += categoryCrops.length;
            continue;
          }
          await processExpertBatch(categoryCrops.slice(0, 1));
          const interim = extractReceiptFieldsFromHierarchicalBands(firstPassObservations, expertObservations, { config, routerPredictions: predictions, expertCrops: crops, pageWidth: dimensions.width, pageHeight: dimensions.height });
          const field = fieldForCategory[category];
          const trusted = field ? interim.fields[field as keyof typeof interim.fields].status === "trusted" : interim.specialists[category as "receipt_id" | "item"].status === "trusted";
          if (trusted) {
            trustedCategories.add(category);
            specialistCropsSkippedEarly += Math.max(0, categoryCrops.length - 1);
          } else await processExpertBatch(categoryCrops.slice(1));
        }
        expertMs = performance.now() - expertStarted;
        [...firstInputs].forEach((input) => { input.canvas.width = 1; input.canvas.height = 1; });
      } catch {
        ocrError = true;
      }
      firstPassTimes.push(firstPassMs);
      expertTimes.push(expertMs);
      preparationTimes.push(preparationMs);
      const extraction = extractReceiptFieldsFromHierarchicalBands(firstPassObservations, expertObservations, { config, routerPredictions: predictions, expertCrops: crops, pageWidth: dimensions.width || undefined, pageHeight: dimensions.height || undefined });
      const totalMs = performance.now() - started;
      totalTimes.push(totalMs);
      const row: Record<string, unknown> = { id: entry.id, category: entry.category, config: config.name, ocrError, durationMs: totalMs, firstPassMs, expertMs, preparationMs, firstPassOcrInvocations: firstBands.length, specialistCropsProposed: crops.length, specialistInvocations: Math.max(0, crops.length - specialistCropsSkippedEarly), specialistViewInvocations, specialistCropsSkippedEarly, firstPassLineCount: firstPassObservations.length, expertLineCount: expertObservations.length, heapBefore, heapAfter: heapBytes(), extraction: serializableExtraction(extraction, includeValues) };
      if (includeValues) { row.firstPassObservations = firstPassObservations.map(serializableLine); row.expertObservations = expertObservations.map(serializableLine); }
      rows.push(row);
      completed += 1;
      if (completed % 10 === 1) console.log(`hierarchical OCR ${config.name} ${dataset}/${subset} ${completed}/${entries.length}`);
    }
  } finally { await ocr.dispose(); }
  const summary = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b); return { mean: values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length), median: sorted[Math.floor(sorted.length / 2)] ?? 0, p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0 }; };
  return { dataset, subset, config, firstPass: candidate, sampleSize: entries.length, model: RECEIPT_MODERN_OCR_ENGINES.find((engine) => engine.name === "paddleocr-js-ppocrv6-tiny"), hierarchicalModel: hierarchicalModelInfo(), initializationMs, firstPassMs: summary(firstPassTimes), expertMs: summary(expertTimes), preparationMs: summary(preparationTimes), totalMs: summary(totalTimes), rows };
};

try { if (output) output.textContent = JSON.stringify(await run()); } catch (error) { if (output) output.textContent = JSON.stringify({ error: String(error) }); }
