import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CaptureButton } from "@/components/CaptureButton";

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

describe("CaptureButton camera", () => {
  it("uses the shared camera and forwards its captured File", () => {
    const onCapture = vi.fn();
    render(<CaptureButton onCapture={onCapture} />);

    fireEvent.click(screen.getByRole("button", { name: "Take Photo" }));
    fireEvent.click(screen.getByRole("button", { name: "Shared camera capture" }));

    expect(onCapture).toHaveBeenCalledWith(expect.objectContaining({ name: "camera.jpg", type: "image/jpeg" }));
  });

  it("keeps Gallery as a normal file input", () => {
    render(<CaptureButton onCapture={vi.fn()} />);
    const galleryInput = document.querySelector("input[type='file']") as HTMLInputElement;
    expect(galleryInput).toBeTruthy();
    expect(galleryInput).not.toHaveAttribute("capture");
  });
});
