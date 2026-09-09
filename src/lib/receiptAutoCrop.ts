export const RECEIPT_CROP_ANALYSIS_MAX_DIMENSION = 800;
export const RECEIPT_CROP_MARGIN = 0.04;
export const RECEIPT_ALREADY_CROPPED_MARGIN = 0.06;

/**
 * The detector is intentionally configurable so offline benchmark runs can
 * compare conservative classical-CV configurations without copying the
 * production implementation. These options are all inexpensive operations
 * on the analysis-sized image and are safe to expose as a browser API.
 */
export interface ReceiptCropDetectorOptions {
  minimumBrightness: number;
  brightnessDelta: number;
  darkBrightnessDelta: number;
  thresholdOffsets: number[];
  polarity: "bright" | "both";
  morphologyRadius: number;
  borderCandidateRejectRatio: number;
  minFillRatio: number;
  minAreaRatio: number;
  maxAreaRatio: number;
  minCornerConfidence: number;
  minConfidence: number;
  minScore: number;
}

/** Exact settings for the detector that shipped before the benchmark work. */
export const RECEIPT_CROP_BASELINE_OPTIONS: ReceiptCropDetectorOptions = {
  minimumBrightness: 180,
  brightnessDelta: 25,
  darkBrightnessDelta: 25,
  thresholdOffsets: [0],
  polarity: "bright",
  morphologyRadius: 0,
  borderCandidateRejectRatio: 0.45,
  minFillRatio: 0.45,
  minAreaRatio: 0.02,
  maxAreaRatio: 0.92,
  minCornerConfidence: 0.55,
  minConfidence: 0.72,
  minScore: 0,
};

/**
 * Selected after the offline validation sweep. It remains deliberately
 * conservative: the extra recall comes from threshold diversity and a small
 * closing operation, while geometry and confidence gates stay strict.
 */
export const RECEIPT_CROP_DETECTOR_OPTIONS: ReceiptCropDetectorOptions = {
  minimumBrightness: 180,
  brightnessDelta: 16,
  darkBrightnessDelta: 1,
  thresholdOffsets: [-10, 0, 10],
  polarity: "bright",
  morphologyRadius: 1,
  borderCandidateRejectRatio: 0.45,
  minFillRatio: 0.48,
  minAreaRatio: 0.02,
  maxAreaRatio: 0.92,
  minCornerConfidence: 0.55,
  minConfidence: 0.74,
  minScore: 0.66,
};

export interface ReceiptCorner {
  x: number;
  y: number;
}

export interface ReceiptCorners {
  topLeft: ReceiptCorner;
  topRight: ReceiptCorner;
  bottomRight: ReceiptCorner;
  bottomLeft: ReceiptCorner;
}

export interface ReceiptCropRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface DecodedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  cleanup: () => void;
}

interface ReceiptCornerDetection {
  corners: ReceiptCorners;
  confidence: number;
}

const imageTypePattern = /^image\//i;

const decodeWithImageBitmap = async (blob: Blob): Promise<DecodedImage | null> => {
  const decoder = globalThis.createImageBitmap;
  if (typeof decoder !== "function") return null;

  const bitmap = await decoder(blob);
  return {
    source: bitmap,
    width: bitmap.width,
    height: bitmap.height,
    cleanup: () => bitmap.close?.(),
  };
};

const decodeWithImageElement = async (blob: Blob): Promise<DecodedImage> => {
  if (typeof document === "undefined" || typeof URL.createObjectURL !== "function") {
    throw new Error("Native image decoding is unavailable");
  }

  const objectUrl = URL.createObjectURL(blob);
  const image = document.createElement("img");
  image.decoding = "async";

  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Browser could not decode the image"));
      image.src = objectUrl;
    });

    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    if (!width || !height) throw new Error("Decoded image has no dimensions");

    return {
      source: image,
      width,
      height,
      cleanup: () => {
        image.onload = null;
        image.onerror = null;
        image.removeAttribute("src");
        URL.revokeObjectURL(objectUrl);
      },
    };
  } catch (error) {
    image.onload = null;
    image.onerror = null;
    image.removeAttribute("src");
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
};

const decodeImage = async (blob: Blob): Promise<DecodedImage> => {
  try {
    const decoded = await decodeWithImageBitmap(blob);
    if (decoded) return decoded;
  } catch {
    // The image element fallback below is intentionally the next and final
    // decoding attempt. Auto-cropping fails open if both are unavailable.
  }
  return decodeWithImageElement(blob);
};

