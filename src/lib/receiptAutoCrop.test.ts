import { afterEach, describe, expect, it, vi } from "vitest";
import {
  autoCropReceiptImage,
  calculateReceiptCrop,
  calculateReceiptCropWithSideMarginGuard,
  detectReceiptCorners,
  RECEIPT_ALREADY_CROPPED_MARGIN,
  RECEIPT_BOTTOM_SAFETY_MARGIN,
  RECEIPT_CROP_BASELINE_OPTIONS,
  RECEIPT_CROP_MARGIN,
  RECEIPT_CROP_DETECTOR_OPTIONS,
  hasPotentialReceiptContentBelowCrop,
} from "@/lib/receiptAutoCrop";
import type { ReceiptCorners } from "@/lib/receiptAutoCrop";

const makeImageData = (width: number, height: number, rectangle?: { left: number; top: number; right: number; bottom: number }) => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const bright = rectangle
        && x >= rectangle.left
        && x <= rectangle.right
        && y >= rectangle.top
        && y <= rectangle.bottom;
      const value = bright ? 255 : 25;
      const offset = (y * width + x) * 4;
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
      data[offset + 3] = 255;
    }
  }
  return { width, height, data } as ImageData;
};

const makePolygonImageData = (width: number, height: number, polygon: Array<{ x: number; y: number }>) => {
  const data = new Uint8ClampedArray(width * height * 4);
  const isInside = (x: number, y: number) => {
    let inside = false;
    for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
      const currentPoint = polygon[index];
      const previousPoint = polygon[previous];
      const intersects = ((currentPoint.y > y) !== (previousPoint.y > y))
        && x < (previousPoint.x - currentPoint.x) * (y - currentPoint.y) / (previousPoint.y - currentPoint.y) + currentPoint.x;
      if (intersects) inside = !inside;
    }
    return inside;
  };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = isInside(x + 0.5, y + 0.5) ? 255 : 25;
      const offset = (y * width + x) * 4;
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
      data[offset + 3] = 255;
    }
  }
  return { width, height, data } as ImageData;
};

const makeValueImageData = (
  width: number,
  height: number,
  rectangle: { left: number; top: number; right: number; bottom: number },
  background: number,
  foreground: number,
) => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const inside = x >= rectangle.left && x <= rectangle.right && y >= rectangle.top && y <= rectangle.bottom;
      const value = inside ? foreground : background;
      const offset = (y * width + x) * 4;
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
      data[offset + 3] = 255;
    }
  }
  return { width, height, data } as ImageData;
};

