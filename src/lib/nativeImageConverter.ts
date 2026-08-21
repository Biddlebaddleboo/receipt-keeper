import { normalizeErrorMessage } from "@/lib/imageErrors";

export const NATIVE_JPEG_MAX_WIDTH = 1000;
export const NATIVE_JPEG_QUALITY = 0.75;

type DecodedImage = {
  source: CanvasImageSource;
  width: number;
  height: number;
  cleanup: () => void;
};

const decodeWithImageBitmap = async (blob: Blob): Promise<DecodedImage | null> => {
  const decoder = globalThis.createImageBitmap;
  if (typeof decoder !== "function") return null;

  const bitmap = await decoder(blob);
  return {
    source: bitmap,
    width: bitmap.width,
    height: bitmap.height,
    cleanup: () => bitmap.close?.(),
  };
};

const decodeWithImageElement = async (blob: Blob): Promise<DecodedImage> => {
  if (typeof document === "undefined" || typeof URL.createObjectURL !== "function") {
    throw new Error("Native image decoding is unavailable");
  }

  const objectUrl = URL.createObjectURL(blob);
  const image = document.createElement("img");
  image.decoding = "async";

  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Browser could not decode the image"));
      image.src = objectUrl;
    });

    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    if (!width || !height) throw new Error("Decoded image has no dimensions");

    return {
      source: image,
      width,
      height,
      cleanup: () => {
        image.onload = null;
        image.onerror = null;
        image.removeAttribute("src");
        URL.revokeObjectURL(objectUrl);
      },
    };
  } catch (error) {
    image.onload = null;
    image.onerror = null;
    image.removeAttribute("src");
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
};

const decodeImage = async (blob: Blob): Promise<DecodedImage> => {
  let bitmapError: unknown;
  try {
    const decoded = await decodeWithImageBitmap(blob);
    if (decoded) return decoded;
  } catch (error) {
    bitmapError = error;
  }

  try {
    return await decodeWithImageElement(blob);
  } catch (error) {
    const fallbackMessage = normalizeErrorMessage(error);
    const bitmapMessage = bitmapError ? `; createImageBitmap: ${normalizeErrorMessage(bitmapError)}` : "";
    throw new Error(`Image decode failed: ${fallbackMessage}${bitmapMessage}`);
  }
};

const encodeCanvasAsJpeg = (canvas: HTMLCanvasElement): Promise<Blob> => new Promise((resolve, reject) => {
  try {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Browser JPEG encoding returned no image"));
        return;
      }
      if (blob.type.toLowerCase() !== "image/jpeg") {
        reject(new Error(`Browser JPEG encoding returned ${blob.type || "an unknown type"}`));
        return;
      }
      resolve(blob);
    }, "image/jpeg", NATIVE_JPEG_QUALITY);
  } catch (error) {
    reject(error);
  }
});

/** Decode and encode a downloaded image with native browser APIs. */
export const convertImageBlobToJpeg = async (blob: Blob): Promise<Blob> => {
  let decoded: DecodedImage | null = null;
  let canvas: HTMLCanvasElement | null = null;

  try {
    if (blob.type && !blob.type.toLowerCase().startsWith("image/")) {
      throw new Error("Downloaded file is not an image");
    }

    decoded = await decodeImage(blob);
    if (!Number.isFinite(decoded.width) || !Number.isFinite(decoded.height) || decoded.width <= 0 || decoded.height <= 0) {
      throw new Error("Decoded image has no usable dimensions");
    }
    const targetWidth = Math.min(NATIVE_JPEG_MAX_WIDTH, decoded.width);
    const targetHeight = Math.max(1, Math.round(decoded.height * targetWidth / decoded.width));
    canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;

    const context = canvas.getContext("2d");
    if (!context) throw new Error("Browser canvas rendering is unavailable");
    context.drawImage(decoded.source, 0, 0, targetWidth, targetHeight);
    return await encodeCanvasAsJpeg(canvas);
  } catch (error) {
    throw new Error(`Native JPEG conversion failed: ${normalizeErrorMessage(error)}`);
  } finally {
    decoded?.cleanup();
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
  }
};