const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value));

const cross = (a: ReceiptCorner, b: ReceiptCorner, c: ReceiptCorner) =>
  (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);

const isConvexCornerOrder = (corners: ReceiptCorners): boolean => {
  const ordered = [corners.topLeft, corners.topRight, corners.bottomRight, corners.bottomLeft];
  const crossProducts = ordered.map((corner, index) => cross(corner, ordered[(index + 1) % ordered.length], ordered[(index + 2) % ordered.length]));
  if (crossProducts.some((value) => !Number.isFinite(value) || Math.abs(value) < 1)) return false;
  const positive = crossProducts.every((value) => value > 0);
  const negative = crossProducts.every((value) => value < 0);
  return positive || negative;
};

/** Calculate a padded, clamped crop rectangle from full-resolution corners. */
export const calculateReceiptCrop = (
  corners: ReceiptCorners,
  sourceWidth: number,
  sourceHeight: number,
): ReceiptCropRect | null => {
  if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) || sourceWidth <= 1 || sourceHeight <= 1) return null;
  const points = [corners.topLeft, corners.topRight, corners.bottomRight, corners.bottomLeft];
  if (points.some((point) =>
    !Number.isFinite(point.x)
    || !Number.isFinite(point.y)
    || point.x < 0
    || point.x > sourceWidth
    || point.y < 0
    || point.y > sourceHeight
  )) return null;
  if (!isConvexCornerOrder(corners)) return null;

  const left = Math.min(...points.map((point) => point.x));
  const right = Math.max(...points.map((point) => point.x));
  const top = Math.min(...points.map((point) => point.y));
  const bottom = Math.max(...points.map((point) => point.y));
  const width = right - left;
  const height = bottom - top;
  if (width < 2 || height < 2) return null;

  const paddingX = width * RECEIPT_CROP_MARGIN;
  const paddingY = height * RECEIPT_CROP_MARGIN;
  const crop = {
    left: Math.max(0, Math.floor(left - paddingX)),
    top: Math.max(0, Math.floor(top - paddingY)),
    right: Math.min(sourceWidth, Math.ceil(right + paddingX)),
    bottom: Math.min(sourceHeight, Math.ceil(bottom + paddingY)),
  };
  if (crop.right - crop.left >= sourceWidth && crop.bottom - crop.top >= sourceHeight) return null;
  if (crop.right - crop.left < 2 || crop.bottom - crop.top < 2) return null;
  return crop;
};

/**
 * Apply the already-cropped guard independently to each image side. A side
 * with little remaining background keeps the original edge, while qualifying
 * sides retain the normal padded detected boundary.
 */
export const calculateReceiptCropWithSideMarginGuard = (
  corners: ReceiptCorners,
  sourceWidth: number,
  sourceHeight: number,
): ReceiptCropRect | null => {
  const paddedCrop = calculateReceiptCrop(corners, sourceWidth, sourceHeight);
  if (!paddedCrop) return null;

  const points = [corners.topLeft, corners.topRight, corners.bottomRight, corners.bottomLeft];
  const detectedLeft = Math.min(...points.map((point) => point.x));
  const detectedRight = Math.max(...points.map((point) => point.x));
  const detectedTop = Math.min(...points.map((point) => point.y));
  const detectedBottom = Math.max(...points.map((point) => point.y));
  const margins = {
    left: detectedLeft / sourceWidth,
    right: (sourceWidth - detectedRight) / sourceWidth,
    top: detectedTop / sourceHeight,
    bottom: (sourceHeight - detectedBottom) / sourceHeight,
  };
  const crop = {
    left: margins.left <= RECEIPT_ALREADY_CROPPED_MARGIN ? 0 : paddedCrop.left,
    top: margins.top <= RECEIPT_ALREADY_CROPPED_MARGIN ? 0 : paddedCrop.top,
    right: margins.right <= RECEIPT_ALREADY_CROPPED_MARGIN ? sourceWidth : paddedCrop.right,
    bottom: margins.bottom <= RECEIPT_ALREADY_CROPPED_MARGIN ? sourceHeight : paddedCrop.bottom,
  };
  if (crop.right - crop.left >= sourceWidth && crop.bottom - crop.top >= sourceHeight) return null;
  if (crop.right - crop.left < 2 || crop.bottom - crop.top < 2) return null;
  return crop;
};

const luminance = (data: Uint8ClampedArray, index: number) =>
  Math.round(0.2126 * data[index] + 0.7152 * data[index + 1] + 0.0722 * data[index + 2]);

