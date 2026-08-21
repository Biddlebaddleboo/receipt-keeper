import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AddPrepaidPurchaseFlow } from "@/components/prepaid/AddPrepaidPurchaseFlow";

const mocks = vi.hoisted(() => ({
  createReceiptViaSignedUpload: vi.fn(),
  uploadPrepaidImage: vi.fn(),
  createPurchase: vi.fn(),
  extractPackage: vi.fn(),
  convertReceiptImageFile: vi.fn(),
}));

vi.mock("@/hooks/useReceiptApi", () => ({
  useReceiptApi: () => ({
    createReceiptViaSignedUpload: mocks.createReceiptViaSignedUpload,
  }),
}));

vi.mock("@/hooks/usePrepaidApi", () => ({
  usePrepaidApi: () => ({
    uploadPrepaidImage: mocks.uploadPrepaidImage,
    createPurchase: mocks.createPurchase,
    extractPackage: mocks.extractPackage,
  }),
}));

vi.mock("@/lib/ffmpegImageConverter", () => ({
  convertReceiptImageFile: mocks.convertReceiptImageFile,
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

function imageFile(name: string) {
  return new File(["image"], name, { type: "image/jpeg" });
}

function webpFile(name: string) {
  return new File(["image"], name, { type: "image/webp" });
}

async function addFileToFirstInput(container: HTMLElement, file: File) {
  const input = container.querySelector("input[type='file']") as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
}

describe("AddPrepaidPurchaseFlow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.convertReceiptImageFile.mockImplementation((file: File) => Promise.resolve(webpFile(file.name.replace(/\.[^.]+$/, ".webp"))));
    mocks.createReceiptViaSignedUpload.mockResolvedValue({ id: "receipt-1" });
    mocks.uploadPrepaidImage
      .mockResolvedValueOnce("receipts/u_owner/prepaid/activation/one.webp")
      .mockResolvedValueOnce("receipts/u_owner/prepaid/package/one.webp")
      .mockResolvedValue("receipts/u_owner/prepaid/retry.webp");
    mocks.createPurchase
      .mockRejectedValueOnce(new Error("prepaid save failed"))
      .mockResolvedValueOnce({ id: "purchase-1" });
  });

  it("reuses the saved sales receipt id after prepaid save failure", async () => {
    const onSaved = vi.fn();
    const { container } = render(<AddPrepaidPurchaseFlow onClose={vi.fn()} onSaved={onSaved} />);

    await addFileToFirstInput(container, imageFile("sales.jpg"));
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    await screen.findByText(/sales receipt saved/i);
    expect(mocks.createReceiptViaSignedUpload).toHaveBeenCalledTimes(1);

    await addFileToFirstInput(container, imageFile("activation.jpg"));
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    await addFileToFirstInput(container, imageFile("package.jpg"));
    fireEvent.change(screen.getByPlaceholderText("30-digit package barcode"), {
      target: { value: "123456789012345678901234567890" },
    });
    fireEvent.change(screen.getByPlaceholderText("11-digit Vanilla serial"), {
      target: { value: "12345678901" },
    });
    fireEvent.change(screen.getByPlaceholderText("Denomination"), {
      target: { value: "75" },
    });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    fireEvent.click(screen.getByRole("button", { name: /save purchase/i }));
    await screen.findByText("prepaid save failed");

    fireEvent.click(screen.getByRole("button", { name: /save purchase/i }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));

    expect(mocks.createReceiptViaSignedUpload).toHaveBeenCalledTimes(1);
    expect(mocks.createPurchase).toHaveBeenCalledTimes(2);
    expect(mocks.createPurchase).toHaveBeenLastCalledWith(expect.objectContaining({
      sales_receipt_id: "receipt-1",
    }));
  });
});
