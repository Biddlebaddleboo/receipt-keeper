import { describe, expect, it } from "vitest";
import {
  decisionFromExtraction,
  extractReceiptFieldsFromOcrLines,
  extractReceiptFieldsFromText,
  parseReceiptAmount,
  receiptOcrLinesFromTesseractData,
} from "@/lib/receiptFrontendExtractor";

describe("receipt frontend extractor", () => {
  it("extracts independently labelled fields from ordinary OCR", () => {
    const extraction = extractReceiptFieldsFromText(`\nCOSTCO WHOLESALE\nDate: 09/25/2026\n\nSubtotal $18.99\nTax $2.47\nTOTAL $21.46\n`);
    expect(extraction.fields.vendor.value).toBe("COSTCO WHOLESALE");
    expect(extraction.fields.purchase_date.value).toBe("2026-09-25");
    expect(extraction.fields.subtotal.value).toBe("$18.99");
    expect(extraction.fields.tax.value).toBe("$2.47");
    expect(extraction.fields.total.value).toBe("$21.46");
    expect(extraction.unresolvedFields).toEqual([]);
  });

  it("never invents tax from subtotal and total", () => {
    const extraction = extractReceiptFieldsFromText("ACME\nSubtotal 10.00\nTotal 11.30");
    expect(extraction.fields.tax.value).toBeNull();
    expect(extraction.unresolvedFields).toContain("tax");
  });

  it("abstains when a field has competing evidence", () => {
    const extraction = extractReceiptFieldsFromText("SHOP\nDate 01/02/2025\nDate 03/04/2025\nTax 1.00\nTax 2.00\nTotal 20.00");
    expect(extraction.fields.purchase_date.status).toBe("missing");
    expect(extraction.fields.tax.status).toBe("missing");
    expect(extraction.fields.total.status).toBe("trusted");
  });

  it("does not turn a subtotal line into the total", () => {
    const extraction = extractReceiptFieldsFromText("STORE\nSub-total 10.00\nGrand Total 11.30");
    expect(extraction.fields.subtotal.value).toBe("10.00");
    expect(extraction.fields.total.value).toBe("11.30");
  });

  it("associates a labelled total with the printer's next-line amount", () => {
    const extraction = extractReceiptFieldsFromText("SHOP MART\nTOTAL AMT........ RM\n60.31");
    expect(extraction.fields.total.value).toBe("60.31");
  });

  it("does not treat quantity or pre-tax totals as the final total", () => {
    const extraction = extractReceiptFieldsFromText("SHOP MART\nTotal Qty = 1.00\nTotal (Excluding GST): 10.00\nTotal (Inclusive of GST): 11.00");
    expect(extraction.fields.total.value).toBe("11.00");
  });

  it("accepts unambiguous day-first dates but rejects ambiguous ones", () => {
    expect(extractReceiptFieldsFromText("STORE\n25/12/2018\nTotal 9.00").fields.purchase_date.value).toBe("2018-12-25");
    expect(extractReceiptFieldsFromText("STORE\n05/12/2018\nTotal 9.00").fields.purchase_date.value).toBeNull();
  });

  it("only sends trusted fields to the remaining-fields path", () => {
    const extraction = extractReceiptFieldsFromText("STORE\nTotal 9.00");
    const decision = decisionFromExtraction(extraction);
    expect(decision.mode).toBe("remaining");
    expect(Object.keys(decision.fields)).toEqual(["total"]);
    expect(decision.unresolvedFields).toEqual(["vendor", "purchase_date", "subtotal", "tax"]);
  });

  it("parses comma-grouped currency without using it as cross-field evidence", () => {
    expect(parseReceiptAmount("$1,234.56")).toBe(1234.56);
    expect(parseReceiptAmount("1.234,56")).toBe(1234.56);
  });

  it("keeps learned tax ranking from resolving multiple labelled tax amounts", () => {
    const lines = ["STORE MART", "Tax 1.00", "Tax 2.00", "Total 21.00"].map((text, index) => ({
      text,
      confidence: 96,
      bbox: { x0: 10, y0: index * 20, x1: 200, y1: index * 20 + 15 },
    }));
    const extraction = extractReceiptFieldsFromOcrLines(lines, "rules-only", undefined, { useModel: true });
    expect(extraction.fields.tax.value).toBeNull();
    expect(extraction.fields.tax.status).toBe("missing");
    expect(extraction.fields.total.value).toBe("21.00");
  });

  it("does not promote the shadow model into live OCR without a promotion decision", () => {
    const lines = ["STORE MART", "Date 25/12/2018", "Total 21.00"].map((text, index) => ({
      text,
      confidence: 96,
      bbox: { x0: 10, y0: index * 20, x1: 200, y1: index * 20 + 15 },
    }));
    const extraction = extractReceiptFieldsFromOcrLines(lines);
    expect(extraction.fields.purchase_date.source).not.toBe("ml");
    expect(extraction.fields.total.source).not.toBe("ml");
  });

  it("reads browser OCR line boxes from Tesseract block output", () => {
    const lines = receiptOcrLinesFromTesseractData({
      blocks: [{ paragraphs: [{ lines: [{ text: "TOTAL 21.00", confidence: 94, bbox: { x0: 4, y0: 8, x1: 80, y1: 20 } }] }] }],
    });
    expect(lines).toEqual([{ text: "TOTAL 21.00", confidence: 94, bbox: { x0: 4, y0: 8, x1: 80, y1: 20 } }]);
  });
});
