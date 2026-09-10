import { describe, expect, it } from "vitest";
import {
  buildAdaptiveExpertCrops,
  classifyReceiptBands,
  extractReceiptFieldsFromHierarchicalBands,
  type ReceiptHierarchicalObservation,
  type ReceiptRouterBandInput,
} from "@/lib/receiptHierarchicalBandOcr";

const band = (index: number, text: string, top = index * 200): ReceiptRouterBandInput => ({
  bandIndex: index,
  observationKey: `band-${index}`,
  top,
  bottom: top + 200,
  width: 400,
  height: 200,
  lines: [{ text, confidence: 99, bbox: { x0: 20, y0: top + 70, x1: 380, y1: top + 100 } }],
});

const expertLine = (text: string, key: string, category: "vendor" | "purchase_date" | "subtotal" | "tax" | "total" | "receipt_id" | "item", bandIndex: number): ReceiptHierarchicalObservation => ({
  text,
  confidence: 99,
  bbox: { x0: 20, y0: 70, x1: 380, y1: 100 },
  bandIndex,
  bandTop: 0,
  bandBottom: 200,
  observationKey: key,
  sourcePass: "expert",
  expertCategory: category,
  cropId: key,
  routerProbability: 0.99,
});

describe("hierarchical PP-OCRv6 band routing", () => {
  it("caps category fan-out and creates bounded adaptive windows", () => {
    const bands = [band(0, "TOTAL 21.46 TAX 1.00"), band(1, "WALMART 12/12/2024")];
    const predictions = classifyReceiptBands(bands, {
      maxCategoriesPerBand: 2,
      routerThresholds: Object.fromEntries(["vendor", "purchase_date", "subtotal", "tax", "total", "receipt_id", "item", "other"].map((category) => [category, 0])),
    });
    expect(predictions.every((prediction) => prediction.routes.length <= 2)).toBe(true);
    const crops = buildAdaptiveExpertCrops(bands, predictions, { windowMode: "adaptive", windowPadding: 1, maxExpertInvocations: 4 });
    expect(crops.length).toBeLessThanOrEqual(4);
    expect(crops.every((crop) => crop.left >= 0 && crop.top >= 0 && crop.right <= 400 && crop.bottom <= 400)).toBe(true);
  });

  it("keeps per-category top-band quotas independent from per-band fan-out", () => {
    const bands = [
      band(0, "ACME", 0),
      band(1, "RECEIPT NO 12345", 200),
      band(2, "ITEM 1.00", 400),
      band(3, "TOTAL DUE 2.00", 600),
    ];
    const predictions = classifyReceiptBands(bands, {
      maxCategoriesPerBand: 3,
      topBandsPerCategory: { vendor: 1, receipt_id: 1, item: 1, total: 1 },
      routerThresholds: Object.fromEntries(["vendor", "purchase_date", "subtotal", "tax", "total", "receipt_id", "item", "other"].map((category) => [category, 0])),
      vendorHeaderPrior: true,
    });
    expect(predictions.filter((prediction) => prediction.routes.includes("vendor")).length).toBeLessThanOrEqual(1);
    expect(predictions.filter((prediction) => prediction.routes.includes("receipt_id")).length).toBeLessThanOrEqual(1);
    expect(predictions.filter((prediction) => prediction.routes.includes("item")).length).toBeLessThanOrEqual(1);
    expect(predictions.every((prediction) => prediction.routes.length <= 3)).toBe(true);
    expect(predictions.every((prediction) => prediction.rankingScores && Object.keys(prediction.rankingScores).length === 7)).toBe(true);
  });

  it("uses the broad header prior for routing a lexical-light vendor band", () => {
    const predictions = classifyReceiptBands([
      band(0, "ACME", 0),
      band(1, "ITEM 1.00", 200),
      band(2, "TOTAL DUE 2.00", 400),
      band(3, "THANK YOU", 600),
    ], {
      maxCategoriesPerBand: 7,
      vendorHeaderPrior: true,
      routerThresholds: { vendor: 0.99, purchase_date: 0.99, subtotal: 0.99, tax: 0.99, total: 0.99, receipt_id: 0.99, item: 0.99, other: 0.99 },
    });
    expect(predictions[0]?.routes).toContain("vendor");
  });

  it("routes a crop only to the predicted specialist", () => {
    const bands = [band(0, "TOTAL 21.46")];
    const predictions = [{
      bandIndex: 0,
      observationKey: "band-0",
      top: 0,
      bottom: 200,
      probabilities: { vendor: 0.01, purchase_date: 0.01, subtotal: 0.01, tax: 0.01, total: 0.99, receipt_id: 0.01, item: 0.01, other: 0.01 },
      routes: ["total" as const],
      dominantCategory: "total" as const,
      lineCount: 1,
    }];
    const crops = buildAdaptiveExpertCrops(bands, predictions, { windowMode: "medium", windowPadding: 1, maxExpertInvocations: 10 });
    expect(crops).toHaveLength(1);
    expect(crops[0].category).toBe("total");
  });

  it("does not count duplicate lines from one OCR observation as independent support", () => {
    const extraction = extractReceiptFieldsFromHierarchicalBands([], [
      expertLine("TOTAL AMT 21.46", "crop-total", "total", 0),
      expertLine("TOTAL AMT 21.46", "crop-total", "total", 0),
    ], {
      config: { name: "test", windowMode: "medium", maxCategoriesPerBand: 1, maxExpertInvocations: 1, minIndependentObservations: 2, windowPadding: 1 },
      expertCrops: [{ cropId: "crop-total", category: "total", mode: "medium", left: 0, top: 0, right: 400, bottom: 200, width: 400, height: 200, sourceBandIndex: 0, sourceObservationKey: "band-0", sourceBandIndices: [0], routerProbability: 0.99, anchorLineIndex: 0, anchorY: 85 }],
      routerPredictions: [],
      pageWidth: 400,
      pageHeight: 400,
    });
    expect(extraction.fields.total.independentObservationCount).toBe(1);
    expect(extraction.fields.total.status).toBe("uncertain");
  });

  it("keeps field evidence independent", () => {
    const extraction = extractReceiptFieldsFromHierarchicalBands([], [
      expertLine("TOTAL AMT 21.46 12/12/2024", "crop-total-a", "total", 0),
      expertLine("TOTAL AMT 21.46 12/12/2024", "crop-total-b", "total", 1),
    ], {
      config: { name: "test", windowMode: "medium", maxCategoriesPerBand: 1, maxExpertInvocations: 2, minIndependentObservations: 2, windowPadding: 1 },
      expertCrops: [
        { cropId: "crop-total-a", category: "total", mode: "medium", left: 0, top: 0, right: 400, bottom: 200, width: 400, height: 200, sourceBandIndex: 0, sourceObservationKey: "band-0", sourceBandIndices: [0], routerProbability: 0.99, anchorLineIndex: 0, anchorY: 85 },
        { cropId: "crop-total-b", category: "total", mode: "medium", left: 0, top: 200, right: 400, bottom: 400, width: 400, height: 200, sourceBandIndex: 1, sourceObservationKey: "band-1", sourceBandIndices: [1], routerProbability: 0.99, anchorLineIndex: 0, anchorY: 285 },
      ],
      routerPredictions: [],
      pageWidth: 400,
      pageHeight: 400,
    });
    expect(extraction.fields.total.independentObservationCount).toBe(2);
    expect(extraction.fields.purchase_date.status).toBe("missing");
  });

  it("does not trust a bare total label when the crop also contains summary amounts", () => {
    const extraction = extractReceiptFieldsFromHierarchicalBands([], [
      expertLine("TOTAL 21.46", "crop-total-a", "total", 0),
      expertLine("TOTAL 21.46", "crop-total-b", "total", 1),
    ], {
      config: { name: "test", windowMode: "medium", maxCategoriesPerBand: 1, maxExpertInvocations: 2, minIndependentObservations: 2, windowPadding: 1 },
      expertCrops: [
        { cropId: "crop-total-a", category: "total", mode: "medium", left: 0, top: 0, right: 400, bottom: 200, width: 400, height: 200, sourceBandIndex: 0, sourceObservationKey: "band-0", sourceBandIndices: [0], routerProbability: 0.99, anchorLineIndex: 0, anchorY: 85 },
        { cropId: "crop-total-b", category: "total", mode: "medium", left: 0, top: 0, right: 400, bottom: 200, width: 400, height: 200, sourceBandIndex: 1, sourceObservationKey: "band-1", sourceBandIndices: [1], routerProbability: 0.99, anchorLineIndex: 0, anchorY: 85 },
      ],
      routerPredictions: [],
      pageWidth: 400,
      pageHeight: 400,
    });
    expect(extraction.fields.total.status).not.toBe("trusted");
  });

  it("does not use router probability as a final specialist trust gate", () => {
    const extraction = extractReceiptFieldsFromHierarchicalBands([], [
      expertLine("TOTAL DUE 2.00", "crop-low-router", "total", 0),
    ], {
      config: {
        name: "test",
        windowMode: "medium",
        maxCategoriesPerBand: 1,
        maxExpertInvocations: 1,
        minIndependentObservations: 1,
        windowPadding: 1,
        expertThresholds: { total: 0 },
        expertMinConfidence: { total: 0 },
      },
      expertCrops: [{ cropId: "crop-low-router", category: "total", mode: "medium", left: 0, top: 0, right: 400, bottom: 200, width: 400, height: 200, sourceBandIndex: 0, sourceObservationKey: "band-0", sourceBandIndices: [0], routerProbability: 0.01, anchorLineIndex: 0, anchorY: 85 }],
      routerPredictions: [],
      pageWidth: 400,
      pageHeight: 400,
    });
    expect(extraction.fields.total.status).toBe("trusted");
  });

  it("does not treat GST payable as a final-total label", () => {
    const extraction = extractReceiptFieldsFromHierarchicalBands([], [
      expertLine("GST payable (6%) 2.36", "crop-tax-a", "total", 0),
      expertLine("GST payable (6%) 2.36", "crop-tax-b", "total", 1),
    ], {
      config: { name: "test", windowMode: "medium", maxCategoriesPerBand: 1, maxExpertInvocations: 2, minIndependentObservations: 2, windowPadding: 1 },
      expertCrops: [
        { cropId: "crop-tax-a", category: "total", mode: "medium", left: 0, top: 0, right: 400, bottom: 200, width: 400, height: 200, sourceBandIndex: 0, sourceObservationKey: "band-0", sourceBandIndices: [0], routerProbability: 0.99, anchorLineIndex: 0, anchorY: 85 },
        { cropId: "crop-tax-b", category: "total", mode: "medium", left: 0, top: 0, right: 400, bottom: 200, width: 400, height: 200, sourceBandIndex: 1, sourceObservationKey: "band-1", sourceBandIndices: [1], routerProbability: 0.99, anchorLineIndex: 0, anchorY: 85 },
      ],
      routerPredictions: [],
      pageWidth: 400,
      pageHeight: 400,
    });
    expect(extraction.fields.total.status).not.toBe("trusted");
  });

  it("accepts an already-normalized ISO date after independent date validation", () => {
    const extraction = extractReceiptFieldsFromHierarchicalBands([], [
      expertLine("DATE: 13/12/2024", "crop-date", "purchase_date", 0),
    ], {
      config: {
        name: "test-date",
        windowMode: "medium",
        maxCategoriesPerBand: 1,
        maxExpertInvocations: 1,
        minIndependentObservations: 1,
        windowPadding: 1,
        expertThresholds: { purchase_date: 0 },
        expertMinConfidence: { purchase_date: 0 },
        allowStrongSingleObservation: { purchase_date: true },
        strongPredictionThreshold: { purchase_date: 0 },
        strongConfidenceThreshold: { purchase_date: 0 },
      },
      expertCrops: [{ cropId: "crop-date", category: "purchase_date", mode: "medium", left: 0, top: 0, right: 400, bottom: 200, width: 400, height: 200, sourceBandIndex: 0, sourceObservationKey: "band-0", sourceBandIndices: [0], routerProbability: 0.01, anchorLineIndex: 0, anchorY: 85 }],
      routerPredictions: [],
      pageWidth: 400,
      pageHeight: 400,
    });
    expect(extraction.fields.purchase_date.value).toBe("2024-12-13");
    expect(extraction.fields.purchase_date.status).toBe("trusted");
  });

  it("merges a one-character receipt-ID OCR variant without double-counting the crop", () => {
    const extraction = extractReceiptFieldsFromHierarchicalBands([], [
      expertLine("Receipt No: ABC12345", "crop-id-a", "receipt_id", 0),
      expertLine("RECEIPT NO: ABC1234S", "crop-id-b", "receipt_id", 1),
    ], {
      config: {
        name: "test-id-equivalence",
        windowMode: "medium",
        maxCategoriesPerBand: 1,
        maxExpertInvocations: 2,
        minIndependentObservations: 2,
        windowPadding: 1,
        expertThresholds: { receipt_id: 0 },
        expertMinConfidence: { receipt_id: 0 },
      },
      expertCrops: [
        { cropId: "crop-id-a", category: "receipt_id", mode: "medium", left: 0, top: 0, right: 400, bottom: 200, width: 400, height: 200, sourceBandIndex: 0, sourceObservationKey: "band-0", sourceBandIndices: [0], routerProbability: 0.01, anchorLineIndex: 0, anchorY: 85 },
        { cropId: "crop-id-b", category: "receipt_id", mode: "medium", left: 0, top: 200, right: 400, bottom: 400, width: 400, height: 200, sourceBandIndex: 1, sourceObservationKey: "band-1", sourceBandIndices: [1], routerProbability: 0.01, anchorLineIndex: 0, anchorY: 285 },
      ],
      routerPredictions: [],
      pageWidth: 400,
      pageHeight: 400,
    });
    expect(extraction.specialists.receipt_id.independentObservationCount).toBe(2);
    expect(extraction.specialists.receipt_id.status).toBe("trusted");
  });

  it("rejects GST percentage tokens and vendor registration metadata", () => {
    const extraction = extractReceiptFieldsFromHierarchicalBands([], [
      expertLine("TOTAL INCL.GST 6.00%", "crop-rate", "total", 0),
      expertLine("REG NO 123456", "crop-reg", "vendor", 1),
    ], {
      config: { name: "test-hard-negatives", windowMode: "medium", maxCategoriesPerBand: 1, maxExpertInvocations: 2, minIndependentObservations: 1, windowPadding: 1, expertThresholds: { total: 0, vendor: 0 }, expertMinConfidence: { total: 0, vendor: 0 } },
      expertCrops: [
        { cropId: "crop-rate", category: "total", mode: "medium", left: 0, top: 0, right: 400, bottom: 200, width: 400, height: 200, sourceBandIndex: 0, sourceObservationKey: "band-0", sourceBandIndices: [0], routerProbability: 0.99, anchorLineIndex: 0, anchorY: 85 },
        { cropId: "crop-reg", category: "vendor", mode: "medium", left: 0, top: 200, right: 400, bottom: 400, width: 400, height: 200, sourceBandIndex: 1, sourceObservationKey: "band-1", sourceBandIndices: [1], routerProbability: 0.99, anchorLineIndex: 0, anchorY: 285 },
      ],
      routerPredictions: [],
      pageWidth: 400,
      pageHeight: 400,
    });
    expect(extraction.fields.total.status).not.toBe("trusted");
    expect(extraction.fields.vendor.status).not.toBe("trusted");
  });
});
