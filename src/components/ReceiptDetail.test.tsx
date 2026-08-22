import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReceiptDetail } from "@/components/ReceiptDetail";
import type { Receipt } from "@/hooks/useReceiptApi";

const mocks = vi.hoisted(() => ({
  fetchSignedReceiptImageUrl: vi.fn(),
  convertImageBlobToJpeg: vi.fn(),
  autoCropReceiptImage: vi.fn(),
  convertReceiptImageFile: vi.fn(),
  uploadReceiptImage: vi.fn(),
  replaceReceiptImage: vi.fn(),
  apiFetch: vi.fn(),
  firestoreDoc: vi.fn(),
  updateDoc: vi.fn(),
  createObjectURL: vi.fn(),
  revokeObjectURL: vi.fn(),
  toastSuccess: vi.fn(),
  toastWarning: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/hooks/useCategoryApi", () => ({ useCategoryApi: () => ({ categories: [] }) }));
vi.mock("@/lib/receiptImage", () => ({ fetchSignedReceiptImageUrl: mocks.fetchSignedReceiptImageUrl }));
vi.mock("@/lib/nativeImageConverter", () => ({ convertImageBlobToJpeg: mocks.convertImageBlobToJpeg }));
vi.mock("@/lib/receiptAutoCrop", () => ({ autoCropReceiptImage: mocks.autoCropReceiptImage }));
vi.mock("@/lib/ffmpegImageConverter", () => ({ convertReceiptImageFile: mocks.convertReceiptImageFile }));
vi.mock("@/components/BrowserCamera", () => ({
  BrowserCamera: ({ open, onCapture, onClose }: { open: boolean; onCapture: (file: File) => void; onClose: () => void }) => (
    open ? (
      <div>
        <button type="button" onClick={() => onCapture(new File(["camera"], "camera.jpg", { type: "image/jpeg" }))}>Shared camera capture</button>
        <button type="button" onClick={onClose}>Cancel camera</button>
      </div>
    ) : null
  ),
}));
vi.mock("@/lib/api", () => ({ apiFetch: mocks.apiFetch }));
vi.mock("@/lib/firebase", () => ({ db: {} }));
vi.mock("firebase/firestore/lite", () => ({ doc: mocks.firestoreDoc, updateDoc: mocks.updateDoc, FieldPath: class {} }));
vi.mock("sonner", () => ({ toast: { success: mocks.toastSuccess, warning: mocks.toastWarning, error: mocks.toastError } }));

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
    mocks.autoCropReceiptImage.mockImplementation(async (file: File) => file);
    mocks.convertReceiptImageFile.mockResolvedValue(new File(["webp"], "receipt.webp", { type: "image/webp" }));
    mocks.uploadReceiptImage.mockResolvedValue("receipts/u_owner/replacement.webp");
    mocks.replaceReceiptImage.mockResolvedValue({ receipt_id: receipt.id, storage_path: "receipts/u_owner/replacement.webp" });
    mocks.createObjectURL.mockReturnValue("blob:crop-preview");
    vi.stubGlobal("URL", { createObjectURL: mocks.createObjectURL, revokeObjectURL: mocks.revokeObjectURL });
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
        uploadReceiptImage={mocks.uploadReceiptImage}
        replaceReceiptImage={mocks.replaceReceiptImage}
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
        uploadReceiptImage={mocks.uploadReceiptImage}
        replaceReceiptImage={mocks.replaceReceiptImage}
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

  it("allows invoice IDs to be edited, cleared, and saved without OCR", async () => {
    const editableReceipt = { ...receipt, invoice_id: "0007-ABC", shard_doc_id: "shard-1" };
    const fetchReceipt = vi.fn().mockResolvedValue(editableReceipt);
    render(
      <ReceiptDetail
        receipt={editableReceipt}
        onClose={vi.fn()}
        onRemove={vi.fn()}
        onRetry={vi.fn()}
        fetchReceipt={fetchReceipt}
        uploadReceiptImage={mocks.uploadReceiptImage}
        replaceReceiptImage={mocks.replaceReceiptImage}
      />,
    );

    const invoiceButton = await screen.findByRole("button", { name: /Invoice ID/ });
    expect(invoiceButton).toHaveTextContent("0007-ABC");
    fireEvent.click(invoiceButton);
    const invoiceInput = screen.getByLabelText("Invoice ID");
    fireEvent.change(invoiceInput, { target: { value: "INV-0009-X" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(mocks.updateDoc).toHaveBeenCalled());
    expect(mocks.updateDoc.mock.calls[0][1]).toEqual({ invoice_id: "INV-0009-X" });
    expect(mocks.apiFetch).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: /Invoice ID/ }));
    fireEvent.change(screen.getByLabelText("Invoice ID"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(mocks.updateDoc.mock.calls.at(-2)?.[1]).toEqual({ invoice_id: "" }));
  });

  it("crops and replaces only the existing image without OCR or finalize-upload", async () => {
    const cropped = new File(["cropped"], "cropped.jpg", { type: "image/jpeg" });
    mocks.autoCropReceiptImage.mockResolvedValue(cropped);
    const fetchReceipt = vi.fn().mockResolvedValue(receipt);
    render(
      <ReceiptDetail
        receipt={receipt}
        onClose={vi.fn()}
        onRemove={vi.fn()}
        onRetry={vi.fn()}
        fetchReceipt={fetchReceipt}
        uploadReceiptImage={mocks.uploadReceiptImage}
        replaceReceiptImage={mocks.replaceReceiptImage}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Crop Image" }));

    expect(await screen.findByRole("img", { name: "Cropped receipt preview" })).toHaveAttribute("src", "blob:crop-preview");
    expect(mocks.convertReceiptImageFile).not.toHaveBeenCalled();
    expect(mocks.uploadReceiptImage).not.toHaveBeenCalled();
    expect(mocks.replaceReceiptImage).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Apply Crop" }));

    await waitFor(() => expect(mocks.replaceReceiptImage).toHaveBeenCalledWith(receipt.id, "receipts/u_owner/replacement.webp"));
    expect(mocks.autoCropReceiptImage).toHaveBeenCalledTimes(1);
    expect(mocks.autoCropReceiptImage).toHaveBeenCalledWith(expect.objectContaining({ type: "image/webp" }));
    expect(mocks.convertReceiptImageFile).toHaveBeenCalledWith(cropped);
    expect(mocks.uploadReceiptImage).toHaveBeenCalledWith(expect.objectContaining({ type: "image/webp" }));
    expect(mocks.apiFetch).not.toHaveBeenCalled();
    expect(fetchReceipt).toHaveBeenCalledWith(receipt.id);
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Receipt image cropped");
    expect(mocks.toastWarning).not.toHaveBeenCalled();
    expect(mocks.revokeObjectURL).toHaveBeenCalledWith("blob:crop-preview");
  });

  it("forwards Replace Image camera captures through the existing replacement flow", async () => {
    const cameraFile = new File(["camera"], "camera.jpg", { type: "image/jpeg" });
    render(
      <ReceiptDetail
        receipt={receipt}
        onClose={vi.fn()}
        onRemove={vi.fn()}
        onRetry={vi.fn()}
        fetchReceipt={vi.fn().mockResolvedValue(receipt)}
        uploadReceiptImage={mocks.uploadReceiptImage}
        replaceReceiptImage={mocks.replaceReceiptImage}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Replace Image (Camera)" }));
    fireEvent.click(screen.getByRole("button", { name: "Shared camera capture" }));

    await waitFor(() => expect(mocks.replaceReceiptImage).toHaveBeenCalled());
    expect(mocks.autoCropReceiptImage).toHaveBeenCalledWith(expect.objectContaining({ name: cameraFile.name, type: cameraFile.type }));
    expect(mocks.convertReceiptImageFile).toHaveBeenCalled();
  });

  it("keeps a successful replacement successful while warning about old-image cleanup", async () => {
    mocks.autoCropReceiptImage.mockResolvedValue(new File(["cropped"], "cropped.jpg", { type: "image/jpeg" }));
    mocks.replaceReceiptImage.mockResolvedValue({
      receipt_id: receipt.id,
      storage_path: "receipts/u_owner/replacement.webp",
      old_image_delete_error: "permission denied",
    });
    const fetchReceipt = vi.fn().mockResolvedValue(receipt);
    render(
      <ReceiptDetail
        receipt={receipt}
        onClose={vi.fn()}
        onRemove={vi.fn()}
        onRetry={vi.fn()}
        fetchReceipt={fetchReceipt}
        uploadReceiptImage={mocks.uploadReceiptImage}
        replaceReceiptImage={mocks.replaceReceiptImage}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Crop Image" }));
    await screen.findByRole("img", { name: "Cropped receipt preview" });
    expect(mocks.convertReceiptImageFile).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Apply Crop" }));

    await waitFor(() => expect(mocks.toastWarning).toHaveBeenCalledWith(
      "New image saved successfully, but the previous GCS image could not be deleted: permission denied",
    ));
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(fetchReceipt).toHaveBeenCalledWith(receipt.id);
    expect(mocks.fetchSignedReceiptImageUrl).toHaveBeenCalledWith(receipt.id);
  });

  it("cancels a crop preview without conversion, upload, or replacement", async () => {
    mocks.autoCropReceiptImage.mockResolvedValue(new File(["cropped"], "cropped.jpg", { type: "image/jpeg" }));
    render(
      <ReceiptDetail
        receipt={receipt}
        onClose={vi.fn()}
        onRemove={vi.fn()}
        onRetry={vi.fn()}
        fetchReceipt={vi.fn().mockResolvedValue(receipt)}
        uploadReceiptImage={mocks.uploadReceiptImage}
        replaceReceiptImage={mocks.replaceReceiptImage}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Crop Image" }));
    await screen.findByRole("img", { name: "Cropped receipt preview" });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("img", { name: "Cropped receipt preview" })).toBeNull());
    expect(mocks.convertReceiptImageFile).not.toHaveBeenCalled();
    expect(mocks.uploadReceiptImage).not.toHaveBeenCalled();
    expect(mocks.replaceReceiptImage).not.toHaveBeenCalled();
    expect(mocks.revokeObjectURL).toHaveBeenCalledWith("blob:crop-preview");
  });

  it("revokes the crop preview URL when the detail closes", async () => {
    mocks.autoCropReceiptImage.mockResolvedValue(new File(["cropped"], "cropped.jpg", { type: "image/jpeg" }));
    const { unmount } = render(
      <ReceiptDetail
        receipt={receipt}
        onClose={vi.fn()}
        onRemove={vi.fn()}
        onRetry={vi.fn()}
        fetchReceipt={vi.fn().mockResolvedValue(receipt)}
        uploadReceiptImage={mocks.uploadReceiptImage}
        replaceReceiptImage={mocks.replaceReceiptImage}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Crop Image" }));
    await screen.findByRole("img", { name: "Cropped receipt preview" });
    unmount();

    expect(mocks.revokeObjectURL).toHaveBeenCalledWith("blob:crop-preview");
  });

  it("does not create a replacement when the crop detector finds no worthwhile crop", async () => {
    render(
      <ReceiptDetail
        receipt={receipt}
        onClose={vi.fn()}
        onRemove={vi.fn()}
        onRetry={vi.fn()}
        fetchReceipt={vi.fn().mockResolvedValue(receipt)}
        uploadReceiptImage={mocks.uploadReceiptImage}
        replaceReceiptImage={mocks.replaceReceiptImage}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Crop Image" }));
    await waitFor(() => expect(mocks.autoCropReceiptImage).toHaveBeenCalled());
    expect(screen.queryByRole("img", { name: "Cropped receipt preview" })).toBeNull();
    expect(mocks.uploadReceiptImage).not.toHaveBeenCalled();
    expect(mocks.replaceReceiptImage).not.toHaveBeenCalled();
  });

  it("replaces an image selected from the file input through the WebP pipeline", async () => {
    const replacement = new File(["replacement"], "replacement.png", { type: "image/png" });
    render(
      <ReceiptDetail
        receipt={receipt}
        onClose={vi.fn()}
        onRemove={vi.fn()}
        onRetry={vi.fn()}
        fetchReceipt={vi.fn().mockResolvedValue(receipt)}
        uploadReceiptImage={mocks.uploadReceiptImage}
        replaceReceiptImage={mocks.replaceReceiptImage}
      />,
    );

    await screen.findByRole("button", { name: "Crop Image" });
    const replacementInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(replacementInput).not.toBeNull();
    fireEvent.change(replacementInput, { target: { files: [replacement] } });

    await waitFor(() => expect(mocks.replaceReceiptImage).toHaveBeenCalled());
    expect(mocks.autoCropReceiptImage).toHaveBeenCalledWith(replacement);
    expect(mocks.convertReceiptImageFile).toHaveBeenCalled();
  });
});
