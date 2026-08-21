import { afterEach, describe, expect, it, vi } from "vitest";
import {
  autoCropReceiptImage,
  calculateReceiptCrop,
  detectReceiptCorners,
  RECEIPT_CROP_MARGIN,
} from "@/lib/receiptAutoCrop";

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
    expect(cropContext.drawImage).toHaveBeenCalledWith(bitmap, 730, 14, 538, 970, 0, 0, 538, 970);
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
