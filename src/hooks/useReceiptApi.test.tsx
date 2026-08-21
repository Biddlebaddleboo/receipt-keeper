import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildReceiptExportZip, filterReceiptsForExport } from "@/lib/receiptExport";
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

const jpegBlob = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: "image/jpeg" });

const fakeDoc = (id: string, data: Record<string, unknown>) => ({ id, data: () => data });
const snapshot = (docs: Array<ReturnType<typeof fakeDoc>>) => ({ docs });

const readBlob = (blob: Blob): Promise<ArrayBuffer> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onerror = () => reject(reader.error);
  reader.onload = () => resolve(reader.result as ArrayBuffer);
  reader.readAsArrayBuffer(blob);
});

const countZipEntries = async (zip: Blob) => {
  const bytes = new Uint8Array(await readBlob(zip));
  const view = new DataView(bytes.buffer);
  let count = 0;
  let offset = 0;
  while (offset + 4 <= bytes.length && view.getUint32(offset, true) === 0x04034b50) {
    const filenameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const size = view.getUint32(offset + 22, true);
    count += 1;
    offset += 30 + filenameLength + extraLength + size;
  }
  return count;
};

describe("useReceiptApi fetchAllReceipts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.collection.mockImplementation((_db: unknown, ...path: string[]) => ({ path: path.join("/") }));
    mocks.query.mockImplementation((reference: unknown) => reference);
    mocks.where.mockReturnValue({});
    mocks.doc.mockImplementation((_db: unknown, ...path: string[]) => ({ path: path.join("/") }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("enumerates every shard and merges authoritative details before export filters", async () => {
    const matchingIDs = [
      ...Array.from({ length: 16 }, (_value, index) => `receipt-${String(index + 1).padStart(2, "0")}`),
      "detail-only",
    ];
    const shardAIDs = matchingIDs.slice(0, 8);
    const shardBIDs = matchingIDs.slice(8, 16);
    const staleMetadata = (id: string) => ({
      vendor: `Stale ${id}`,
      category: "Stale",
      purchase_date: "2020-01-01",
      created_at: "2020-01-01T00:00:00.000Z",
    });
    const detailData = (id: string) => ({
      vendor: `Detail ${id}`,
      category: "Food",
      purchase_date: "2026-08-20",
      created_at: "2026-08-20T00:00:00.000Z",
    });
    const shardA = fakeDoc("shard-a", {
      _schema: "receipt_shard",
      owner_email: "owner@example.com",
      receipt_metadata: Object.fromEntries(shardAIDs.map((id) => [id, staleMetadata(id)])),
    });
    const shardB = fakeDoc("shard-b", {
      _schema: "receipt_shard",
      owner_email: "owner@example.com",
      receipt_metadata: {
        ...Object.fromEntries(shardBIDs.map((id) => [id, staleMetadata(id)])),
        // This duplicate must not overwrite the detail-backed entry from shard A.
        "receipt-01": staleMetadata("receipt-01-duplicate"),
        "not-a-match": staleMetadata("not-a-match"),
      },
    });
    const shardADetails = [
      ...shardAIDs.map((id) => fakeDoc(id, detailData(id))),
      // A detail document without a summary entry is still part of its shard.
      fakeDoc("detail-only", detailData("detail-only")),
    ];
    const shardBDetails = [
      ...shardBIDs.map((id) => fakeDoc(id, detailData(id))),
      fakeDoc("not-a-match", {
        vendor: "Detail not-a-match",
        category: "Travel",
        purchase_date: "2026-07-01",
        created_at: "2026-07-01T00:00:00.000Z",
      }),
    ];
    mocks.getDocs.mockImplementation(async (reference: { path: string }) => {
      if (reference.path === "receipts") return snapshot([shardA, shardB]);
      if (reference.path === "receipts/shard-a/details") return snapshot(shardADetails);
      if (reference.path === "receipts/shard-b/details") return snapshot(shardBDetails);
      throw new Error(`Unexpected collection: ${reference.path}`);
    });

    const { result } = renderHook(() => useReceiptApi({ pollingPaused: true }));
    const allReceipts = await result.current.fetchAllReceipts();
    const filters = {
      fromDate: "2026-08-20",
      toDate: "2026-08-20",
      categories: ["Food"],
    };
    const matchingReceipts = filterReceiptsForExport(allReceipts, filters);

    expect(mocks.getDocs).toHaveBeenCalledWith(expect.objectContaining({ path: "receipts/shard-a/details" }));
    expect(mocks.getDocs).toHaveBeenCalledWith(expect.objectContaining({ path: "receipts/shard-b/details" }));
    expect(mocks.getDocs).toHaveBeenCalledTimes(3);
    expect(allReceipts).toHaveLength(18);
    expect(new Set(allReceipts.map((receipt) => receipt.id)).size).toBe(allReceipts.length);
    expect(matchingReceipts).toHaveLength(17);
    expect(matchingReceipts.length).toBeGreaterThan(14);
    expect(new Set(matchingReceipts.map((receipt) => receipt.id))).toEqual(new Set(matchingIDs));
    expect(allReceipts.filter((receipt) => receipt.id === "receipt-01")).toHaveLength(1);
    expect(allReceipts.find((receipt) => receipt.id === "receipt-01")).toMatchObject({
      vendor: "Detail receipt-01",
      category: "Food",
      purchase_date: "2026-08-20",
    });

    const getImageUrl = vi.fn(async (receipt) => `https://signed.example/${receipt.id}`);
    const zip = await buildReceiptExportZip(allReceipts, {
      ...filters,
      getImageUrl,
      fetchImage: async () => ({
        ok: true,
        status: 200,
        blob: async () => new Blob(["webp"], { type: "image/webp" }),
      } as Response),
      convert: async () => jpegBlob,
    });

    expect(getImageUrl).toHaveBeenCalledTimes(17);
    expect(new Set(getImageUrl.mock.calls.map(([receipt]) => receipt.id))).toEqual(new Set(matchingIDs));
    expect(await countZipEntries(zip)).toBe(17);
  });
});
