import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AddReceiptForm } from "@/components/AddReceiptForm";

const mocks = vi.hoisted(() => ({
  convertReceiptImageFile: vi.fn(),
  autoCropReceiptImage: vi.fn(),
  convertImageFileToGrayscale: vi.fn(),
}));

vi.mock("@/lib/ffmpegImageConverter", () => ({ convertReceiptImageFile: mocks.convertReceiptImageFile }));
vi.mock("@/lib/receiptAutoCrop", () => ({ autoCropReceiptImage: mocks.autoCropReceiptImage }));
vi.mock("@/lib/nativeImageConverter", () => ({ convertImageFileToGrayscale: mocks.convertImageFileToGrayscale }));

const baseCameraConstraints = {
  facingMode: { exact: "environment" },
  width: { ideal: 1920 },
  height: { ideal: 1080 },
};

const createTrack = (torch: boolean, capabilities: Record<string, unknown> = {}) => ({
  getCapabilities: vi.fn(() => ({ torch, ...capabilities })),
  getConstraints: vi.fn(),
  applyConstraints: vi.fn().mockResolvedValue(undefined),
  stop: vi.fn(),
});

const createStream = (track: ReturnType<typeof createTrack>) => ({
  getVideoTracks: () => [track],
  getTracks: () => [track],
}) as unknown as MediaStream;

