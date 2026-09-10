import { describe, expect, it } from "vitest";
import {
  createHorizontalBands,
  deduplicateReceiptBandLines,
  extractReceiptFieldsFromPpocrV6Bands,
  mapReceiptBandLineToSource,
} from "@/lib/receiptBandOcr";
import type { ReceiptBandObservation } from "@/lib/receiptBandOcr";

const observation = (
  text: string,
  bandIndex: number,
  observationKey = `band-${bandIndex}`,
  y0 = 100,
): ReceiptBandObservation => ({
  text,
  confidence: 99,
  bbox: { x0: 20, y0, x1: 180, y1: y0 + 20 },
  bandIndex,
  bandTop: bandIndex * 100,
  bandBottom: bandIndex * 100 + 240,
  observationKey,
});

describe("overlapping PP-OCRv6 receipt bands", () => {
  it("covers the complete image and anchors the last band to the bottom", () => {
    const bands = createHorizontalBands(800, 1000, {
      bandHeightMode: "fraction",
      bandHeight: 0.3,
      overlap: 0.6,
    });
    expect(bands[0].top).toBe(0);
    expect(bands.at(-1)?.bottom).toBe(1000);
    expect(bands.every((band) => band.bottom > band.top && band.width === 800)).toBe(true);
    expect(bands.some((band, index) => index > 0 && band.top < bands[index - 1].bottom)).toBe(true);
  });

  it("derives a line-height band from OCR geometry", () => {
    const bands = createHorizontalBands(400, 1000, {
      bandHeightMode: "line-heights",
      bandHeight: 4,
      overlap: 0.5,
    }, [
      { text: "a", bbox: { x0: 0, y0: 10, x1: 20, y1: 30 } },
      { text: "b", bbox: { x0: 0, y0: 40, x1: 20, y1: 60 } },
    ]);
    expect(bands[0].height).toBe(80);
  });

  it("merges an overlapping line once while retaining independent support metadata", () => {
    const lines = deduplicateReceiptBandLines([
      observation("TOTAL 21.46", 0, "band-0", 100),
      observation("TOTAL 21.46", 1, "band-1", 102),
      observation("TOTAL 21.46", 2, "band-2", 104),
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0].supportCount).toBe(3);
    expect(lines[0].independentBandCount).toBe(3);
    expect(lines[0].sourceObservationKeys).toEqual(["band-0", "band-1", "band-2"]);
  });

  it("does not merge two same-valued receipt lines from one OCR pass", () => {
    const lines = deduplicateReceiptBandLines([
      observation("TOTAL 10.00", 0, "band-0", 100),
      observation("TOTAL 10.00", 0, "band-0", 250),
    ]);
    expect(lines).toHaveLength(2);
  });

  it("requires independent band agreement before trusting a field", () => {
    const oneBand = extractReceiptFieldsFromPpocrV6Bands([
      observation("TOTAL 21.46", 0),
    ], { selector: "rules", minIndependentBands: 2 });
    const twoBands = extractReceiptFieldsFromPpocrV6Bands([
      observation("TOTAL 21.46", 0),
      observation("TOTAL 21.46", 1, "band-1", 102),
    ], { selector: "rules", minIndependentBands: 2 });
    expect(oneBand.fields.total.status).toBe("uncertain");
    expect(oneBand.fields.total.presence).toBe("uncertain");
    expect(oneBand.fields.total.value).toBe("21.46");
    expect(twoBands.fields.total.status).toBe("trusted");
    expect(twoBands.fields.total.presence).toBe("present");
    expect(twoBands.fields.total.supportBandCount).toBe(2);
    expect(twoBands.deduplication.mergedLineCount).toBe(1);
  });

  it("keeps competing values uncertain even when each has OCR support", () => {
    const extraction = extractReceiptFieldsFromPpocrV6Bands([
      observation("TOTAL 21.46", 0),
      observation("TOTAL 22.46", 1, "band-1", 102),
    ], { selector: "rules", minIndependentBands: 2 });
    expect(extraction.fields.total.status).toBe("uncertain");
    expect(extraction.fields.total.competingValueCount).toBe(2);
  });

  it("rejects tax-rate and supply-summary amounts that merely contain the word total", () => {
    const extraction = extractReceiptFieldsFromPpocrV6Bands([
      observation("Total 0% supplies: 12.98", 0),
      observation("Total 0% supplies: 12.98", 1, "band-1", 102),
    ], { selector: "rules", minIndependentBands: 2 });
    expect(extraction.fields.total.value).toBe("12.98");
    expect(extraction.fields.total.status).toBe("uncertain");
  });

  it("does not use a trusted total to trust an unresolved tax field", () => {
    const extraction = extractReceiptFieldsFromPpocrV6Bands([
      observation("TOTAL 21.46", 0),
      observation("TOTAL 21.46", 1, "band-1", 102),
    ], { selector: "rules", minIndependentBands: 2 });
    expect(extraction.fields.total.status).toBe("trusted");
    expect(extraction.fields.tax.status).toBe("missing");
    expect(extraction.fields.tax.presence).toBe("not-present");
    expect(extraction.fields.tax.confidence).toBe(0);
  });

  it("maps band polygon, box, and word coordinates back to the source image", () => {
    const mapped = mapReceiptBandLineToSource({
      text: "TOTAL 2.00",
      bbox: { x0: 10, y0: 20, x1: 50, y1: 40 },
      polygon: [[10, 20], [50, 20], [50, 40], [10, 40]],
      words: [{ text: "2.00", bbox: { x0: 30, y0: 20, x1: 50, y1: 40 } }],
    }, 300, 2);
    expect(mapped.bbox).toEqual({ x0: 5, y0: 310, x1: 25, y1: 320 });
    expect(mapped.polygon?.[0]).toEqual([5, 310]);
    expect(mapped.words?.[0].bbox).toEqual({ x0: 15, y0: 310, x1: 25, y1: 320 });
  });
});
