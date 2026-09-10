/**
 * Browser-only OCR preparation and strategy helpers.
 *
 * This module deliberately contains no receipt-field business rules. It is
 * responsible for making inexpensive image variants, asking Tesseract for
 * text/layout data, and mapping boxes back to the source image. Keeping the
 * OCR pass separate lets the benchmark compare a candidate against the exact
 * production control without changing field trust decisions.
 */

export interface ReceiptOcrBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface ReceiptOcrWord {
  text: string;
  confidence?: number;
  bbox?: ReceiptOcrBox;
}

export interface ReceiptOcrLine {
  text: string;
  confidence?: number;
  bbox?: ReceiptOcrBox;
  /** Optional source polygon retained by modern OCR adapters. */
  polygon?: Array<[number, number]>;
  words?: ReceiptOcrWord[];
}

type TesseractWordData = {
  text?: string;
  confidence?: number;
  bbox?: ReceiptOcrBox;
};

type TesseractLineData = TesseractWordData & {
  words?: TesseractWordData[];
};

type TesseractData = {
  text?: string;
  lines?: TesseractLineData[];
  blocks?: Array<{
    paragraphs?: Array<{
      lines?: TesseractLineData[];
    }>;
  }>;
};

/**
 * Extract line and word geometry from Tesseract's blocks output. Some
 * Tesseract builds omit blocks for an empty/failed page, so the direct lines
 * array is a safe fallback.
 */
export const receiptOcrLinesFromTesseractData = (data: unknown): ReceiptOcrLine[] => {
  const typed = (data as TesseractData | null) ?? {};
  const blockLines = (typed.blocks ?? []).flatMap((block) => (block.paragraphs ?? [])
    .flatMap((paragraph) => paragraph.lines ?? []));
  const sourceLines = blockLines.length ? blockLines : typed.lines ?? [];
  return sourceLines.map((line) => {
    const result: ReceiptOcrLine = { text: line.text ?? "" };
    if (line.confidence !== undefined) result.confidence = line.confidence;
    if (line.bbox) result.bbox = line.bbox;
    if (line.words) {
      result.words = line.words.map((word) => {
        const mapped: ReceiptOcrWord = { text: word.text ?? "" };
        if (word.confidence !== undefined) mapped.confidence = word.confidence;
        if (word.bbox) mapped.bbox = word.bbox;
        return mapped;
      });
    }
    return result;
  });
};

export const receiptOcrTextFromLines = (lines: ReceiptOcrLine[]): string => lines
  .map((line) => line.text.replace(/[|¦]/g, " ").replace(/\s+/g, " ").trim())
  .filter(Boolean)
  .join("\n");

export type ReceiptOcrPreprocessing = "original" | "contrast" | "adaptive" | "sharpen";

