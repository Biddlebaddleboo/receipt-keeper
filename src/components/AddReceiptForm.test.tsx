import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AddReceiptForm } from "@/components/AddReceiptForm";

const mocks = vi.hoisted(() => ({
  convertReceiptImageFile: vi.fn(),
}));

vi.mock("@/lib/ffmpegImageConverter", () => ({ convertReceiptImageFile: mocks.convertReceiptImageFile }));

const createTrack = (torch: boolean) => ({
  getCapabilities: vi.fn(() => ({ torch })),
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

    expect(await screen.findByLabelText("Rear camera preview")).toBeInTheDocument();
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: false,
      video: { facingMode: { exact: "environment" } },
    });
    expect(track.applyConstraints).toHaveBeenCalledWith({ advanced: [{ torch: true }] });
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
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(track.stop).toHaveBeenCalled();
    expect(screen.queryByLabelText("Rear camera preview")).not.toBeInTheDocument();
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
    ));
    expect(mocks.convertReceiptImageFile).toHaveBeenCalledWith(expect.objectContaining({ type: "image/jpeg" }));
    expect(track.stop).toHaveBeenCalled();
  });
});