const medianFromHistogram = (histogram: Uint32Array, count: number): number => {
  let cumulative = 0;
  const midpoint = Math.floor(count / 2);
  for (let value = 0; value < histogram.length; value += 1) {
    cumulative += histogram[value];
    if (cumulative > midpoint) return value;
  }
  return 0;
};

const closeBinaryMask = (mask: Uint8Array, width: number, height: number, radius: number): Uint8Array => {
  if (radius <= 0) return mask;
  const dilated = new Uint8Array(mask.length);
  const closed = new Uint8Array(mask.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let on = false;
      for (let offsetY = -radius; offsetY <= radius && !on; offsetY += 1) {
        for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
          const nextX = x + offsetX;
          const nextY = y + offsetY;
          if (nextX >= 0 && nextX < width && nextY >= 0 && nextY < height && mask[nextY * width + nextX]) {
            on = true;
            break;
          }
        }
      }
      dilated[y * width + x] = on ? 1 : 0;
    }
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let on = true;
      for (let offsetY = -radius; offsetY <= radius && on; offsetY += 1) {
        for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
          const nextX = x + offsetX;
          const nextY = y + offsetY;
          if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height || !dilated[nextY * width + nextX]) {
            on = false;
            break;
          }
        }
      }
      closed[y * width + x] = on ? 1 : 0;
    }
  }
  return closed;
};

interface ReceiptCandidate {
  pixels: number[];
  left: number;
  top: number;
  right: number;
  bottom: number;
  fillRatio: number;
  areaRatio: number;
  cornerConfidence: number;
  contrast: number;
  score: number;
}

const isLegacyBaselineOptions = (options: ReceiptCropDetectorOptions) =>
  options.minimumBrightness === 180
  && options.brightnessDelta === 25
  && options.thresholdOffsets.length === 1
  && options.thresholdOffsets[0] === 0
  && options.polarity === "bright"
  && options.morphologyRadius === 0
  && options.minFillRatio === 0.45
  && options.minAreaRatio === 0.02
  && options.maxAreaRatio === 0.92
  && options.minCornerConfidence === 0.55
  && options.minConfidence === 0.72
  && options.minScore === 0;

const findCandidate = (
  mask: Uint8Array,
  imageData: ImageData,
  borderMedian: number,
  threshold: number,
  polarity: "bright" | "dark",
  options: ReceiptCropDetectorOptions,
): ReceiptCandidate | null => {
  const { width, height, data } = imageData;
  const visited = new Uint8Array(mask.length);
  const imageArea = width * height;
  let best: ReceiptCandidate | null = null;
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || visited[start]) continue;
    const queue = [start];
    const pixels: number[] = [];
    visited[start] = 1;
    let left = width;
    let top = height;
    let right = 0;
    let bottom = 0;
    while (queue.length) {
      const index = queue.pop()!;
      pixels.push(index);
      const x = index % width;
      const y = Math.floor(index / width);
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          if (!offsetX && !offsetY) continue;
          const nextX = x + offsetX;
          const nextY = y + offsetY;
          if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) continue;
          const next = nextY * width + nextX;
          if (mask[next] && !visited[next]) {
            visited[next] = 1;
            queue.push(next);
          }
        }
      }
    }

    const boxWidth = right - left + 1;
    const boxHeight = bottom - top + 1;
    const boxArea = boxWidth * boxHeight;
    const fillRatio = boxArea ? pixels.length / boxArea : 0;
    const areaRatio = imageArea ? boxArea / imageArea : 0;
    if (!pixels.length || fillRatio < options.minFillRatio || areaRatio < options.minAreaRatio || areaRatio > options.maxAreaRatio) continue;

    const borderDistance = Math.min(left, top, width - 1 - right, height - 1 - bottom);
    const borderPenalty = borderDistance === 0 ? 0.02 : 0;
    const contrast = Math.min(1, Math.abs(threshold - borderMedian) / 80);
    const targets = [
      { x: left, y: top },
      { x: right, y: top },
      { x: right, y: bottom },
      { x: left, y: bottom },
    ];
    const nearestDistances = targets.map((target) => {
      let nearest = Number.POSITIVE_INFINITY;
      for (const index of pixels) {
        const x = index % width;
        const y = Math.floor(index / width);
        nearest = Math.min(nearest, Math.hypot(x - target.x, y - target.y));
      }
      return nearest;
    });
    const diagonal = Math.max(1, Math.hypot(boxWidth, boxHeight));
    const cornerConfidence = Math.min(...nearestDistances.map((distance) => Math.max(0, 1 - distance / diagonal)));
    if (cornerConfidence < options.minCornerConfidence) continue;

    let interiorTotal = 0;
    let interiorCount = 0;
    const insetX = Math.max(1, Math.round(boxWidth * 0.1));
    const insetY = Math.max(1, Math.round(boxHeight * 0.1));
    for (let y = top + insetY; y <= bottom - insetY; y += 1) {
      for (let x = left + insetX; x <= right - insetX; x += 1) {
        interiorTotal += luminance(data, (y * width + x) * 4);
        interiorCount += 1;
      }
    }
    const interiorMean = interiorCount ? interiorTotal / interiorCount : threshold;
    const interiorContrast = Math.min(1, Math.abs(interiorMean - borderMedian) / 80);
    const score = fillRatio * 0.38 + cornerConfidence * 0.28 + contrast * 0.16 + interiorContrast * 0.18 - borderPenalty;
    const candidate = { pixels, left, top, right, bottom, fillRatio, areaRatio, cornerConfidence, contrast, score };
    const useLegacyLargestComponent = isLegacyBaselineOptions(options);
    if (!best || (useLegacyLargestComponent
      ? candidate.pixels.length > best.pixels.length
      : candidate.score > best.score || (candidate.score === best.score && candidate.pixels.length > best.pixels.length))) best = candidate;
  }
  return best;
};