export interface ReceiptOcrRegion {
  name: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ReceiptOcrStrategy {
  name: string;
  preprocessing: ReceiptOcrPreprocessing;
  /** Maximum long-side pixels for a transformed canvas. */
  maxDimension?: number;
  /** Small receipts benefit from modest upscaling; large images are capped. */
  maxScale?: number;
  /** Tesseract page segmentation mode. Omitted for the exact baseline control. */
  pageSegMode?: string;
  /** Let Tesseract estimate a small page skew before recognition. */
  rotateAuto?: boolean;
  /** Fail open instead of allowing a stalled WASM job to block the capture flow. */
  timeoutMs?: number;
  /** Optional normalized rectangle, evaluated against the source/analysis image. */
  region?: ReceiptOcrRegion;
}

export interface ReceiptOcrPass {
  strategy: string;
  region: string;
  text: string;
  lines: ReceiptOcrLine[];
  meanConfidence: number;
  durationMs: number;
  sourceWidth?: number;
  sourceHeight?: number;
  analysisWidth?: number;
  analysisHeight?: number;
}

export interface ReceiptOcrWorker {
  recognize: (
    image: unknown,
    options?: Record<string, unknown>,
    output?: Record<string, boolean>,
  ) => Promise<{ data?: unknown }>;
}

/** This is intentionally equivalent to the current production call. */
export const RECEIPT_OCR_BASELINE_STRATEGY: ReceiptOcrStrategy = {
  name: "baseline",
  preprocessing: "original",
};

/**
 * The selected whole-image pass after the offline validation/full-corpus
 * benchmark. It keeps the capture path to one OCR call and never depends on a
 * cropped or field-specific region.
 */
export const RECEIPT_OCR_LIVE_STRATEGY: ReceiptOcrStrategy = {
  name: "sharpen-upscale",
  preprocessing: "sharpen",
  maxDimension: 2800,
  maxScale: 1.5,
  pageSegMode: "6",
  rotateAuto: true,
};

/**
 * Candidate strategies used by the offline benchmark. They are intentionally
 * small and composable: each adds one plausible improvement so regressions
 * can be attributed instead of hidden in a large preprocessing chain.
 */
export const RECEIPT_OCR_SCREENING_STRATEGIES: ReceiptOcrStrategy[] = [
  RECEIPT_OCR_BASELINE_STRATEGY,
  {
    name: "deskew",
    preprocessing: "original",
    rotateAuto: true,
  },
  {
    name: "contrast",
    preprocessing: "contrast",
    maxDimension: 2800,
    maxScale: 1.5,
    pageSegMode: "6",
  },
  {
    name: "contrast-lite",
    preprocessing: "contrast",
    maxDimension: 2200,
    maxScale: 1.25,
    pageSegMode: "6",
  },
  {
    name: "adaptive",
    preprocessing: "adaptive",
    maxDimension: 2400,
    maxScale: 1.35,
    pageSegMode: "6",
  },
  {
    name: "sharpen-upscale",
    preprocessing: "sharpen",
    maxDimension: 2800,
    maxScale: 1.5,
    pageSegMode: "6",
    rotateAuto: true,
  },
  {
    name: "single-column",
    preprocessing: "contrast",
    maxDimension: 2800,
    maxScale: 1.5,
    pageSegMode: "4",
    rotateAuto: true,
  },
  {
    name: "sparse-text",
    preprocessing: "contrast",
    maxDimension: 2800,
    maxScale: 1.5,
    pageSegMode: "11",
    rotateAuto: true,
  },
  {
    name: "targeted-footer",
    preprocessing: "contrast",
    maxDimension: 2800,
    maxScale: 1.5,
    pageSegMode: "6",
    region: { name: "footer", left: 0, top: 0.68, width: 1, height: 0.32 },
  },
  {
    name: "targeted-financial",
    preprocessing: "contrast",
    maxDimension: 2800,
    maxScale: 1.5,
    pageSegMode: "6",
    region: { name: "financial", left: 0, top: 0.42, width: 1, height: 0.38 },
  },
  {
    name: "targeted-top",
    preprocessing: "contrast",
    maxDimension: 2800,
    maxScale: 1.5,
    pageSegMode: "6",
    region: { name: "top", left: 0, top: 0, width: 1, height: 0.34 },
  },
];

interface PreparedImage {
  image: Blob | string | HTMLCanvasElement;
  sourceWidth?: number;
  sourceHeight?: number;
  analysisWidth?: number;
  analysisHeight?: number;
  scaleX: number;
  scaleY: number;
}

const clampByte = (value: number): number => Math.max(0, Math.min(255, Math.round(value)));

const percentileFromHistogram = (histogram: number[], total: number, percentile: number): number => {
  const target = Math.max(0, Math.min(total - 1, Math.floor(total * percentile)));
  let seen = 0;
  for (let index = 0; index < histogram.length; index += 1) {
    seen += histogram[index];
    if (seen > target) return index;
  }
  return histogram.length - 1;
};

const toLuminance = (red: number, green: number, blue: number): number => (
  0.2126 * red + 0.7152 * green + 0.0722 * blue
);

const normalizeContrast = (gray: Uint8Array): Uint8Array => {
  const histogram = new Array<number>(256).fill(0);
  gray.forEach((value) => { histogram[value] += 1; });
  const low = percentileFromHistogram(histogram, gray.length, 0.02);
  const high = percentileFromHistogram(histogram, gray.length, 0.98);
  if (high - low < 24) return gray.slice();
  const scale = 255 / (high - low);
  return Uint8Array.from(gray, (value) => clampByte((value - low) * scale));
};

const sharpenGray = (gray: Uint8Array, width: number, height: number): Uint8Array => {
  const output = gray.slice();
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      const blur = (gray[index - 1] + gray[index + 1] + gray[index - width] + gray[index + width]) / 4;
      output[index] = clampByte(gray[index] + 0.7 * (gray[index] - blur));
    }
  }
  return output;
};

