import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { BrowserCamera } from "@/components/BrowserCamera";

type TestTrack = MediaStreamTrack & { emitEnded: () => void };

function createTrack(): TestTrack {
  const listeners = new Set<() => void>();
  return {
    getCapabilities: vi.fn(() => ({ torch: true, focusMode: ["continuous"], pointsOfInterest: [] })),
    applyConstraints: vi.fn().mockResolvedValue(undefined),
    addEventListener: vi.fn((_event: string, listener: EventListener) => listeners.add(listener as () => void)),
    removeEventListener: vi.fn((_event: string, listener: EventListener) => listeners.delete(listener as () => void)),
    stop: vi.fn(),
    emitEnded: () => listeners.forEach((listener) => listener()),
  } as unknown as TestTrack;
}

function createStream(track: TestTrack): MediaStream {
  return {
    getVideoTracks: () => [track],
    getTracks: () => [track],
  } as unknown as MediaStream;
}

describe("BrowserCamera lifecycle", () => {
  let originalMediaDevices: MediaDevices | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    originalMediaDevices = navigator.mediaDevices;
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalMediaDevices) {
      Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: originalMediaDevices });
    } else {
      Reflect.deleteProperty(navigator, "mediaDevices");
    }
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    vi.restoreAllMocks();
  });

  it("falls back to native capture when startup times out", async () => {
    vi.useFakeTimers();
    const inputClick = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => undefined);
    const getUserMedia = vi.fn(() => new Promise<MediaStream>(() => undefined));
    const onClose = vi.fn();
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });

    render(<BrowserCamera open onCapture={vi.fn()} onClose={onClose} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(getUserMedia).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    expect(inputClick).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("stops a stale stream that resolves after startup timeout", async () => {
    vi.useFakeTimers();
    const inputClick = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => undefined);
    let resolveStream!: (stream: MediaStream) => void;
    const getUserMedia = vi.fn(() => new Promise<MediaStream>((resolve) => { resolveStream = resolve; }));
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });

    render(<BrowserCamera open onCapture={vi.fn()} onClose={vi.fn()} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    const staleTrack = createTrack();
    await act(async () => {
      resolveStream(createStream(staleTrack));
      await Promise.resolve();
    });

    expect(inputClick).toHaveBeenCalledTimes(1);
    expect(staleTrack.stop).toHaveBeenCalledTimes(1);
  });

  it("stops and closes on visibility changes and pagehide", async () => {
    const visibilityTrack = createTrack();
    const pagehideTrack = createTrack();
    const getUserMedia = vi.fn()
      .mockResolvedValueOnce(createStream(visibilityTrack))
      .mockResolvedValueOnce(createStream(pagehideTrack));
    const onClose = vi.fn();
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });

    const { rerender } = render(<BrowserCamera open onCapture={vi.fn()} onClose={onClose} />);
    await screen.findByLabelText("Rear camera preview");
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(visibilityTrack.stop).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByLabelText("Rear camera preview")).not.toBeInTheDocument());

    rerender(<BrowserCamera open={false} onCapture={vi.fn()} onClose={onClose} />);
    rerender(<BrowserCamera open onCapture={vi.fn()} onClose={onClose} />);
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));
    await screen.findByLabelText("Rear camera preview");
    await act(async () => {
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(pagehideTrack.stop).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("resets after the active track ends so the next open starts a fresh session", async () => {
    const firstTrack = createTrack();
    const secondTrack = createTrack();
    const getUserMedia = vi.fn()
      .mockResolvedValueOnce(createStream(firstTrack))
      .mockResolvedValueOnce(createStream(secondTrack));
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });

    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Open camera</button>
          <BrowserCamera open={open} onCapture={vi.fn()} onClose={() => setOpen(false)} />
        </>
      );
    }

    render(<Harness />);
    await screen.findByLabelText("Rear camera preview");
    await act(async () => {
      firstTrack.emitEnded();
    });
    await waitFor(() => expect(screen.queryByLabelText("Rear camera preview")).not.toBeInTheDocument());
    expect(firstTrack.stop).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Open camera" }));
    await screen.findByLabelText("Rear camera preview");
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(secondTrack.stop).not.toHaveBeenCalled();
  });

  it("starts in the caller's default mode and returns the selected mode with the captured file", async () => {
    const track = createTrack();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue(createStream(track)) },
    });
    Object.defineProperty(HTMLVideoElement.prototype, "videoWidth", { configurable: true, value: 1200 });
    Object.defineProperty(HTMLVideoElement.prototype, "videoHeight", { configurable: true, value: 800 });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => callback(new Blob(["jpeg"], { type: "image/jpeg" })));
    const onCapture = vi.fn();

    render(<BrowserCamera open defaultColorMode="grayscale" onCapture={onCapture} onClose={vi.fn()} />);
    await screen.findByLabelText("Rear camera preview");
    expect(screen.getByRole("button", { name: "Grayscale" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Colour" })).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(screen.getByRole("button", { name: "Colour" }));
    fireEvent.click(screen.getByRole("button", { name: "Capture photo" }));

    await waitFor(() => expect(onCapture).toHaveBeenCalledWith(expect.any(File), "color"));
  });
});