/**
 * Conservative classical document detector. It evaluates a few brightness
 * hypotheses and selects the strongest geometrically plausible component.
 * No learned model or perspective warp is used; uncertain cases return null.
 */
export const detectReceiptCorners = (
  imageData: ImageData,
  options: ReceiptCropDetectorOptions = RECEIPT_CROP_DETECTOR_OPTIONS,
): ReceiptCornerDetection | null => {
  const { width, height, data } = imageData;
  if (!width || !height || data.length < width * height * 4) return null;
  const borderDepth = Math.max(1, Math.round(Math.min(width, height) * 0.05));
  const borderHistogram = new Uint32Array(256);
  let borderCount = 0;
  let borderBrightCount = 0;
  const borderPixels = (x: number, y: number) =>
    x < borderDepth || y < borderDepth || x >= width - borderDepth || y >= height - borderDepth;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!borderPixels(x, y)) continue;
      const value = luminance(data, (y * width + x) * 4);
      borderHistogram[value] += 1;
      borderCount += 1;
    }
  }
  if (!borderCount) return null;
  const borderMedian = medianFromHistogram(borderHistogram, borderCount);
  const baseThreshold = clamp(Math.max(options.minimumBrightness, borderMedian + options.brightnessDelta), 0, 250);
  const candidates: ReceiptCandidate[] = [];
  for (const offset of options.thresholdOffsets) {
    const brightThreshold = clamp(baseThreshold + offset, 0, 250);
    const brightMask = new Uint8Array(width * height);
    for (let index = 0; index < width * height; index += 1) {
      const value = luminance(data, index * 4);
      if (value >= brightThreshold) {
        brightMask[index] = 1;
        const x = index % width;
        const y = Math.floor(index / width);
        if (borderPixels(x, y)) borderBrightCount += 1;
      }
    }
    const brightCandidate = findCandidate(closeBinaryMask(brightMask, width, height, options.morphologyRadius), imageData, borderMedian, brightThreshold, "bright", options);
    if (brightCandidate) candidates.push(brightCandidate);
    if (options.polarity === "both") {
      const darkThreshold = clamp(borderMedian - options.darkBrightnessDelta - offset, 5, 250);
      const darkMask = new Uint8Array(width * height);
      for (let index = 0; index < width * height; index += 1) {
        if (luminance(data, index * 4) <= darkThreshold) darkMask[index] = 1;
      }
      const darkCandidate = findCandidate(closeBinaryMask(darkMask, width, height, options.morphologyRadius), imageData, borderMedian, darkThreshold, "dark", options);
      if (darkCandidate) candidates.push(darkCandidate);
    }
  }
  if (!candidates.length || borderBrightCount / (borderCount * Math.max(1, options.thresholdOffsets.length)) > options.borderCandidateRejectRatio) return null;
  const best = candidates.reduce((current, candidate) => candidate.score > current.score ? candidate : current);
  if (best.score < options.minScore) return null;
  const confidence = isLegacyBaselineOptions(options)
    ? Math.min(1, best.fillRatio * 0.65 + Math.min(1, best.contrast * 0.8) * 0.35)
    : Math.min(1, best.fillRatio * 0.55 + best.cornerConfidence * 0.25 + best.contrast * 0.10 + Math.min(1, best.contrast + best.fillRatio * 0.05) * 0.10);
  if (best.cornerConfidence < options.minCornerConfidence || confidence < options.minConfidence) return null;
  const targets = [
    { x: best.left, y: best.top },
    { x: best.right, y: best.top },
    { x: best.right, y: best.bottom },
    { x: best.left, y: best.bottom },
  ];
  const cornerPoints = targets.map((target) => {
    let nearestIndex = best.pixels[0];
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const index of best.pixels) {
      const x = index % width;
      const y = Math.floor(index / width);
      const distance = Math.hypot(x - target.x, y - target.y);
      if (distance < nearestDistance) {
        nearestIndex = index;
        nearestDistance = distance;
      }
    }
    return { x: nearestIndex % width, y: Math.floor(nearestIndex / width) };
  });
  return {
    corners: {
      topLeft: cornerPoints[0],
      topRight: cornerPoints[1],
      bottomRight: cornerPoints[2],
      bottomLeft: cornerPoints[3],
    },
    confidence: confidence * 0.75 + best.cornerConfidence * 0.25,
  };
};

