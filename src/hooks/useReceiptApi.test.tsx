import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useReceiptApi } from "@/hooks/useReceiptApi";
import { filterReceiptsForExport, receiptExportFilename } from "@/lib/receiptExport";

const mocks = vi.hoisted(() => ({
  collection: vi.fn(),
  doc: vi.fn(),
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    token: "token",
    user: { email: "owner@example.com" },
    isLoading: false,
    firebaseUID: "owner-id",
    isFirebaseReady: true,
  }),
}));

vi.mock("@/lib/firebase", () => ({ db: {} }));

vi.mock("firebase/firestore/lite", () => ({
  collection: mocks.collection,
  doc: mocks.doc,
  getDoc: mocks.getDoc,
  getDocs: mocks.getDocs,
  query: mocks.query,
  where: mocks.where,
}));

const fakeDoc = (id: string, data: Record<string, unknown>) => ({ id, data: () => data });

describe("useReceiptApi canonical export fields", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.collection.mockImplementation((_db: unknown, ...path: string[]) => ({ path: path.join("/") }));
    mocks.doc.mockImplementation((_db: unknown, ...path: string[]) => ({ path: path.join("/") }));
    mocks.query.mockImplementation((reference: unknown) => reference);
    mocks.where.mockReturnValue({});
    mocks.getDocs.mockResolvedValue({
      docs: [fakeDoc("shard-1", {
        _schema: "receipt_shard",
        owner_email: "owner@example.com",
        receipt_metadata: {
          corrected: {
            vendor: "Corrected Store",
            subtotal: 10,
            tax: 1,
            total: 11,
            category: "Corrected category",
            purchase_date: "2026/08/20",
            created_at: "2026-08-20T00:00:00.000Z",
          },
          fallback: {
            created_at: "2026-08-21T00:00:00.000Z",
          },
          empty: {
            created_at: "2026-08-22T00:00:00.000Z",
          },
        },
      })],
    });
    mocks.getDoc.mockImplementation(async (reference: { path: string }) => {
      const id = reference.path.split("/").at(-1);
      if (id === "empty") {
        return {
          exists: () => true,
          data: () => ({
            extracted_fields: {
              ai_suggestions: {
                vendor: "AI-only store",
                subtotal: 99,
                tax: 9,
                total: 108,
                category: "AI-only category",
                purchase_date: "2018-01-01",
                items: [{ name: "AI-only item", quantity: 1, price: 99 }],
              },
            },
          }),
        };
      }
      if (id === "corrected") {
        return {
          exists: () => true,
          data: () => ({
            vendor: "Historical detail store",
            subtotal: 20,
            tax: 2,
            total: 22,
            category: "Historical detail category",
            purchase_date: "2020-01-01",
            extracted_fields: {
              ai_suggestions: {
                vendor: "AI store",
                subtotal: 99,
                tax: 9,
                total: 108,
                category: "AI category",
                purchase_date: "2019-01-01",
                items: [{ name: "AI item", quantity: 1, price: 99 }],
              },
            },
          }),
        };
      }
      return {
        exists: () => true,
        data: () => ({
          vendor: "Detail fallback store",
          subtotal: 5,
          tax: 0.5,
          total: 5.5,
          items: [{ name: "Canonical item", quantity: 1, price: 5 }],
          category: "Detail fallback category",
          purchase_date: "2026-08-21",
          extracted_fields: {
            ai_suggestions: {
              vendor: "AI fallback store",
              subtotal: 99,
              tax: 9,
              total: 108,
              category: "AI fallback category",
              purchase_date: "2018-01-01",
              items: [{ name: "AI fallback item", quantity: 1, price: 99 }],
            },
          },
        }),
      };
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prefers corrected metadata and only falls back to canonical detail fields", async () => {
    const { result } = renderHook(() => useReceiptApi({ pollingPaused: true }));

    const corrected = await result.current.fetchReceipt("corrected");
    const fallback = await result.current.fetchReceipt("fallback");
    const empty = await result.current.fetchReceipt("empty");

    expect(corrected).toMatchObject({
      vendor: "Corrected Store",
      subtotal: 10,
      tax: 1,
      total: 11,
      category: "Corrected category",
      purchase_date: "2026/08/20",
    });
    expect(fallback).toMatchObject({
      vendor: "Detail fallback store",
      subtotal: 5,
      tax: 0.5,
      total: 5.5,
      items: [{ name: "Canonical item", quantity: 1, price: 5 }],
      category: "Detail fallback category",
      purchase_date: "2026-08-21",
    });
    expect(corrected?.items).toEqual([]);
    expect(corrected?.category).not.toBe("AI category");
    expect(corrected?.purchase_date).not.toBe("2019-01-01");
    expect(corrected?.vendor).not.toBe("AI store");
    expect(corrected?.subtotal).not.toBe(99);
    expect(corrected?.tax).not.toBe(9);
    expect(corrected?.total).not.toBe(108);
    expect(fallback?.category).not.toBe("AI fallback category");
    expect(fallback?.purchase_date).not.toBe("2018-01-01");
    expect(fallback?.vendor).not.toBe("AI fallback store");
    expect(fallback?.items).not.toEqual([{ name: "AI fallback item", quantity: 1, price: 99 }]);
    const correctedExport = filterReceiptsForExport([corrected!], {
      fromDate: "2026-08-20",
      toDate: "2026-08-20",
      categories: ["Corrected category"],
    });
    expect(correctedExport).toHaveLength(1);
    expect(receiptExportFilename(correctedExport[0], new Map())).toBe("2026-08-20 - Corrected Store.jpg");
    expect(empty).toMatchObject({
      vendor: "",
      subtotal: 0,
      tax: 0,
      total: 0,
      category: "",
      purchase_date: "",
      items: [],
    });
  });

  it("deduplicates receipt IDs returned from multiple shard metadata maps", async () => {
    const firstShardIDs = Array.from({ length: 14 }, (_value, index) => `receipt-${index + 1}`);
    const secondShardIDs = Array.from({ length: 7 }, (_value, index) => `receipt-${index + 15}`);
    const metadata = (ids: string[]) => Object.fromEntries(ids.map((id) => [id, {
      vendor: `Store ${id}`,
      subtotal: 10,
      tax: 1,
      total: 11,
      category: "Corrected category",
      purchase_date: "2026-08-20",
      created_at: "2026-08-20T00:00:00.000Z",
    }]));
    mocks.getDocs.mockResolvedValue({
      docs: [
        fakeDoc("shard-a", { _schema: "receipt_shard", receipt_metadata: metadata(firstShardIDs) }),
        fakeDoc("shard-b", {
          _schema: "receipt_shard",
          receipt_metadata: { ...metadata(secondShardIDs), ...metadata(["receipt-1"]) },
        }),
      ],
    });

    const { result } = renderHook(() => useReceiptApi({ pollingPaused: true }));
    const receipts = await result.current.fetchAllReceipts();

    expect(receipts).toHaveLength(21);
    expect(new Set(receipts.map((receipt) => receipt.id)).size).toBe(21);
    expect(mocks.getDoc).not.toHaveBeenCalled();
  });

  it("loads detail only for missing metadata fields and keeps metadata authoritative", async () => {
    mocks.getDocs.mockResolvedValue({
      docs: [fakeDoc("shard-1", {
        _schema: "receipt_shard",
        receipt_metadata: {
          legacy: {
            vendor: "Corrected metadata store",
            subtotal: 10,
            tax: 1,
            total: 11,
            category: "Corrected category",
            created_at: "2026-08-07T00:00:00.000Z",
          },
        },
      })],
    });
    mocks.getDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({
        vendor: "Historical detail store",
        subtotal: 20,
        tax: 2,
        total: 22,
        category: "Historical detail category",
        purchase_date: "2026-08-07",
        extracted_fields: {
          ai_suggestions: {
            vendor: "AI store",
            category: "AI category",
            purchase_date: "2018-01-01",
            subtotal: 99,
            tax: 9,
            total: 108,
          },
        },
      }),
    });

    const { result } = renderHook(() => useReceiptApi({ pollingPaused: true }));
    const receipts = await result.current.fetchAllReceipts();

    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({
      id: "legacy",
      vendor: "Corrected metadata store",
      subtotal: 10,
      tax: 1,
      total: 11,
      category: "Corrected category",
      purchase_date: "2026-08-07",
    });
    const matching = filterReceiptsForExport(receipts, {
      fromDate: "2026-08-07",
      toDate: "2026-08-07",
      categories: ["Corrected category"],
    });
    expect(matching).toHaveLength(1);
    expect(receiptExportFilename(matching[0], new Map())).toBe("2026-08-07 - Corrected metadata store.jpg");
    expect(mocks.getDoc).toHaveBeenCalledTimes(1);
  });
});
