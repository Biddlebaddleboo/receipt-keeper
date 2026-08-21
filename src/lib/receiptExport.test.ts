import { describe, expect, it, vi } from "vitest";
import type { Receipt } from "@/hooks/useReceiptApi";
import {
  buildReceiptExportZip,
  filterReceiptsForExport,
  receiptExportFilename,
  receiptExportZipFilename,
} from "@/lib/receiptExport";
import { createStoredZip } from "@/lib/zipStore";

const receipt = (overrides: Partial<Receipt>): Receipt => ({
  id: "receipt-id",
  vendor: "Store",
  subtotal: 1,
  tax: 0,
  total: 1,
  category: "Food",
  purchase_date: "2026-08-20",
  extracted_text: "",
  extracted_fields: [],
  items: [],
  created_at: "2026-08-20T00:00:00.000Z",
  status: "success",
  ...overrides,
});

const jpeg = () => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: "image/jpeg" });

const readBlob = (blob: Blob): Promise<ArrayBuffer> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onerror = () => reject(reader.error);
  reader.onload = () => resolve(reader.result as ArrayBuffer);
  reader.readAsArrayBuffer(blob);
});

const readZipEntries = async (zip: Blob) => {
  const bytes = new Uint8Array(await readBlob(zip));
  const view = new DataView(bytes.buffer);
  const entries: Array<{ name: string; method: number }> = [];
  let offset = 0;
  while (offset + 4 <= bytes.length && view.getUint32(offset, true) === 0x04034b50) {
    const method = view.getUint16(offset + 8, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const name = new TextDecoder().decode(bytes.slice(offset + 30, offset + 30 + nameLength));
    const size = view.getUint32(offset + 22, true);
    entries.push({ name, method });
    offset += 30 + nameLength + extraLength + size;
  }
  return entries;
};

describe("receipt export", () => {
  it("filters both dates inclusively and applies selected categories", () => {
    const receipts = [
      receipt({ id: "before", purchase_date: "2026-08-19" }),
      receipt({ id: "start", purchase_date: "2026-08-20", category: "Food" }),
      receipt({ id: "end", purchase_date: "2026-08-21", category: "Travel" }),
      receipt({ id: "other-category", purchase_date: "2026-08-20", category: "Other" }),
      receipt({ id: "after", purchase_date: "2026-08-22" }),
    ];

    expect(filterReceiptsForExport(receipts, {
      fromDate: "2026-08-20",
      toDate: "2026-08-21",
      categories: ["Food", "Travel"],
    }).map((item) => item.id)).toEqual(["start", "end"]);
  });

  it("exports all corrected canonical categories even when AI suggestions are stale", async () => {
    const correctedReceipts = Array.from({ length: 21 }, (_value, index) => receipt({
      id: `corrected-${index + 1}`,
      vendor: `Store ${index + 1}`,
      category: "Corrected category",
      purchase_date: "2026-08-20",
      extracted_fields: [{
        ai_suggestions: {
          category: "Old AI category",
          purchase_date: "2019-01-01",
        },
      }] as unknown as Receipt["extracted_fields"],
    }));
    const filters = {
      fromDate: "2026-08-20",
      toDate: "2026-08-20",
      categories: ["Corrected category"],
    };
    const matchingReceipts = filterReceiptsForExport(correctedReceipts, filters);
    expect(matchingReceipts).toHaveLength(21);
    expect(new Set(matchingReceipts.map((item) => item.id)).size).toBe(21);

    const getImageUrl = vi.fn(async (item: Receipt) => `https://signed/${item.id}`);
    const zip = await buildReceiptExportZip(correctedReceipts, {
      ...filters,
      getImageUrl,
      fetchImage: async () => ({
        ok: true,
        status: 200,
        blob: async () => new Blob(["webp"], { type: "image/webp" }),
      } as Response),
      convert: async () => jpeg(),
    });

    expect(getImageUrl).toHaveBeenCalledTimes(21);
    expect(new Set(getImageUrl.mock.calls.map(([item]) => item.id)).size).toBe(21);
    expect(await readZipEntries(zip)).toHaveLength(21);
  });

  it("exports every supplied owner receipt, including receipts outside the visible page", async () => {
    const allReceipts = [
      receipt({ id: "visible", vendor: "Visible" }),
      receipt({ id: "not-loaded-on-screen", vendor: "Older", purchase_date: "2025-01-01" }),
    ];
    const getImageUrl = vi.fn(async (item: Receipt) => `https://signed/${item.id}`);
    const fetchImage = vi.fn(async () => ({ ok: true, status: 200, blob: async () => new Blob(["webp"], { type: "image/webp" }) } as Response));
    const convert = vi.fn(async () => jpeg());

    await buildReceiptExportZip(allReceipts, { getImageUrl, fetchImage, convert });
    expect(getImageUrl).toHaveBeenCalledTimes(2);
    expect(getImageUrl).toHaveBeenCalledWith(expect.objectContaining({ id: "not-loaded-on-screen" }));
  });

  it("numbers duplicate names and sanitizes unsafe or missing fields", () => {
    const used = new Map<string, number>();
    expect(receiptExportFilename(receipt({ vendor: "ACME / West?" }), used)).toBe("2026-08-20 - ACME - West-.jpg");
    expect(receiptExportFilename(receipt({ vendor: "ACME / West?" }), used)).toBe("2026-08-20 - ACME - West- (2).jpg");
    expect(receiptExportFilename(receipt({ purchase_date: "", vendor: "" }), used)).toBe("unknown-date - Unknown retailer.jpg");
  });

  it("converts each fetched WebP before writing JPEG STORE entries", async () => {
    const getImageUrl = vi.fn(async () => "https://signed/receipt");
    const fetchImage = vi.fn(async () => ({ ok: true, status: 200, blob: async () => new Blob(["webp"], { type: "image/webp" }) } as Response));
    const convert = vi.fn(async (source: Blob) => {
      expect(source.type).toBe("image/webp");
      return jpeg();
    });
    const progress: Array<{ percentage: number; completed: number; total: number; phase: string }> = [];

    const zip = await buildReceiptExportZip([receipt({ id: "one" }), receipt({ id: "two", vendor: "Second" })], {
      getImageUrl,
      fetchImage,
      convert,
      onProgress: ({ percentage, completed, total, phase }) => progress.push({ percentage, completed, total, phase }),
    });
    expect(convert).toHaveBeenCalledTimes(2);
    const entries = await readZipEntries(zip);
    expect(entries.map((entry) => entry.name)).toEqual([
      "2026-08-20 - Store.jpg",
      "2026-08-20 - Second.jpg",
    ]);
    expect(entries.every((entry) => entry.method === 0)).toBe(true);
    expect(progress.some((item) => item.phase === "fetching")).toBe(true);
    expect(progress.some((item) => item.phase === "converting")).toBe(true);
    expect(progress.some((item) => item.phase === "packaging")).toBe(true);
    expect(progress.at(-1)).toEqual({ percentage: 100, completed: 2, total: 2, phase: "complete" });
    expect(receiptExportZipFilename({ fromDate: "2026-08-01", toDate: "2026-08-20" })).toBe("receipts-2026-08-01-to-2026-08-20.zip");
  });

  it("passes JPEG parts directly to the ZIP Blob without a giant local-data buffer", async () => {
    const imageBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const originalBlob = globalThis.Blob;
    const capturedParts: BlobPart[][] = [];
    class CapturingBlob extends originalBlob {
      constructor(parts?: BlobPart[], options?: BlobPropertyBag) {
        if (parts) capturedParts.push(parts);
        super(parts, options);
      }
    }
    vi.stubGlobal("Blob", CapturingBlob);

    try {
      const zip = createStoredZip([{ name: "receipt.jpg", data: imageBytes }]);
      expect(zip.type).toBe("application/zip");
      expect(capturedParts).toHaveLength(1);
      expect(capturedParts[0]).toHaveLength(4);
      expect(capturedParts[0][1]).toBe(imageBytes);
      expect(capturedParts[0][0]).toBeInstanceOf(Uint8Array);
      expect(capturedParts[0][2]).toBeInstanceOf(Uint8Array);
      expect(capturedParts[0][3]).toBeInstanceOf(Uint8Array);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("does not produce a ZIP when conversion fails", async () => {
    await expect(buildReceiptExportZip([receipt({ id: "bad" })], {
      getImageUrl: async () => "https://signed/bad",
      fetchImage: async () => ({ ok: true, status: 200, blob: async () => new Blob(["webp"], { type: "image/webp" }) } as Response),
      convert: async () => { throw new Error("FFmpeg unavailable"); },
    })).rejects.toThrow("Failed to export 2026-08-20 - Store.jpg (receipt bad): FFmpeg unavailable");
  });
});
