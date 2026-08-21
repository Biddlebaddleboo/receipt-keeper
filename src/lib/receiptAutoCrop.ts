export const RECEIPT_CROP_ANALYSIS_MAX_DIMENSION = 800;
export const RECEIPT_CROP_MARGIN = 0.04;
export const RECEIPT_ALREADY_CROPPED_MARGIN = 0.06;

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

/**
 * Conservative bright-paper detector. It deliberately rejects low-contrast,
 * edge-touching, fragmented, or nearly full-frame candidates.
 */
export const detectReceiptCorners = (imageData: ImageData): ReceiptCornerDetection | null => {
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
  const threshold = clamp(Math.max(180, borderMedian + 25), 180, 250);
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = luminance(data, (y * width + x) * 4);
      if (value >= threshold) {
        const index = y * width + x;
        mask[index] = 1;
        if (borderPixels(x, y)) borderBrightCount += 1;
      }
    }
  }
  if (borderBrightCount / borderCount > 0.45) return null;

  const visited = new Uint8Array(mask.length);
  let bestPixels: number[] = [];
  let bestCount = 0;
  let bestLeft = 0;
  let bestTop = 0;
  let bestRight = 0;
  let bestBottom = 0;

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

    if (pixels.length > bestCount) {
      bestPixels = pixels;
      bestCount = pixels.length;
      bestLeft = left;
      bestTop = top;
      bestRight = right;
      bestBottom = bottom;
    }
  }

  const boxWidth = bestRight - bestLeft + 1;
  const boxHeight = bestBottom - bestTop + 1;
  const boxArea = boxWidth * boxHeight;
  const imageArea = width * height;
  const fillRatio = boxArea ? bestCount / boxArea : 0;
  const areaRatio = imageArea ? boxArea / imageArea : 0;
  const edgeMargin = Math.max(2, Math.round(Math.min(width, height) * 0.015));
  const touchesEdge = bestLeft <= edgeMargin || bestTop <= edgeMargin || bestRight >= width - 1 - edgeMargin || bestBottom >= height - 1 - edgeMargin;
  if (!bestCount || touchesEdge || fillRatio < 0.45 || areaRatio < 0.02 || areaRatio > 0.92) return null;

  const confidence = Math.min(1, fillRatio * 0.65 + Math.min(1, (threshold - borderMedian) / 100) * 0.35);
  const targets = [
    { x: bestLeft, y: bestTop },
    { x: bestRight, y: bestTop },
    { x: bestRight, y: bestBottom },
    { x: bestLeft, y: bestBottom },
  ];
  const nearestDistances = targets.map((target) => {
    let nearest = Number.POSITIVE_INFINITY;
    for (const index of bestPixels) {
      const x = index % width;
      const y = Math.floor(index / width);
      nearest = Math.min(nearest, Math.hypot(x - target.x, y - target.y));
    }
    return nearest;
  });
  const diagonal = Math.max(1, Math.hypot(boxWidth, boxHeight));
  const cornerConfidence = Math.min(...nearestDistances.map((distance) => Math.max(0, 1 - distance / diagonal)));
  if (cornerConfidence < 0.55 || confidence < 0.72) return null;

  const cornerPoints = targets.map((target) => {
    let nearestIndex = bestPixels[0];
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const index of bestPixels) {
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

  // These points are used only to find an enclosing rectangle. No warp or
  // perspective correction is applied, which is safest for angled receipts.
  return {
    corners: {
      topLeft: cornerPoints[0],
      topRight: cornerPoints[1],
      bottomRight: cornerPoints[2],
      bottomLeft: cornerPoints[3],
    },
    confidence: confidence * 0.75 + cornerConfidence * 0.25,
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
