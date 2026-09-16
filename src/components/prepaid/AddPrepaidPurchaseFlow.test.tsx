import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AddPrepaidPurchaseFlow } from "@/components/prepaid/AddPrepaidPurchaseFlow";

const mocks = vi.hoisted(() => ({
  createReceiptViaSignedUpload: vi.fn(),
  uploadPrepaidImage: vi.fn(),
  createPurchase: vi.fn(),
  extractPackage: vi.fn(),
  extractCardFront: vi.fn(),
  extractCardBack: vi.fn(),
  convertReceiptImageFile: vi.fn(),
  convertImageFileToGrayscale: vi.fn(),
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
    extractCardFront: mocks.extractCardFront,
    extractCardBack: mocks.extractCardBack,
  }),
}));

vi.mock("@/lib/ffmpegImageConverter", () => ({
  convertReceiptImageFile: mocks.convertReceiptImageFile,
}));

vi.mock("@/lib/nativeImageConverter", () => ({
  convertImageFileToGrayscale: mocks.convertImageFileToGrayscale,
}));

vi.mock("@/lib/receiptAutoCrop", () => ({
  autoCropReceiptImage: vi.fn(async (file: File) => file),
}));

vi.mock("@/components/BrowserCamera", () => ({
  BrowserCamera: ({ open, onCapture, onClose, defaultColorMode = "color" }: { open: boolean; onCapture: (file: File, colorMode?: "grayscale" | "color") => void; onClose: () => void; defaultColorMode?: "grayscale" | "color" }) => (
    open ? (
      <div>
        <button type="button" onClick={() => { onCapture(imageFile("camera.jpg"), defaultColorMode); onClose(); }}>Shared camera capture</button>
        <button type="button" onClick={onClose}>Cancel camera</button>
      </div>
    ) : null
  ),
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

async function addFileToFirstInput(container: HTMLElement, file: File) {
  const input = container.querySelector("input[type='file']") as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
}

describe("AddPrepaidPurchaseFlow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.convertReceiptImageFile.mockImplementation((file: File) => Promise.resolve(webpFile(file.name.replace(/\.[^.]+$/, ".webp"))));
    mocks.convertImageFileToGrayscale.mockImplementation((file: File) => Promise.resolve(file));
    mocks.createReceiptViaSignedUpload.mockResolvedValue({ id: "receipt-1" });
    mocks.extractCardFront.mockResolvedValue({ extraction: { pan: "4111111111111111", expiry: "12/29" }, warnings: [], requires_confirmation: true });
    mocks.extractCardBack.mockResolvedValue({ extraction: { cvv: "123" }, warnings: [], requires_confirmation: true });
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

    fireEvent.click(screen.getByRole("button", { name: "Add activation receipt" }));
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
    expect(mocks.uploadPrepaidImage).toHaveBeenCalledTimes(2);
    expect(mocks.createPurchase).toHaveBeenCalledTimes(2);
    expect(mocks.createPurchase).toHaveBeenLastCalledWith(expect.objectContaining({
      sales_receipt_id: "receipt-1",
    }));
  });

  it("allows skipping optional activation receipts and saves an empty array", async () => {
    const onSaved = vi.fn();
    mocks.uploadPrepaidImage.mockReset();
    mocks.uploadPrepaidImage.mockResolvedValue("receipts/u_owner/prepaid/package/one.webp");
    mocks.createPurchase.mockReset();
    mocks.createPurchase.mockResolvedValue({ id: "purchase-2" });
    const { container } = render(<AddPrepaidPurchaseFlow onClose={vi.fn()} onSaved={onSaved} />);

    await addFileToFirstInput(container, imageFile("sales.jpg"));
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    await screen.findByText(/sales receipt saved/i);

    expect(screen.getByText(/add one or more activation receipt images if available/i)).toBeInTheDocument();
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

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(mocks.createPurchase).toHaveBeenCalledWith(expect.objectContaining({ activation_receipts: [] }));
  });

  it("forwards sales, activation, and package camera captures to their existing handlers", async () => {
    render(<AddPrepaidPurchaseFlow onClose={vi.fn()} onSaved={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Camera" }));
    fireEvent.click(screen.getByRole("button", { name: "Shared camera capture" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Shared camera capture" })).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    await screen.findByText(/sales receipt saved/i);

    fireEvent.click(screen.getByRole("button", { name: "Add activation receipt" }));
    fireEvent.click(screen.getByRole("button", { name: "Camera" }));
    fireEvent.click(screen.getByRole("button", { name: "Shared camera capture" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Shared camera capture" })).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    fireEvent.click(screen.getByRole("button", { name: "Camera" }));
    fireEvent.click(screen.getByRole("button", { name: "Shared camera capture" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Shared camera capture" })).toBeNull());
    fireEvent.change(screen.getByPlaceholderText("30-digit package barcode"), {
      target: { value: "123456789012345678901234567890" },
    });
    fireEvent.change(screen.getByPlaceholderText("11-digit Vanilla serial"), {
      target: { value: "12345678901" },
    });
    fireEvent.change(screen.getByPlaceholderText("Denomination"), { target: { value: "75" } });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    fireEvent.click(screen.getByRole("button", { name: /save purchase/i }));

    await waitFor(() => expect(mocks.createPurchase).toHaveBeenCalled());
    expect(mocks.convertReceiptImageFile).toHaveBeenCalledTimes(3);
    expect(mocks.convertImageFileToGrayscale).toHaveBeenCalledTimes(1);
    expect(mocks.createReceiptViaSignedUpload).toHaveBeenCalledWith(expect.any(File), { image_grayscale: true });
    expect(mocks.uploadPrepaidImage).toHaveBeenCalledTimes(2);
  });

  it("submits stable activation IDs and permits one activation receipt to be shared", async () => {
    const onSaved = vi.fn();
    mocks.uploadPrepaidImage.mockReset();
    mocks.uploadPrepaidImage.mockImplementation(async (_file: File, imageType: string) => `receipts/prepaid/${imageType}.webp`);
    mocks.createPurchase.mockReset();
    mocks.createPurchase.mockResolvedValue({ id: "purchase-shared" });
    const { container } = render(<AddPrepaidPurchaseFlow onClose={vi.fn()} onSaved={onSaved} />);

    await addFileToFirstInput(container, imageFile("sales.jpg"));
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    await screen.findByText(/sales receipt saved/i);
    fireEvent.click(screen.getByRole("button", { name: "Add activation receipt" }));
    await addFileToFirstInput(container, imageFile("activation.jpg"));
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    const firstCardFields = screen.getAllByPlaceholderText("30-digit package barcode");
    fireEvent.change(firstCardFields[0], { target: { value: "123456789012345678901234567890" } });
    fireEvent.change(screen.getAllByPlaceholderText("11-digit Vanilla serial")[0], { target: { value: "12345678901" } });
    fireEvent.change(screen.getAllByPlaceholderText("Denomination")[0], { target: { value: "75" } });
    const firstSelector = screen.getByRole("combobox", { name: "Activation receipt for card 1" });
    const activationID = (firstSelector as HTMLSelectElement).options[1].value;
    fireEvent.change(firstSelector, { target: { value: activationID } });

    fireEvent.click(screen.getByRole("button", { name: "Add another card" }));
    fireEvent.change(screen.getAllByPlaceholderText("30-digit package barcode")[1], { target: { value: "999999999999999999999999999999" } });
    fireEvent.change(screen.getAllByPlaceholderText("11-digit Vanilla serial")[1], { target: { value: "98765432109" } });
    fireEvent.change(screen.getAllByPlaceholderText("Denomination")[1], { target: { value: "50" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Activation receipt for card 2" }), { target: { value: activationID } });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    fireEvent.click(screen.getByRole("button", { name: /save purchase/i }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    const payload = mocks.createPurchase.mock.calls[0][0];
    expect(payload.activation_receipts[0]).toMatchObject({ id: activationID, storage_path: "receipts/prepaid/activation_receipt.webp" });
    expect(payload.activation_receipts[0].id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(payload.cards.map((card: { activation_receipt_id?: string }) => card.activation_receipt_id)).toEqual([activationID, activationID]);
  });

  it("automatically extracts front PAN/expiry and back CVV without crossing fields", async () => {
    const onSaved = vi.fn();
    mocks.uploadPrepaidImage.mockReset();
    mocks.uploadPrepaidImage.mockImplementation(async (_file: File, imageType: string) => `receipts/prepaid/${imageType}.webp`);
    mocks.createPurchase.mockReset();
    mocks.createPurchase.mockResolvedValue({ id: "purchase-front-back" });
    const { container } = render(<AddPrepaidPurchaseFlow onClose={vi.fn()} onSaved={onSaved} />);

    await addFileToFirstInput(container, imageFile("sales.jpg"));
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    await screen.findByText(/sales receipt saved/i);
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    fireEvent.change(screen.getByPlaceholderText("30-digit package barcode"), { target: { value: "123456789012345678901234567890" } });
    fireEvent.change(screen.getByPlaceholderText("11-digit Vanilla serial"), { target: { value: "12345678901" } });
    fireEvent.change(screen.getByPlaceholderText("Denomination"), { target: { value: "75" } });
    const imageInputs = Array.from(container.querySelectorAll("input[type='file']")) as HTMLInputElement[];
    fireEvent.change(imageInputs[1], { target: { files: [imageFile("front.jpg")] } });
    await waitFor(() => expect(mocks.extractCardFront).toHaveBeenCalledWith("receipts/prepaid/card_front.webp"));
    await waitFor(() => expect(screen.getByPlaceholderText("16-digit PAN")).toHaveValue("4111111111111111"));
    expect(screen.getByPlaceholderText("Expiry MM/YY")).toHaveValue("12/29");
    expect(screen.getByPlaceholderText("CVV")).toHaveValue("");

    fireEvent.change(imageInputs[2], { target: { files: [imageFile("back.jpg")] } });
    await waitFor(() => expect(mocks.extractCardBack).toHaveBeenCalledWith("receipts/prepaid/card_back.webp"));
    await waitFor(() => expect(screen.getByPlaceholderText("CVV")).toHaveValue("123"));
    expect(screen.getByPlaceholderText("16-digit PAN")).toHaveValue("4111111111111111");
    expect(screen.getByPlaceholderText("Expiry MM/YY")).toHaveValue("12/29");
  });

  it("ignores stale front extraction and preserves a manual edit made while it runs", async () => {
    const first = deferred<{ extraction: { pan: string; expiry: string }; warnings: string[]; requires_confirmation: boolean }>();
    const second = deferred<{ extraction: { pan: string; expiry: string }; warnings: string[]; requires_confirmation: boolean }>();
    mocks.extractCardFront.mockReset();
    mocks.extractCardFront.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    mocks.uploadPrepaidImage.mockImplementation(async (_file: File, imageType: string) => `receipts/prepaid/${imageType}-${Math.random()}.webp`);
    const { container } = render(<AddPrepaidPurchaseFlow onClose={vi.fn()} onSaved={vi.fn()} />);

    await addFileToFirstInput(container, imageFile("sales.jpg"));
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    await screen.findByText(/sales receipt saved/i);
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    fireEvent.change(screen.getByPlaceholderText("30-digit package barcode"), { target: { value: "123456789012345678901234567890" } });
    fireEvent.change(screen.getByPlaceholderText("11-digit Vanilla serial"), { target: { value: "12345678901" } });
    fireEvent.change(screen.getByPlaceholderText("Denomination"), { target: { value: "75" } });
    const frontInput = Array.from(container.querySelectorAll("input[type='file']"))[1] as HTMLInputElement;
    fireEvent.change(frontInput, { target: { files: [imageFile("front-a.jpg")] } });
    await waitFor(() => expect(mocks.extractCardFront).toHaveBeenCalledTimes(1));
    fireEvent.change(frontInput, { target: { files: [imageFile("front-b.jpg")] } });
    await waitFor(() => expect(mocks.extractCardFront).toHaveBeenCalledTimes(2));
    fireEvent.change(screen.getByPlaceholderText("16-digit PAN"), { target: { value: "4000000000000001" } });
    first.resolve({ extraction: { pan: "1111111111111111", expiry: "01/28" }, warnings: [], requires_confirmation: true });
    second.resolve({ extraction: { pan: "4222222222222222", expiry: "02/30" }, warnings: [], requires_confirmation: true });

    await waitFor(() => expect(screen.getByPlaceholderText("16-digit PAN")).toHaveValue("4000000000000001"));
    expect(screen.getByPlaceholderText("Expiry MM/YY")).toHaveValue("02/30");
  });
});