/**
 * Tile-adaptive thresholding avoids a single global threshold destroying
 * text under a phone shadow. Tiles are deliberately coarse to keep this
 * O(pixels) with no large integral-image allocation on mobile devices.
 */
const adaptiveThreshold = (gray: Uint8Array, width: number, height: number): Uint8Array => {
  const output = new Uint8Array(gray.length);
  const tileSize = 32;
  for (let tileTop = 0; tileTop < height; tileTop += tileSize) {
    for (let tileLeft = 0; tileLeft < width; tileLeft += tileSize) {
      const right = Math.min(width, tileLeft + tileSize);
      const bottom = Math.min(height, tileTop + tileSize);
      let sum = 0;
      let count = 0;
      for (let y = tileTop; y < bottom; y += 1) {
        for (let x = tileLeft; x < right; x += 1) {
          sum += gray[y * width + x];
          count += 1;
        }
      }
      const mean = sum / Math.max(1, count);
      const threshold = mean - Math.max(12, Math.min(42, mean * 0.18));
      for (let y = tileTop; y < bottom; y += 1) {
        for (let x = tileLeft; x < right; x += 1) {
          output[y * width + x] = gray[y * width + x] < threshold ? 0 : 255;
        }
      }
    }
  }
  return output;
};

/**
 * Apply one browser-safe preprocessing mode to RGBA pixels. Exporting this
 * pure boundary keeps the pixel transform unit-testable without requiring a
 * real camera or Tesseract worker.
 */
export const preprocessReceiptPixels = (
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  preprocessing: ReceiptOcrPreprocessing,
): Uint8ClampedArray => {
  if (preprocessing === "original") return pixels.slice();
  const gray = new Uint8Array(width * height);
  for (let index = 0; index < gray.length; index += 1) {
    const pixel = index * 4;
    gray[index] = clampByte(toLuminance(pixels[pixel], pixels[pixel + 1], pixels[pixel + 2]));
  }
  const contrasted = normalizeContrast(gray);
  const processed = preprocessing === "adaptive"
    ? adaptiveThreshold(contrasted, width, height)
    : preprocessing === "sharpen"
      ? sharpenGray(contrasted, width, height)
      : contrasted;
  const output = new Uint8ClampedArray(pixels.length);
  for (let index = 0; index < processed.length; index += 1) {
    const pixel = index * 4;
    output[pixel] = processed[index];
    output[pixel + 1] = processed[index];
    output[pixel + 2] = processed[index];
    output[pixel + 3] = 255;
  }
  return output;
};

const makeProcessedCanvas = (
  image: HTMLImageElement,
  strategy: ReceiptOcrStrategy,
): { canvas: HTMLCanvasElement; width: number; height: number; sourceWidth: number; sourceHeight: number } => {
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const naturalLongSide = Math.max(sourceWidth, sourceHeight);
  const maxDimension = strategy.maxDimension ?? naturalLongSide;
  const maxScale = strategy.maxScale ?? 1;
  // Respect the long-side cap for high-resolution camera frames. Small images
  // may be enlarged by maxScale, but large images are never kept above the
  // configured mobile-friendly analysis size.
  const scale = Math.min(maxScale, maxDimension / Math.max(1, naturalLongSide));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas 2D context unavailable");
  context.drawImage(image, 0, 0, width, height);

  if (strategy.preprocessing === "original") {
    return { canvas, width, height, sourceWidth, sourceHeight };
  }

  const imageData = context.getImageData(0, 0, width, height);
  imageData.data.set(preprocessReceiptPixels(imageData.data, width, height, strategy.preprocessing));
  context.putImageData(imageData, 0, 0);
  return { canvas, width, height, sourceWidth, sourceHeight };
};

const loadImage = async (source: Blob | string): Promise<HTMLImageElement> => {
  const image = new Image();
  const objectUrl = typeof source === "string" ? null : URL.createObjectURL(source);
  try {
    const loaded = new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Unable to decode receipt image"));
    });
    image.src = objectUrl ?? source;
    await loaded;
    return image;
  } finally {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
};