const canvasToBlob = (canvas: HTMLCanvasElement): Promise<Blob | null> => new Promise((resolve) => {
  try {
    canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.98);
  } catch {
    resolve(null);
  }
});

/** Crop a receipt only when the conservative detector has a strong candidate. */
export const autoCropReceiptImage = async (file: File): Promise<File> => {
  if (!imageTypePattern.test(file.type)) return file;

  let decoded: DecodedImage | null = null;
  let analysisCanvas: HTMLCanvasElement | null = null;
  let cropCanvas: HTMLCanvasElement | null = null;
  try {
    decoded = await decodeImage(file);
    if (decoded.width <= 1 || decoded.height <= 1) return file;

    const analysisScale = Math.min(1, RECEIPT_CROP_ANALYSIS_MAX_DIMENSION / Math.max(decoded.width, decoded.height));
    const analysisWidth = Math.max(1, Math.round(decoded.width * analysisScale));
    const analysisHeight = Math.max(1, Math.round(decoded.height * analysisScale));
    analysisCanvas = document.createElement("canvas");
    analysisCanvas.width = analysisWidth;
    analysisCanvas.height = analysisHeight;
    const analysisContext = analysisCanvas.getContext("2d");
    if (!analysisContext) return file;
    analysisContext.drawImage(decoded.source, 0, 0, analysisWidth, analysisHeight);
    const detection = detectReceiptCorners(analysisContext.getImageData(0, 0, analysisWidth, analysisHeight));
    if (!detection || detection.confidence < 0.72) return file;

    const mappedCorners = Object.fromEntries(
      Object.entries(detection.corners).map(([name, point]) => [name, {
        x: point.x / analysisWidth * decoded!.width,
        y: point.y / analysisHeight * decoded!.height,
      }]),
    ) as unknown as ReceiptCorners;
    const crop = calculateReceiptCropWithSideMarginGuard(mappedCorners, decoded.width, decoded.height);
    if (!crop) return file;

    cropCanvas = document.createElement("canvas");
    cropCanvas.width = crop.right - crop.left;
    cropCanvas.height = crop.bottom - crop.top;
    const cropContext = cropCanvas.getContext("2d");
    if (!cropContext) return file;
    cropContext.drawImage(
      decoded.source,
      crop.left,
      crop.top,
      crop.right - crop.left,
      crop.bottom - crop.top,
      0,
      0,
      crop.right - crop.left,
      crop.bottom - crop.top,
    );
    const croppedBlob = await canvasToBlob(cropCanvas);
    if (!croppedBlob) return file;
    const baseName = file.name.replace(/\.[^.]+$/, "") || "receipt";
    return new File([croppedBlob], `${baseName}.jpg`, { type: "image/jpeg", lastModified: file.lastModified });
  } catch {
    return file;
  } finally {
    decoded?.cleanup();
    if (analysisCanvas) {
      analysisCanvas.width = 0;
      analysisCanvas.height = 0;
    }
    if (cropCanvas) {
      cropCanvas.width = 0;
      cropCanvas.height = 0;
    }
  }
};
