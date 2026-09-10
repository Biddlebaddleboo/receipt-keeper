import { describe, expect, it } from "vitest";
import { extractReceiptFieldsFromPpocrV6Lines } from "@/lib/receiptPpocrV6Extractor";
import { receiptOcrLinesFromPaddleItems } from "@/lib/receiptModernOcr";

const line = (text: string, index: number, confidence = 98) => ({
  text,
  confidence,
  bbox: { x0: 10, y0: index * 30, x1: 290, y1: index * 30 + 20 },
  polygon: [[10, index * 30], [290, index * 30 + 2], [290, index * 30 + 20], [10, index * 30 + 18]] as Array<[number, number]>,
});

describe("PP-OCRv6 adapted receipt field extractor", () => {
  it("keeps a modern OCR polygon available to the selector", () => {
    const lines = receiptOcrLinesFromPaddleItems([{
      text: "TOTAL 12.34",
      score: 0.99,
      poly: [[1, 2], [20, 3], [19, 10], [0, 9]],
    }]);
    expect(lines[0].polygon).toEqual([[1, 2], [20, 3], [19, 10], [0, 9]]);
  });

  it("fails open when two dates compete", () => {
    const extraction = extractReceiptFieldsFromPpocrV6Lines([
      line("SHOP MART", 0),
      line("Date 25/12/2018", 1),
      line("Date 26/12/2018", 2),
      line("TOTAL 20.00", 3),
    ]);
    expect(extraction.fields.purchase_date.status).not.toBe("trusted");
    expect(extraction.unresolvedFields).toContain("purchase_date");
  });

  it("does not infer tax from unrelated amounts", () => {
    const extraction = extractReceiptFieldsFromPpocrV6Lines([
      line("SHOP MART", 0),
      line("Subtotal 10.00", 1),
      line("TOTAL 11.30", 2),
    ]);
    expect(extraction.fields.tax.value).toBeNull();
    expect(extraction.fields.tax.status).toBe("missing");
  });

  it("does not trust competing final amounts", () => {
    const extraction = extractReceiptFieldsFromPpocrV6Lines([
      line("SHOP MART", 0),
      line("TOTAL 20.00", 1),
      line("TOTAL 21.00", 2),
    ]);
    expect(extraction.fields.total.status).not.toBe("trusted");
    expect(extraction.unresolvedFields).toContain("total");
  });

  it("keeps every field gate independent", () => {
    const withTotal = extractReceiptFieldsFromPpocrV6Lines([
      line("SHOP MART", 0),
      line("TOTAL 21.00", 1),
    ]);
    const withoutTaxLabel = extractReceiptFieldsFromPpocrV6Lines([
      line("SHOP MART", 0),
      line("Subtotal 20.00", 1),
      line("TOTAL 21.00", 2),
    ]);
    expect(withTotal.fields.total.value).toBe("21.00");
    expect(withoutTaxLabel.fields.tax.status).toBe("missing");
    expect(withoutTaxLabel.fields.tax.confidence).toBe(0);
  });
});
