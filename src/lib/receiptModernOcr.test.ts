import { describe, expect, it } from "vitest";
import {
  RECEIPT_MODERN_OCR_ENGINES,
  RECEIPT_MODERN_OCR_SHARED_RUNTIME_BYTES,
  receiptModernOcrPass,
  receiptOcrBoxFromPolygon,
  receiptOcrLinesFromGutenyeLines,
  receiptOcrLinesFromPaddleItems,
} from "@/lib/receiptModernOcr";

describe("modern OCR adapter boundary", () => {
  it("normalizes Paddle polygons and preserves independent line confidence", () => {
    const lines = receiptOcrLinesFromPaddleItems([
      { text: "TOTAL 21.46", score: 0.97, poly: [[80, 42], [180, 42], [180, 62], [80, 62]] },
      { text: "STORE", score: 82, poly: [[20, 10], [70, 10], [70, 28], [20, 28]] },
    ]);
    expect(lines.map((line) => line.text)).toEqual(["STORE", "TOTAL 21.46"]);
    expect(lines[1].confidence).toBe(97);
    expect(lines[1].bbox).toEqual({ x0: 80, y0: 42, x1: 180, y1: 62 });
    expect(lines[1].words).toBeUndefined();
  });

  it("normalizes Gutenye frames and sorts them by reading order", () => {
    const lines = receiptOcrLinesFromGutenyeLines([
      { text: "TOTAL 3.20", mean: 0.91, frame: { left: 5, top: 90, width: 50, height: 12 } },
      { text: "SHOP", mean: 0.88, frame: { left: 5, top: 20, width: 35, height: 12 } },
    ]);
    expect(lines.map((line) => line.text)).toEqual(["SHOP", "TOTAL 3.20"]);
    expect(lines[1].confidence).toBe(91);
    expect(lines[1].bbox).toEqual({ x0: 5, y0: 90, x1: 55, y1: 102 });
  });

  it("rejects malformed polygons instead of inventing geometry", () => {
    expect(receiptOcrBoxFromPolygon([[1, 2], [3, 4], [5, 6]])).toBeUndefined();
    expect(receiptOcrBoxFromPolygon([[1, 2], [3, 4], [5, 6], [7, 8]])).toEqual({ x0: 1, y0: 2, x1: 7, y1: 8 });
  });

  it("records model bytes while keeping the benchmark adapter rules-only", () => {
    const pass = receiptModernOcrPass("paddleocr-js-ppocrv6-tiny", [{ text: "TOTAL 2.00", confidence: 99 }], 12);
    expect(pass.modelBytes).toBeGreaterThan(6_000_000);
    expect(pass.wordBoxes).toBe(0);
    expect(RECEIPT_MODERN_OCR_ENGINES).toHaveLength(3);
  });

  it("reports shared browser runtime bytes separately from model bytes", () => {
    expect(RECEIPT_MODERN_OCR_SHARED_RUNTIME_BYTES).toBeGreaterThan(20_000_000);
    expect(RECEIPT_MODERN_OCR_ENGINES.every((engine) => (
      engine.runtimeBytes === RECEIPT_MODERN_OCR_SHARED_RUNTIME_BYTES
    ))).toBe(true);
  });
});