describe("AddReceiptForm camera", () => {
  let originalMediaDevices: MediaDevices | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    originalMediaDevices = navigator.mediaDevices;
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value: vi.fn(() => ({ drawImage: vi.fn() })),
    });
    Object.defineProperty(HTMLCanvasElement.prototype, "toBlob", {
      configurable: true,
      value: vi.fn((callback: BlobCallback) => callback(new Blob(["captured"], { type: "image/jpeg" }))),
    });
    Object.defineProperty(HTMLVideoElement.prototype, "videoWidth", { configurable: true, value: 1600 });
    Object.defineProperty(HTMLVideoElement.prototype, "videoHeight", { configurable: true, value: 1000 });
    mocks.autoCropReceiptImage.mockImplementation(async (file: File) => file);
    mocks.convertImageFileToGrayscale.mockImplementation(async (file: File) => file);
    mocks.convertReceiptImageFile.mockResolvedValue(new File(["converted"], "receipt.webp", { type: "image/webp" }));
  });

  afterEach(() => {
    if (originalMediaDevices) {
      Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: originalMediaDevices });
    } else {
      Reflect.deleteProperty(navigator, "mediaDevices");
    }
    vi.restoreAllMocks();
  });

  it("opens the rear-camera preview and enables torch by default", async () => {
    const track = createTrack(true);
    const stream = createStream(track);
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });

    render(<AddReceiptForm onSubmit={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Camera" }));

    const preview = await screen.findByLabelText("Rear camera preview");
    expect(preview).toBeInTheDocument();
    expect(preview).toHaveClass("absolute", "inset-0", "h-full", "w-full", "object-cover");
    expect(preview.parentElement).toHaveClass("h-[100dvh]", "w-full", "bg-black");
    expect(screen.getByRole("button", { name: "Cancel camera" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Capture photo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Grayscale" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel camera" }).parentElement).toHaveClass(
      "pt-[env(safe-area-inset-top)]",
    );
    expect(screen.getByRole("button", { name: "Capture photo" }).parentElement).toHaveClass(
      "pb-[calc(1rem+env(safe-area-inset-bottom))]",
    );
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: false,
      video: baseCameraConstraints,
    });
    expect(track.applyConstraints).toHaveBeenCalledWith({
      ...baseCameraConstraints,
      advanced: [{ torch: true }],
    });
    expect(track.getConstraints).not.toHaveBeenCalled();
  });

  it("enables continuous autofocus while preserving the default torch", async () => {
    const track = createTrack(true, { focusMode: ["continuous", "manual"] });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue(createStream(track)) },
    });

    render(<AddReceiptForm onSubmit={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Camera" }));
    await screen.findByLabelText("Rear camera preview");

    expect(track.applyConstraints).toHaveBeenCalledWith({
      ...baseCameraConstraints,
      advanced: [{ torch: true, focusMode: "continuous" }],
    });
  });

  it("keeps the preview available when focus capabilities are unsupported", async () => {
    const track = createTrack(true, { focusMode: ["manual"] });
    const inputClick = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => undefined);
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue(createStream(track)) },
    });

    render(<AddReceiptForm onSubmit={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Camera" }));
    await screen.findByLabelText("Rear camera preview");

    expect(inputClick).not.toHaveBeenCalled();
    expect(track.applyConstraints).toHaveBeenCalledWith({
      ...baseCameraConstraints,
      advanced: [{ torch: true }],
    });
  });

  it("uses supported points of interest for tap-to-focus", async () => {
    const track = createTrack(true, { focusMode: ["continuous"], pointsOfInterest: [] });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue(createStream(track)) },
    });

    render(<AddReceiptForm onSubmit={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Camera" }));
    const preview = await screen.findByLabelText("Rear camera preview");
    vi.spyOn(preview, "getBoundingClientRect").mockReturnValue({
      left: 10,
      top: 20,
      width: 100,
      height: 200,
      right: 110,
      bottom: 220,
      x: 10,
      y: 20,
      toJSON: () => ({}),
    } as DOMRect);

    fireEvent.click(preview, { clientX: 35, clientY: 120 });
    await waitFor(() => expect(track.applyConstraints).toHaveBeenCalledTimes(2));
    fireEvent.click(preview, { clientX: 85, clientY: 170 });

    await waitFor(() => expect(track.applyConstraints).toHaveBeenCalledTimes(3));
    expect(track.applyConstraints).toHaveBeenNthCalledWith(2, {
      ...baseCameraConstraints,
      advanced: [{
        torch: true,
        focusMode: "continuous",
        pointsOfInterest: [{ x: 0.25, y: 0.5 }],
      }],
    });
    expect(track.applyConstraints).toHaveBeenLastCalledWith({
      ...baseCameraConstraints,
      advanced: [{
        torch: true,
        focusMode: "continuous",
        pointsOfInterest: [{ x: 0.75, y: 0.75 }],
      }],
    });
    expect(track.applyConstraints.mock.calls[2][0].advanced).toHaveLength(1);
  });

  it("does not retry continuous focus after autofocus setup fails", async () => {
    const track = createTrack(true, { focusMode: ["continuous"], pointsOfInterest: [] });
    const inputClick = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => undefined);
    track.applyConstraints.mockImplementation((constraints: MediaTrackConstraints) => {
      const advanced = constraints.advanced ?? [];
      if (advanced.some((entry) => "focusMode" in entry)) return Promise.reject(new Error("focus rejected"));
      return Promise.resolve();
    });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue(createStream(track)) },
    });

    render(<AddReceiptForm onSubmit={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Camera" }));
    const preview = await screen.findByLabelText("Rear camera preview");
    vi.spyOn(preview, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      width: 100,
      height: 100,
      right: 100,
      bottom: 100,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);

    expect(track.applyConstraints).toHaveBeenNthCalledWith(1, {
      ...baseCameraConstraints,
      advanced: [{ torch: true, focusMode: "continuous" }],
    });
    expect(track.applyConstraints).toHaveBeenNthCalledWith(2, {
      ...baseCameraConstraints,
      advanced: [{ torch: true }],
    });

    fireEvent.click(preview, { clientX: 50, clientY: 50 });
    await waitFor(() => expect(track.applyConstraints).toHaveBeenCalledTimes(3));
    expect(track.applyConstraints).toHaveBeenLastCalledWith({
      ...baseCameraConstraints,
      advanced: [{
        torch: true,
        pointsOfInterest: [{ x: 0.5, y: 0.5 }],
      }],
    });
    expect(inputClick).not.toHaveBeenCalled();
  });

  it("does not apply tap-to-focus constraints when points are unsupported", async () => {
    const track = createTrack(true, { focusMode: ["continuous"] });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue(createStream(track)) },
    });

    render(<AddReceiptForm onSubmit={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Camera" }));
    const preview = await screen.findByLabelText("Rear camera preview");
    vi.spyOn(preview, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      width: 100,
      height: 100,
      right: 100,
      bottom: 100,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);

    fireEvent.click(preview, { clientX: 50, clientY: 50 });

    expect(track.applyConstraints).toHaveBeenCalledTimes(1);
  });

  it("stops all camera tracks after closing the preview", async () => {
    const track = createTrack(true);
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue(createStream(track)) },
    });

    render(<AddReceiptForm onSubmit={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Camera" }));
    await screen.findByLabelText("Rear camera preview");
    fireEvent.click(screen.getByRole("button", { name: "Cancel camera" }));

    expect(track.stop).toHaveBeenCalled();
    expect(screen.queryByLabelText("Rear camera preview")).not.toBeInTheDocument();
  });

  it("stops all camera tracks when the form unmounts", async () => {
    const track = createTrack(true);
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue(createStream(track)) },
    });

    const { unmount } = render(<AddReceiptForm onSubmit={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Camera" }));
    await screen.findByLabelText("Rear camera preview");
    unmount();

    expect(track.stop).toHaveBeenCalled();
  });

  it("falls back to the existing camera input when camera or torch setup is unavailable", async () => {
    const inputClick = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => undefined);
    const track = createTrack(false);
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue(createStream(track)) },
    });

    render(<AddReceiptForm onSubmit={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Camera" }));

    await waitFor(() => expect(inputClick).toHaveBeenCalled());
    expect(track.stop).toHaveBeenCalled();
    expect(screen.queryByLabelText("Rear camera preview")).not.toBeInTheDocument();
  });

  it("falls back when camera permission or rear-camera access is denied", async () => {
    const inputClick = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => undefined);
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn().mockRejectedValue(new Error("Permission denied")) },
    });

    render(<AddReceiptForm onSubmit={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Camera" }));

    await waitFor(() => expect(inputClick).toHaveBeenCalled());
    expect(screen.queryByLabelText("Rear camera preview")).not.toBeInTheDocument();
  });

  it("falls back when getUserMedia is unavailable and sends captured frames through upload", async () => {
    const inputClick = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => undefined);
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(<AddReceiptForm onSubmit={onSubmit} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Camera" }));
    expect(inputClick).toHaveBeenCalled();

    // A successful in-app capture uses the same preview/upload path as a file input.
    const track = createTrack(true);
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue(createStream(track)) },
    });
    fireEvent.click(screen.getByRole("button", { name: "Camera" }));
    await screen.findByLabelText("Rear camera preview");
    fireEvent.click(screen.getByRole("button", { name: "Capture photo" }));
    await screen.findByAltText("Receipt preview");
    fireEvent.click(screen.getByRole("button", { name: "Upload" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ type: "image/webp" }),
      expect.any(Function),
      true,
    ));
    expect(mocks.convertImageFileToGrayscale).toHaveBeenCalledWith(expect.objectContaining({ type: "image/jpeg" }));
    expect(mocks.convertReceiptImageFile).toHaveBeenCalledWith(expect.objectContaining({ type: "image/jpeg" }));
    expect(mocks.autoCropReceiptImage).toHaveBeenCalledWith(expect.objectContaining({ type: "image/jpeg" }));
    expect(track.stop).toHaveBeenCalled();
  });
});
