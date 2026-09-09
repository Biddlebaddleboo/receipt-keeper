import { describe, expect, it, vi } from "vitest";
import {
  RECEIPT_OCR_BASELINE_STRATEGY,
  RECEIPT_OCR_LIVE_STRATEGY,
  RECEIPT_OCR_SCREENING_STRATEGIES,
  preprocessReceiptPixels,
  recognizeReceiptOcrPass,
  receiptOcrLinesFromTesseractData,
  receiptOcrTextFromLines,
} from "@/lib/receiptOcr";

describe("receipt OCR strategy helpers", () => {
  it("keeps line and word boxes from block OCR output", () => {
    const lines = receiptOcrLinesFromTesseractData({
      blocks: [{ paragraphs: [{ lines: [{
        text: "TOTAL 21.46",
        confidence: 94,
        bbox: { x0: 4, y0: 8, x1: 80, y1: 20 },
        words: [{ text: "TOTAL", confidence: 96, bbox: { x0: 4, y0: 8, x1: 35, y1: 20 } }],
      }] }] }],
    });
    expect(lines[0]).toEqual({
      text: "TOTAL 21.46",
      confidence: 94,
      bbox: { x0: 4, y0: 8, x1: 80, y1: 20 },
      words: [{ text: "TOTAL", confidence: 96, bbox: { x0: 4, y0: 8, x1: 35, y1: 20 } }],
    });
  });

  it("falls back to direct lines when Tesseract omits blocks", () => {
    expect(receiptOcrLinesFromTesseractData({
      lines: [{ text: "Date 25/12/2018", confidence: 88 }],
    })).toEqual([{ text: "Date 25/12/2018", confidence: 88 }]);
  });

  it("keeps the production control call shape and preserves returned geometry", async () => {
    const worker = {
      recognize: vi.fn().mockResolvedValue({
        data: {
          text: "TOTAL 21.46",
          blocks: [{ paragraphs: [{ lines: [{
            text: "TOTAL 21.46",
            confidence: 91,
            bbox: { x0: 10, y0: 20, x1: 110, y1: 40 },
            words: [{ text: "21.46", bbox: { x0: 65, y0: 20, x1: 110, y1: 40 } }],
          }] }] }],
        },
      }),
    };
    const pass = await recognizeReceiptOcrPass(worker, "receipt-image", RECEIPT_OCR_BASELINE_STRATEGY);
    expect(worker.recognize).toHaveBeenCalledWith("receipt-image", {}, { blocks: true });
    expect(pass.lines[0].bbox).toEqual({ x0: 10, y0: 20, x1: 110, y1: 40 });
    expect(pass.lines[0].words?.[0].bbox).toEqual({ x0: 65, y0: 20, x1: 110, y1: 40 });
    expect(pass.meanConfidence).toBe(91);
  });

  it("honors the analysis cap instead of retaining oversized camera frames", async () => {
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({
        drawImage: vi.fn(),
        getImageData: vi.fn((_: number, __: number, width: number, height: number) => ({
          data: new Uint8ClampedArray(width * height * 4),
        })),
        putImageData: vi.fn(),
      })),
    };
    class FakeImage {
      naturalWidth = 1_000;
      naturalHeight = 800;
      width = this.naturalWidth;
      height = this.naturalHeight;
      onload?: () => void;
      onerror?: () => void;
      set src(_: string) { queueMicrotask(() => this.onload?.()); }
    }
    const worker = { recognize: vi.fn().mockResolvedValue({ data: { text: "" } }) };
    vi.stubGlobal("Image", FakeImage);
    vi.stubGlobal("document", { createElement: vi.fn(() => canvas) });
    try {
      await recognizeReceiptOcrPass(worker, "receipt-image", {
        name: "small-cap",
        preprocessing: "contrast",
        maxDimension: 500,
        maxScale: 1.5,
      });
      expect(canvas.width).toBe(500);
      expect(canvas.height).toBe(400);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("normalizes line text without changing the preserved OCR lines", () => {
    const lines = [{ text: "TOTAL | 21.46\n" }, { text: "  " }, { text: "Tax\t2.00" }];
    expect(receiptOcrTextFromLines(lines)).toBe("TOTAL 21.46\nTax 2.00");
    expect(lines[0].text).toBe("TOTAL | 21.46\n");
  });

  it("keeps the exact production control as a named baseline", () => {
    expect(RECEIPT_OCR_BASELINE_STRATEGY).toEqual({ name: "baseline", preprocessing: "original" });
    expect(RECEIPT_OCR_LIVE_STRATEGY).toMatchObject({
      name: "sharpen-upscale",
      preprocessing: "sharpen",
      maxDimension: 2800,
      maxScale: 1.5,
      pageSegMode: "6",
      rotateAuto: true,
    });
    expect(RECEIPT_OCR_SCREENING_STRATEGIES.map((strategy) => strategy.name)).toEqual([
      "baseline",
      "deskew",
      "contrast",
      "contrast-lite",
      "adaptive",
      "sharpen-upscale",
      "single-column",
      "sparse-text",
      "targeted-footer",
      "targeted-financial",
      "targeted-top",
    ]);
  });

  it("normalizes pixels to grayscale without changing dimensions or alpha", () => {
    const pixels = new Uint8ClampedArray([
      20, 20, 20, 255,
      235, 235, 235, 255,
      80, 100, 120, 255,
      180, 160, 140, 255,
    ]);
    const processed = preprocessReceiptPixels(pixels, 2, 2, "contrast");
    expect(processed).toHaveLength(pixels.length);
    expect(Array.from(processed.filter((_, index) => index % 4 === 3))).toEqual([255, 255, 255, 255]);
    expect(processed[0]).toBe(processed[1]);
    expect(processed[1]).toBe(processed[2]);
  });

  it("keeps adaptive thresholding binary and leaves the source buffer untouched", () => {
    const pixels = new Uint8ClampedArray(Array.from({ length: 64 * 64 * 4 }, (_, index) => {
      const pixel = Math.floor(index / 4);
      const value = pixel % 2 ? 240 : 20;
      return index % 4 === 3 ? 255 : value;
    }));
    const original = pixels.slice();
    const processed = preprocessReceiptPixels(pixels, 64, 64, "adaptive");
    expect(Array.from(processed.filter((_, index) => index % 4 !== 3)).every((value) => value === 0 || value === 255)).toBe(true);
    expect(pixels).toEqual(original);
  });
});
