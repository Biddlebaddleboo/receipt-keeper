import { describe, expect, it } from "vitest";
import type { Receipt } from "@/hooks/useReceiptApi";
import {
  analyzeGst288Receipts,
  buildGst288Csv,
  calculateGstCents,
  gst288CsvFilename,
  inferTaxableDescription,
} from "@/lib/gst288Export";

const receipt = (overrides: Partial<Receipt> = {}): Receipt => ({
  id: "receipt-1",
  vendor: "Store",
  subtotal: 105.5,
  tax: 0.72,
  total: 106.22,
  category: "Food",
  purchase_date: "2026-08-20",
  invoice_id: "INV-0001",
  extracted_text: "",
  extracted_fields: [],
  items: [],
  created_at: "2026-08-20T00:00:00.000Z",
  status: "success",
  ...overrides,
});

const readText = (blob: Blob): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onerror = () => reject(reader.error);
  reader.onload = () => resolve(String(reader.result));
  reader.readAsText(blob);
});

describe("GST288 export", () => {
  it("finds the unique taxable subset in the prepaid example", () => {
    const result = inferTaxableDescription(receipt({
      items: [
        { name: "Visa value", quantity: 1, price: 100 },
        { name: "Activation fee", quantity: 1, price: 5.5 },
      ],
    }), 13);

    expect(result).toEqual({ status: "matched", description: "Activation fee" });
  });

  it("uses a matching subtotal and excludes discounts from the description", () => {
    const result = inferTaxableDescription(receipt({
      subtotal: 80,
      tax: 10.4,
      items: [
        { name: "Sale item", quantity: 1, price: 100 },
        { name: "Coupon discount", quantity: 1, price: -20 },
      ],
    }), 13);

    expect(result).toEqual({ status: "matched", description: "Sale item" });
  });

  it("gives subtotal matching precedence over an ambiguous item subset", () => {
    const result = inferTaxableDescription(receipt({
      subtotal: 10,
      tax: 1.3,
      items: [
        { name: "Purchase A", quantity: 1, price: 5 },
        { name: "Purchase B", quantity: 1, price: 5 },
        { name: "Coupon", quantity: 1, price: 5 },
      ],
    }), 13);

    expect(result).toEqual({ status: "matched", description: "Purchase A; Purchase B" });
  });

  it("uses quantity and integer-cent rounding", () => {
    expect(calculateGstCents(554, 13)).toBe(72);
    const result = inferTaxableDescription(receipt({
      items: [{ name: "Two taxable items", quantity: 2, price: 2.77 }],
      tax: 0.72,
    }), 13);
    expect(result).toEqual({ status: "matched", description: "Two taxable items" });
  });

  it("falls back to the item subset when subtotal does not match", () => {
    const vanilla = inferTaxableDescription(receipt({
      subtotal: 105.5,
      tax: 0.72,
      items: [
        { name: "Visa value", quantity: 1, price: 100 },
        { name: "Activation fee", quantity: 1, price: 5.5 },
      ],
    }), 13);
    expect(vanilla).toEqual({ status: "matched", description: "Activation fee" });
  });

  it("leaves ambiguous and unmatched subsets blank", () => {
    const ambiguous = inferTaxableDescription(receipt({
      items: [
        { name: "Fee A", quantity: 1, price: 5.5 },
        { name: "Fee B", quantity: 1, price: 5.5 },
      ],
    }), 13);
    const unmatched = inferTaxableDescription(receipt({
      tax: 0.99,
      items: [{ name: "Item", quantity: 1, price: 5.5 }],
    }), 13);

    expect(ambiguous).toEqual({ status: "ambiguous", description: "" });
    expect(unmatched).toEqual({ status: "unmatched", description: "" });
  });

  it("filters inclusively, excludes zero tax, and sorts by date", () => {
    const result = analyzeGst288Receipts([
      receipt({ id: "later", purchase_date: "2026-08-21", tax: 1, items: [{ name: "Later", quantity: 1, price: 7.69 }] }),
      receipt({ id: "zero", purchase_date: "2026-08-20", tax: 0, items: [{ name: "Zero", quantity: 1, price: 10 }] }),
      receipt({ id: "start", purchase_date: "2026/08/20", tax: 0.72, items: [{ name: "Start", quantity: 1, price: 5.54 }] }),
      receipt({ id: "outside", purchase_date: "2026-08-22", tax: 1, items: [{ name: "Outside", quantity: 1, price: 7.69 }] }),
    ], { fromDate: "2026-08-20", toDate: "2026-08-21", taxRatePercent: 13 });

    expect(result.rows.map((row) => row.receiptId)).toEqual(["start", "later"]);
    expect(result.summary).toEqual({ totalReceipts: 2, matched: 2, ambiguous: 0, unmatched: 0 });
    expect(gst288CsvFilename({ fromDate: "2026/08/20", toDate: "2026-08-21" })).toBe("gst288-2026-08-20-to-2026-08-21.csv");
  });

  it("writes the exact columns, blanks missing invoice IDs, and escapes CSV fields", async () => {
    const csv = buildGst288Csv([receipt({
      vendor: 'Supplier, "quoted"',
      invoice_id: undefined,
      items: [{ name: "Fee\nwith comma, and quote", quantity: 1, price: 5.5 }],
    })], { taxRatePercent: 13 });

    expect(csv.type).toBe("text/csv;charset=utf-8");
    expect(await readText(csv)).toBe(
      '"Date","Invoice ID","Supplier Name","Brief Description of Purchases","GST/HST"\r\n' +
      '"2026-08-20","","Supplier, ""quoted""","Fee\nwith comma, and quote","0.72"\r\n',
    );
  });
});