describe("receipt auto-cropping", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("detects an obvious four-corner receipt and applies 4% outward padding", () => {
    const detection = detectReceiptCorners(makeImageData(400, 300, { left: 80, top: 60, right: 319, bottom: 239 }));
    expect(detection?.confidence).toBeGreaterThanOrEqual(0.72);
    expect(detection?.corners).toEqual({
      topLeft: { x: 80, y: 60 },
      topRight: { x: 319, y: 60 },
      bottomRight: { x: 319, y: 239 },
      bottomLeft: { x: 80, y: 239 },
    });

    const crop = calculateReceiptCrop(detection!.corners, 400, 300);
    const detectedWidth = 319 - 80;
    const detectedHeight = 239 - 60;
    expect(crop).toEqual({
      left: Math.floor(80 - detectedWidth * RECEIPT_CROP_MARGIN),
      top: Math.floor(60 - detectedHeight * RECEIPT_CROP_MARGIN),
      right: Math.ceil(319 + detectedWidth * RECEIPT_CROP_MARGIN),
      bottom: Math.ceil(239 + detectedHeight * RECEIPT_CROP_MARGIN),
    });
  });

  it("keeps the shipped baseline available for apples-to-apples benchmark runs", () => {
    const detection = detectReceiptCorners(
      makeImageData(400, 300, { left: 80, top: 60, right: 319, bottom: 239 }),
      RECEIPT_CROP_BASELINE_OPTIONS,
    );
    expect(detection?.confidence).toBeGreaterThanOrEqual(RECEIPT_CROP_BASELINE_OPTIONS.minConfidence);
    expect(RECEIPT_CROP_BASELINE_OPTIONS.thresholdOffsets).toEqual([0]);
    expect(RECEIPT_CROP_BASELINE_OPTIONS.morphologyRadius).toBe(0);
  });

  it("can score a subtle dark receipt against a light frame without weakening geometry gates", () => {
    const detection = detectReceiptCorners(
      makeValueImageData(400, 300, { left: 80, top: 60, right: 319, bottom: 239 }, 220, 216),
      { ...RECEIPT_CROP_DETECTOR_OPTIONS, polarity: "both", darkBrightnessDelta: 1 },
    );
    expect(detection).not.toBeNull();
    expect(detection!.confidence).toBeGreaterThanOrEqual(RECEIPT_CROP_DETECTOR_OPTIONS.minConfidence);
  });

  it("uses the bounded closing pass to bridge a one-pixel shadow seam", () => {
    const image = makeValueImageData(400, 300, { left: 80, top: 60, right: 319, bottom: 239 }, 25, 255);
    for (let x = 80; x <= 319; x += 1) {
      const offset = (150 * image.width + x) * 4;
      image.data[offset] = 25;
      image.data[offset + 1] = 25;
      image.data[offset + 2] = 25;
    }
    const baseline = detectReceiptCorners(image, RECEIPT_CROP_BASELINE_OPTIONS);
    const improved = detectReceiptCorners(image, RECEIPT_CROP_DETECTOR_OPTIONS);
    expect(baseline?.corners.bottomLeft.y).toBeLessThan(160);
    expect(improved?.corners.bottomLeft.y).toBeGreaterThan(230);
  });

  it("accepts long narrow receipts and maps analysis coordinates to full resolution", async () => {
    const bitmap = { width: 2000, height: 1000, close: vi.fn() } as unknown as ImageBitmap;
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue(bitmap));
    const analysisContext = {
      drawImage: vi.fn(),
      getImageData: vi.fn(() => makeImageData(800, 400, { left: 300, top: 20, right: 499, bottom: 379 })),
    };
    const cropContext = { drawImage: vi.fn() };
    const canvases: HTMLCanvasElement[] = [];
    const createElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(((tagName: string, options?: ElementCreationOptions) => {
      const element = createElement(tagName, options);
      if (tagName === "canvas") {
        canvases.push(element as HTMLCanvasElement);
        vi.spyOn(element as HTMLCanvasElement, "getContext").mockReturnValue(
          canvases.length === 1 ? analysisContext as unknown as CanvasRenderingContext2D : cropContext as unknown as CanvasRenderingContext2D,
        );
        vi.spyOn(element as HTMLCanvasElement, "toBlob").mockImplementation((callback: BlobCallback) => {
          callback(new Blob(["cropped"], { type: "image/jpeg" }));
        });
      }
      return element;
    }) as typeof document.createElement);

    const input = new File(["source"], "receipt.jpg", { type: "image/jpeg" });
    const output = await autoCropReceiptImage(input);

    expect(output).not.toBe(input);
    expect(output.type).toBe("image/jpeg");
    expect(cropContext.drawImage).toHaveBeenCalledWith(bitmap, 730, 0, 538, 1000, 0, 0, 538, 1000);
    expect(bitmap.close).toHaveBeenCalledTimes(1);
  });

  it("uses an enclosing axis-aligned crop for an angled receipt without warping", () => {
    const detection = detectReceiptCorners(makePolygonImageData(400, 340, [
      { x: 105, y: 80 },
      { x: 315, y: 55 },
      { x: 345, y: 260 },
      { x: 75, y: 285 },
    ]));
    expect(detection?.confidence).toBeGreaterThanOrEqual(0.72);
    const crop = calculateReceiptCrop(detection!.corners, 400, 340);
    expect(crop).toEqual({
      left: 64,
      top: 48,
      right: 350,
      bottom: 294,
    });
  });

  it("leaves an image unchanged when all detected margins are already within 6%", async () => {
    const bitmap = { width: 800, height: 400, close: vi.fn() } as unknown as ImageBitmap;
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue(bitmap));
    const analysisContext = {
      drawImage: vi.fn(),
      getImageData: vi.fn(() => makeImageData(800, 400, { left: 30, top: 24, right: 770, bottom: 376 })),
    };
    const createElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(((tagName: string, options?: ElementCreationOptions) => {
      const element = createElement(tagName, options);
      if (tagName === "canvas") vi.spyOn(element as HTMLCanvasElement, "getContext").mockReturnValue(analysisContext as unknown as CanvasRenderingContext2D);
      return element;
    }) as typeof document.createElement);

    const input = new File(["source"], "receipt.webp", { type: "image/webp" });
    const output = await autoCropReceiptImage(input);

    expect(RECEIPT_ALREADY_CROPPED_MARGIN).toBe(0.06);
    expect(output).toBe(input);
    expect(bitmap.close).toHaveBeenCalledTimes(1);
  });

  const cornersFromMargins = (margins: { left: number; right: number; top: number; bottom: number }): ReceiptCorners => ({
    topLeft: { x: margins.left * 1000, y: margins.top * 1000 },
    topRight: { x: (1 - margins.right) * 1000, y: margins.top * 1000 },
    bottomRight: { x: (1 - margins.right) * 1000, y: (1 - margins.bottom) * 1000 },
    bottomLeft: { x: margins.left * 1000, y: (1 - margins.bottom) * 1000 },
  });

  it("keeps the bottom edge when the detected paper is within the asymmetric safety margin", () => {
    expect(calculateReceiptCropWithSideMarginGuard(cornersFromMargins({ left: 0.04, right: 0.05, top: 0.04, bottom: 0.12 }), 1000, 1000)).toBeNull();
    expect(RECEIPT_BOTTOM_SAFETY_MARGIN).toBe(0.15);
  });

  it("crops only one qualifying horizontal side", () => {
    expect(calculateReceiptCropWithSideMarginGuard(cornersFromMargins({ left: 0.12, right: 0.04, top: 0.04, bottom: 0.05 }), 1000, 1000)).toEqual({
      left: 86,
      top: 0,
      right: 1000,
      bottom: 1000,
    });
  });

  it("crops multiple qualifying sides while preserving the others", () => {
    expect(calculateReceiptCropWithSideMarginGuard(cornersFromMargins({ left: 0.12, right: 0.04, top: 0.04, bottom: 0.12 }), 1000, 1000)).toEqual({
      left: 86,
      top: 0,
      right: 1000,
      bottom: 1000,
    });
  });

  it("preserves a side at exactly the 6% threshold", () => {
    expect(calculateReceiptCropWithSideMarginGuard(cornersFromMargins({ left: 0.06, right: 0.1, top: 0.1, bottom: 0.1 }), 1000, 1000)).toEqual({
      left: 0,
      top: 68,
      right: 934,
      bottom: 1000,
    });
  });

  it("detects an edge-touching side and still crops the eligible opposite side", () => {
    const detection = detectReceiptCorners(makeImageData(400, 300, { left: 0, top: 30, right: 339, bottom: 269 }));
    expect(detection).not.toBeNull();
    const crop = calculateReceiptCropWithSideMarginGuard(detection!.corners, 400, 300);
    expect(crop?.left).toBe(0);
    expect(crop?.right).toBeLessThan(400);
    expect(crop?.top).toBeLessThan(30);
    expect(crop?.bottom).toBeGreaterThan(269);
  });

  it("preserves two edge-touching sides while cropping only the other eligible sides", () => {
    const detection = detectReceiptCorners(makeImageData(400, 300, { left: 0, top: 0, right: 339, bottom: 269 }));
    expect(detection).not.toBeNull();
    const crop = calculateReceiptCropWithSideMarginGuard(cornersFromMargins({ left: 0, right: 0.15, top: 0, bottom: 0.18 }), 1000, 1000);
    expect(crop).toEqual({
      left: 0,
      top: 0,
      right: 884,
      bottom: 853,
    });
  });

  it("fails open when dark receipt content is visible below the proposed crop", () => {
    const image = makeValueImageData(100, 100, { left: 20, top: 10, right: 79, bottom: 89 }, 25, 230);
    for (let y = 90; y < 100; y += 1) {
      for (let x = 30; x < 70; x += 1) {
        const offset = (y * image.width + x) * 4;
        image.data[offset] = 40;
        image.data[offset + 1] = 40;
        image.data[offset + 2] = 40;
      }
    }
    expect(hasPotentialReceiptContentBelowCrop(image, { left: 15, top: 5, right: 85, bottom: 88 }, {
      topLeft: { x: 20, y: 10 },
      topRight: { x: 79, y: 10 },
      bottomRight: { x: 79, y: 89 },
      bottomLeft: { x: 20, y: 89 },
    })).toBe(true);
  });

  it("rejects a small lower connected component instead of cropping to it", () => {
    const image = makeValueImageData(200, 400, { left: 80, top: 300, right: 119, bottom: 350 }, 25, 230);
    expect(detectReceiptCorners(image)).toBeNull();
  });

  it("leaves the original unchanged when corners are missing or geometry is invalid", async () => {
    expect(detectReceiptCorners(makeImageData(400, 300))).toBeNull();
    const invalid = calculateReceiptCrop({
      topLeft: { x: 100, y: 100 },
      topRight: { x: 300, y: 300 },
      bottomRight: { x: 100, y: 300 },
      bottomLeft: { x: 300, y: 100 },
    }, 400, 400);
    expect(invalid).toBeNull();

    const input = new File(["source"], "receipt.jpg", { type: "image/jpeg" });
    vi.stubGlobal("createImageBitmap", undefined);
    vi.stubGlobal("URL", {});
    await expect(autoCropReceiptImage(input)).resolves.toBe(input);
  });
});