const prepareImage = async (source: Blob | string, strategy: ReceiptOcrStrategy): Promise<PreparedImage> => {
  const needsCanvas = strategy.preprocessing !== "original" || strategy.maxDimension !== undefined;
  if (!needsCanvas) {
    if (!strategy.region) return { image: source, scaleX: 1, scaleY: 1 };
    const image = await loadImage(source);
    return {
      image: source,
      sourceWidth: image.naturalWidth || image.width,
      sourceHeight: image.naturalHeight || image.height,
      scaleX: 1,
      scaleY: 1,
    };
  }
  const image = await loadImage(source);
  const processed = makeProcessedCanvas(image, strategy);
  return {
    image: processed.canvas,
    sourceWidth: processed.sourceWidth,
    sourceHeight: processed.sourceHeight,
    analysisWidth: processed.width,
    analysisHeight: processed.height,
    scaleX: processed.width / Math.max(1, processed.sourceWidth),
    scaleY: processed.height / Math.max(1, processed.sourceHeight),
  };
};

const mapBoxToSource = (box: ReceiptOcrBox | undefined, prepared: PreparedImage): ReceiptOcrBox | undefined => {
  if (!box) return undefined;
  return {
    x0: box.x0 / prepared.scaleX,
    y0: box.y0 / prepared.scaleY,
    x1: box.x1 / prepared.scaleX,
    y1: box.y1 / prepared.scaleY,
  };
};

const mapLineToSource = (line: ReceiptOcrLine, prepared: PreparedImage): ReceiptOcrLine => ({
  ...line,
  bbox: mapBoxToSource(line.bbox, prepared),
  words: line.words?.map((word) => ({ ...word, bbox: mapBoxToSource(word.bbox, prepared) })),
});

const meanConfidence = (lines: ReceiptOcrLine[]): number => {
  const values = lines.map((line) => line.confidence).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
};

const normalizedRectangle = (region: ReceiptOcrRegion | undefined, prepared: PreparedImage): Record<string, number> | undefined => {
  if (!region || !prepared.analysisWidth || !prepared.analysisHeight) return undefined;
  return {
    left: Math.max(0, Math.round(region.left * prepared.analysisWidth)),
    top: Math.max(0, Math.round(region.top * prepared.analysisHeight)),
    width: Math.max(1, Math.round(region.width * prepared.analysisWidth)),
    height: Math.max(1, Math.round(region.height * prepared.analysisHeight)),
  };
};

/** Run one named strategy and map all returned geometry back to source pixels. */
export const recognizeReceiptOcrPass = async (
  worker: ReceiptOcrWorker,
  source: Blob | string,
  strategy: ReceiptOcrStrategy,
): Promise<ReceiptOcrPass> => {
  const started = Date.now();
  const prepared = await prepareImage(source, strategy);
  const options: Record<string, unknown> = {};
  const rectangle = normalizedRectangle(strategy.region, prepared);
  if (rectangle) options.rectangle = rectangle;
  if (strategy.pageSegMode) options.tessedit_pageseg_mode = strategy.pageSegMode;
  if (strategy.rotateAuto) options.rotateAuto = true;
  const recognition = worker.recognize(prepared.image, options, { blocks: true });
  const timeoutMs = strategy.timeoutMs ?? 45_000;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(`OCR strategy timed out: ${strategy.name}`)), timeoutMs);
  });
  let recognized: { data?: unknown };
  try {
    recognized = await Promise.race([recognition, timedOut]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
  const data = (recognized.data ?? {}) as TesseractData;
  const lines = receiptOcrLinesFromTesseractData(data).map((line) => mapLineToSource(line, prepared));
  return {
    strategy: strategy.name,
    region: strategy.region?.name ?? "full",
    text: data.text ?? receiptOcrTextFromLines(lines),
    lines,
    meanConfidence: meanConfidence(lines),
    durationMs: Date.now() - started,
    sourceWidth: prepared.sourceWidth,
    sourceHeight: prepared.sourceHeight,
    analysisWidth: prepared.analysisWidth,
    analysisHeight: prepared.analysisHeight,
  };
};
