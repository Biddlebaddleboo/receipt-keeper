import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReceiptDetail } from "@/components/ReceiptDetail";
import type { Receipt } from "@/hooks/useReceiptApi";

const mocks = vi.hoisted(() => ({
  fetchSignedReceiptImageUrl: vi.fn(),
  convertImageBlobToJpeg: vi.fn(),
  apiFetch: vi.fn(),
  firestoreDoc: vi.fn(),
  updateDoc: vi.fn(),
}));

vi.mock("@/hooks/useCategoryApi", () => ({ useCategoryApi: () => ({ categories: [] }) }));
vi.mock("@/lib/receiptImage", () => ({ fetchSignedReceiptImageUrl: mocks.fetchSignedReceiptImageUrl }));
vi.mock("@/lib/nativeImageConverter", () => ({ convertImageBlobToJpeg: mocks.convertImageBlobToJpeg }));
vi.mock("@/lib/api", () => ({ apiFetch: mocks.apiFetch }));
vi.mock("@/lib/firebase", () => ({ db: {} }));
vi.mock("firebase/firestore/lite", () => ({ doc: mocks.firestoreDoc, updateDoc: mocks.updateDoc, FieldPath: class {} }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const receipt: Receipt = {
  id: "receipt-1",
  vendor: "Example Store",
  subtotal: 10,
  tax: 1,
  total: 11,
  category: "Food",
  purchase_date: "2026-08-20",
  extracted_text: "",
  extracted_fields: [],
  items: [],
  created_at: "2026-08-20T00:00:00.000Z",
  status: "success",
};

describe("ReceiptDetail download", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchSignedReceiptImageUrl.mockResolvedValue("https://signed.example/receipt.webp");
    mocks.convertImageBlobToJpeg.mockImplementation(async () => new Blob([
      new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
    ], { type: "image/jpeg" }));
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      blob: async () => new Blob(["webp"], { type: "image/webp" }),
    })));
  });

  it("converts the normal individual receipt download and saves a JPG filename", async () => {
    let downloadedName = "";
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function () {
      downloadedName = this.download;
    });

    render(
      <ReceiptDetail
        receipt={receipt}
        onClose={vi.fn()}
        onRemove={vi.fn()}
        onRetry={vi.fn()}
        fetchReceipt={vi.fn().mockResolvedValue(receipt)}
      />,
    );

    const downloadButton = await screen.findByRole("button", { name: "Download receipt" });
    fireEvent.click(downloadButton);

    await waitFor(() => expect(mocks.convertImageBlobToJpeg).toHaveBeenCalledWith(expect.objectContaining({ type: "image/webp" })));
    expect(downloadedName).toBe("receipt-Example Store.jpg");
  });

  it("writes purchase dates through the canonical normalization boundary", async () => {
    render(
      <ReceiptDetail
        receipt={{ ...receipt, purchase_date: "2026-07-23", shard_doc_id: "shard-1" }}
        onClose={vi.fn()}
        onRemove={vi.fn()}
        onRetry={vi.fn()}
        fetchReceipt={vi.fn().mockResolvedValue(receipt)}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Purchase Date/ }));
    const dateInput = document.querySelector('input[type="date"]');
    expect(dateInput).not.toBeNull();
    fireEvent.change(dateInput, { target: { value: "2026-07-23" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(mocks.updateDoc).toHaveBeenCalled());
    expect(mocks.updateDoc.mock.calls[0][1]).toEqual({ purchase_date: "2026-07-23" });
  });
});
