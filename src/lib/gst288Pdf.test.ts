import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import type { Receipt } from "@/hooks/useReceiptApi";
import {
  buildGst288Pdf,
  GST288_FIELD_NAMES,
  GST288_MAX_ROWS,
  GST288_TEMPLATE_FILENAME,
  GST288_TEMPLATE_PATH,
  gst288PdfFilename,
} from "@/lib/gst288Pdf";

const receipt = (index: number): Receipt => ({
  id: `receipt-${String(index).padStart(2, "0")}`,
  vendor: `Supplier ${index}`,
  subtotal: 1,
  tax: 0.13,
  total: 1.13,
  category: "Food",
  purchase_date: `2026-08-${String(index).padStart(2, "0")}`,
  invoice_id: index === 2 ? undefined : `INV-${index}`,
  extracted_text: "",
  extracted_fields: [],
  items: [],
  created_at: `2026-08-${String(index).padStart(2, "0")}T00:00:00.000Z`,
  status: "success",
});

const makePdfApi = () => {
  const values = new Map<string, string>();
  const fieldNames = new Set<string>([
    GST288_FIELD_NAMES.claimantName[0],
    GST288_FIELD_NAMES.firstName[0],
    GST288_FIELD_NAMES.businessNumberParts.first[0],
    GST288_FIELD_NAMES.businessNumberParts.type[0],
    GST288_FIELD_NAMES.businessNumberParts.second[0],
  ]);
  for (const page of [1, 2] as const) {
    const fields = GST288_FIELD_NAMES.page(page);
    fieldNames.add(fields.pageNumber[0]);
    fieldNames.add(fields.pageCount[0]);
    fieldNames.add(fields.pageTotal[0]);
    const count = page === 1 ? 11 : 19;
    for (let slot = 1; slot <= count; slot += 1) {
      const globalRow = page === 1 ? slot : 11 + slot;
      const row = fields.row(slot, globalRow);
      fieldNames.add(row.date[0]);
      fieldNames.add(row.invoiceId[0]);
      fieldNames.add(row.supplierName[0]);
      fieldNames.add(row.description[0]);
      fieldNames.add(row.tax[0]);
    }
  }

  const flatten = vi.fn();
  const save = vi.fn(async () => new Uint8Array([1, 2, 3]));
  const form = {
    getFields: () => Array.from(fieldNames, (name) => ({ getName: () => name })),
    getTextField: (name: string) => ({ setText: (value: string) => values.set(name, value) }),
    flatten,
  };
  return {
    values,
    flatten,
    save,
    pdfDocumentApi: {
      load: vi.fn(async () => ({ getForm: () => form, save })),
    },
  };
};

describe("GST288 PDF export", () => {
  it("maps rows 1-11 to page 1 and rows 12-30 to page 2 with claimant fields and totals", async () => {
    const fake = makePdfApi();
    const result = await buildGst288Pdf(
      Array.from({ length: GST288_MAX_ROWS }, (_value, index) => receipt(index + 1)),
      { fromDate: "2026-08-01", toDate: "2026-08-30", taxRatePercent: 13 },
      { businessName: "Example Business", firstName: "Alex", businessNumber: "123456789RT0001" },
      { loadTemplate: async () => new Uint8Array([9]), pdfDocumentApi: fake.pdfDocumentApi },
    );

    expect(fake.values.get(GST288_FIELD_NAMES.claimantName[0])).toBe("Example Business");
    expect(fake.values.get(GST288_FIELD_NAMES.firstName[0])).toBe("Alex");
    expect(fake.values.get(GST288_FIELD_NAMES.businessNumberParts.first[0])).toBe("123456789");
    expect(fake.values.get(GST288_FIELD_NAMES.businessNumberParts.type[0])).toBe("RT");
    expect(fake.values.get(GST288_FIELD_NAMES.businessNumberParts.second[0])).toBe("0001");
    expect(fake.values.get(GST288_FIELD_NAMES.page(1).pageNumber[0])).toBe("1");
    expect(fake.values.get(GST288_FIELD_NAMES.page(1).pageCount[0])).toBe("2");
    expect(fake.values.get(GST288_FIELD_NAMES.page(2).pageNumber[0])).toBe("2");
    expect(fake.values.get(GST288_FIELD_NAMES.page(2).pageCount[0])).toBe("2");
    expect(fake.values.get(GST288_FIELD_NAMES.page(1).row(1, 1).date[0])).toBe("2026-08-01");
    expect(fake.values.get(GST288_FIELD_NAMES.page(2).row(1, 12).date[0])).toBe("2026-08-12");
    expect(fake.values.get(GST288_FIELD_NAMES.page(1).pageTotal[0])).toBe("1.43");
    expect(fake.values.get(GST288_FIELD_NAMES.page(2).pageTotal[0])).toBe("2.47");
    expect(fake.values.get(GST288_FIELD_NAMES.page(1).row(2, 2).invoiceId[0])).toBe("");
    expect(fake.flatten).toHaveBeenCalledTimes(1);
    expect(result.blob.type).toBe("application/pdf");
    expect(result.filename).toBe("gst288-2026-08-01-to-2026-08-30.pdf");
  });

  it("rejects more than 30 eligible rows without loading or truncating the template", async () => {
    const loadTemplate = vi.fn(async () => new Uint8Array([9]));
    await expect(buildGst288Pdf(
      Array.from({ length: GST288_MAX_ROWS + 1 }, (_value, index) => receipt(index + 1)),
      {},
      {},
      { loadTemplate },
    )).rejects.toThrow("up to 30 receipts");
    expect(loadTemplate).not.toHaveBeenCalled();
  });

  it("surfaces a clear error when the local template is missing", async () => {
    const response = { ok: false, status: 404 };
    vi.stubGlobal("fetch", vi.fn(async () => response));
    await expect(buildGst288Pdf([receipt(1)])).rejects.toThrow(`Unable to load ${GST288_TEMPLATE_FILENAME}`);
    expect(GST288_TEMPLATE_PATH).toBe("/forms/gst288-fill-23e.pdf");
    vi.unstubAllGlobals();
  });

  it("uses deterministic PDF filenames", () => {
    expect(gst288PdfFilename({ fromDate: "2026-08-01", toDate: "2026-08-31" })).toBe("gst288-2026-08-01-to-2026-08-31.pdf");
  });

  it("fills the uploaded GST288 template field names", async () => {
    const template = readFileSync(resolve(process.cwd(), "public/forms/gst288-fill-23e.pdf"));
    const result = await buildGst288Pdf(
      [receipt(1)],
      {},
      { businessName: "Example Business", firstName: "Alex", businessNumber: "123456789RT0001" },
      { loadTemplate: async () => new Uint8Array(template), pdfDocumentApi: PDFDocument },
    );

    expect(result.blob.type).toBe("application/pdf");
    expect(result.blob.size).toBeGreaterThan(0);
  });
});
