import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useReceiptApi } from "@/hooks/useReceiptApi";

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
            category: "Corrected category",
            purchase_date: "2026-08-20",
            created_at: "2026-08-20T00:00:00.000Z",
          },
          fallback: {
            created_at: "2026-08-21T00:00:00.000Z",
          },
        },
      })],
    });
    mocks.getDoc.mockImplementation(async (reference: { path: string }) => {
      const id = reference.path.split("/").at(-1);
      if (id === "corrected") {
        return {
          exists: () => true,
          data: () => ({
            category: "Historical detail category",
            purchase_date: "2020-01-01",
            extracted_fields: {
              ai_suggestions: {
                category: "AI category",
                purchase_date: "2019-01-01",
              },
            },
          }),
        };
      }
      return {
        exists: () => true,
        data: () => ({
          category: "Detail fallback category",
          purchase_date: "2026-08-21",
          extracted_fields: {
            ai_suggestions: {
              category: "AI fallback category",
              purchase_date: "2018-01-01",
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

    expect(corrected).toMatchObject({
      category: "Corrected category",
      purchase_date: "2026-08-20",
    });
    expect(fallback).toMatchObject({
      category: "Detail fallback category",
      purchase_date: "2026-08-21",
    });
    expect(corrected?.category).not.toBe("AI category");
    expect(corrected?.purchase_date).not.toBe("2019-01-01");
    expect(fallback?.category).not.toBe("AI fallback category");
    expect(fallback?.purchase_date).not.toBe("2018-01-01");
  });

  it("deduplicates receipt IDs returned from multiple shard metadata maps", async () => {
    const firstShardIDs = Array.from({ length: 14 }, (_value, index) => `receipt-${index + 1}`);
    const secondShardIDs = Array.from({ length: 7 }, (_value, index) => `receipt-${index + 15}`);
    const metadata = (ids: string[]) => Object.fromEntries(ids.map((id) => [id, {
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
  });
});
