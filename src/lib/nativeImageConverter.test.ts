import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  convertImageBlobToGrayscale,
  convertImageBlobToJpeg,
  convertImageFileToGrayscale,
  GRAYSCALE_JPEG_QUALITY,
  NATIVE_JPEG_MAX_WIDTH,
  NATIVE_JPEG_QUALITY,
} from "@/lib/nativeImageConverter";

const sourceBlob = () => new Blob(["webp"], { type: "image/webp" });

describe("native JPEG conversion", () => {
  let drawImage: ReturnType<typeof vi.fn>;
  let toBlob: ReturnType<typeof vi.fn>;
  let context: CanvasRenderingContext2D;

  beforeEach(() => {
    drawImage = vi.fn();
    toBlob = vi.fn((callback: BlobCallback) => callback(new Blob(["jpeg"], { type: "image/jpeg" })));
    context = { drawImage } as unknown as CanvasRenderingContext2D;
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => context);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(toBlob as unknown as typeof HTMLCanvasElement.prototype.toBlob);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("caps wide images at 1000px without upscaling and preserves aspect ratio", async () => {
    const close = vi.fn();
    const bitmap = { width: 2400, height: 1200, close } as unknown as ImageBitmap;
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue(bitmap));

    const output = await convertImageBlobToJpeg(sourceBlob());

    expect(output.type).toBe("image/jpeg");
    expect(NATIVE_JPEG_MAX_WIDTH).toBe(1000);
    expect(drawImage).toHaveBeenCalledWith(bitmap, 0, 0, 1000, 500);
    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), "image/jpeg", NATIVE_JPEG_QUALITY);
    expect(NATIVE_JPEG_QUALITY).toBe(0.75);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("does not upscale images smaller than 1000px", async () => {
    const bitmap = { width: 800, height: 600, close: vi.fn() } as unknown as ImageBitmap;
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue(bitmap));

    await convertImageBlobToJpeg(sourceBlob());

    expect(drawImage).toHaveBeenCalledWith(bitmap, 0, 0, 800, 600);
  });

  it("closes ImageBitmap resources and resets the canvas after encoding", async () => {
    const close = vi.fn();
    const bitmap = { width: 500, height: 400, close } as unknown as ImageBitmap;
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue(bitmap));
    const canvases: HTMLCanvasElement[] = [];
    const createElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(((tagName: string, options?: ElementCreationOptions) => {
      const element = createElement(tagName, options);
      if (tagName === "canvas") canvases.push(element as HTMLCanvasElement);
      return element;
    }) as typeof document.createElement);

    await convertImageBlobToJpeg(sourceBlob());

    expect(close).toHaveBeenCalledTimes(1);
    expect(canvases[0].width).toBe(0);
    expect(canvases[0].height).toBe(0);
  });

  it("uses the img fallback and revokes its object URL", async () => {
    vi.stubGlobal("createImageBitmap", undefined);
    const createObjectURL = vi.fn().mockReturnValue("blob:source");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    const createElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(((tagName: string, options?: ElementCreationOptions) => {
      if (tagName === "img") {
        const image = {
          decoding: "",
          naturalWidth: 640,
          naturalHeight: 480,
          width: 640,
          height: 480,
          onload: null,
          onerror: null,
          removeAttribute: vi.fn(),
        } as unknown as HTMLImageElement;
        let source = "";
        Object.defineProperty(image, "src", {
          get: () => source,
          set: (value: string) => {
            source = value;
            queueMicrotask(() => image.onload?.(new Event("load")));
          },
        });
        return image;
      }
      return createElement(tagName, options);
    }) as typeof document.createElement);

    const output = await convertImageBlobToJpeg(sourceBlob());

    expect(output.type).toBe("image/jpeg");
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:source");
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 640, 480);
  });

  it("surfaces decode and JPEG encoding failures", async () => {
    const close = vi.fn();
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue({ width: 100, height: 100, close }));
    toBlob.mockImplementation((callback: BlobCallback) => callback(null));

    await expect(convertImageBlobToJpeg(sourceBlob())).rejects.toThrow(/JPEG encoding returned no image/);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("surfaces browser decode failures and revokes fallback URLs", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn().mockRejectedValue(new Error("bitmap decoder failed")));
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn().mockReturnValue("blob:failed"),
      revokeObjectURL,
    });
    const createElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(((tagName: string, options?: ElementCreationOptions) => {
      if (tagName === "img") {
        const image = {
          decoding: "",
          onload: null,
          onerror: null,
          removeAttribute: vi.fn(),
        } as unknown as HTMLImageElement;
        Object.defineProperty(image, "src", {
          set: () => queueMicrotask(() => image.onerror?.(new Event("error"))),
        });
        return image;
      }
      return createElement(tagName, options);
    }) as typeof document.createElement);

    await expect(convertImageBlobToJpeg(sourceBlob())).rejects.toThrow(/Image decode failed/);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:failed");
  });

  it("converts images to grayscale with native canvas and preserves dimensions", async () => {
    const close = vi.fn();
    const bitmap = { width: 640, height: 480, close } as unknown as ImageBitmap;
    const pixels = new Uint8ClampedArray([255, 0, 0, 255, 0, 120, 240, 255]);
    const getImageData = vi.fn(() => ({ data: pixels, width: 2, height: 1 } as ImageData));
    const putImageData = vi.fn();
    context = { drawImage, getImageData, putImageData } as unknown as CanvasRenderingContext2D;
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => context);
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue(bitmap));

    const output = await convertImageBlobToGrayscale(sourceBlob());

    expect(output.type).toBe("image/jpeg");
    expect(drawImage).toHaveBeenCalledWith(bitmap, 0, 0, 640, 480);
    expect(putImageData).toHaveBeenCalledWith(expect.objectContaining({ data: pixels }), 0, 0);
    expect(Array.from(pixels)).toEqual([54, 54, 54, 255, 103, 103, 103, 255]);
    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), "image/jpeg", GRAYSCALE_JPEG_QUALITY);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("returns a JPEG File for the upload pipeline", async () => {
    const bitmap = { width: 100, height: 80, close: vi.fn() } as unknown as ImageBitmap;
    const pixels = new Uint8ClampedArray([10, 20, 30, 255]);
    context = {
      drawImage,
      getImageData: vi.fn(() => ({ data: pixels, width: 1, height: 1 } as ImageData)),
      putImageData: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => context);
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue(bitmap));

    const output = await convertImageFileToGrayscale(new File(["source"], "receipt.webp", { type: "image/webp" }));

    expect(output).toMatchObject({ type: "image/jpeg", name: "receipt-grayscale.jpg" });
  });
});
