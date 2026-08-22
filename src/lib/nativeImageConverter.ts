import { normalizeErrorMessage } from "@/lib/imageErrors";

export const NATIVE_JPEG_MAX_WIDTH = 1000;
export const NATIVE_JPEG_QUALITY = 0.75;
export const GRAYSCALE_JPEG_QUALITY = 0.92;

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

export interface NativeJpegConversionOptions {
  /** Apply luminance conversion before the single JPEG encode. */
  grayscale?: boolean;
  /** Maximum output width; null disables resizing. */
  maxWidth?: number | null;
  /** JPEG quality passed to canvas.toBlob(). */
  quality?: number;
}

const encodeCanvasAsJpeg = (canvas: HTMLCanvasElement, quality: number, label: string): Promise<Blob> => new Promise((resolve, reject) => {
  try {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error(`${label} returned no image`));
        return;
      }
      if (blob.type.toLowerCase() !== "image/jpeg") {
        reject(new Error(`${label} returned ${blob.type || "an unknown type"}`));
        return;
      }
      resolve(blob);
    }, "image/jpeg", quality);
  } catch (error) {
    reject(error);
  }
});

const applyGrayscale = (context: CanvasRenderingContext2D, width: number, height: number) => {
  const imageData = context.getImageData(0, 0, width, height);
  for (let index = 0; index < imageData.data.length; index += 4) {
    const luminance = Math.round(
      0.2126 * imageData.data[index]
      + 0.7152 * imageData.data[index + 1]
      + 0.0722 * imageData.data[index + 2],
    );
    imageData.data[index] = luminance;
    imageData.data[index + 1] = luminance;
    imageData.data[index + 2] = luminance;
  }
  context.putImageData(imageData, 0, 0);
};

const convertImageBlobToJpegWithOptions = async (
  blob: Blob,
  options: NativeJpegConversionOptions = {},
  failureLabel = "Native JPEG conversion failed",
): Promise<Blob> => {
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
    const maxWidth = options.maxWidth === undefined ? NATIVE_JPEG_MAX_WIDTH : options.maxWidth;
    const targetWidth = maxWidth === null ? decoded.width : Math.min(maxWidth, decoded.width);
    const targetHeight = Math.max(1, Math.round(decoded.height * targetWidth / decoded.width));
    canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;

    const context = canvas.getContext("2d");
    if (!context) throw new Error("Browser canvas rendering is unavailable");
    context.drawImage(decoded.source, 0, 0, targetWidth, targetHeight);
    if (options.grayscale) applyGrayscale(context, targetWidth, targetHeight);
    return await encodeCanvasAsJpeg(
      canvas,
      options.quality ?? NATIVE_JPEG_QUALITY,
      options.grayscale ? "Browser grayscale JPEG encoding" : "Browser JPEG encoding",
    );
  } catch (error) {
    throw new Error(`${failureLabel}: ${normalizeErrorMessage(error)}`);
  } finally {
    decoded?.cleanup();
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
  }
};

/** Decode and encode a downloaded image with native browser APIs. */
export const convertImageBlobToJpeg = (
  blob: Blob,
  options: NativeJpegConversionOptions = {},
): Promise<Blob> => convertImageBlobToJpegWithOptions(blob, options);

/** Render an image through the browser's native decoder and encode a grayscale JPEG. */
export const convertImageBlobToGrayscale = async (blob: Blob): Promise<Blob> => {
  return convertImageBlobToJpegWithOptions(
    blob,
    { grayscale: true, maxWidth: null, quality: GRAYSCALE_JPEG_QUALITY },
    "Native grayscale conversion failed",
  );
};

/** Convert an image file to a grayscale JPEG while preserving its dimensions. */
export const convertImageFileToGrayscale = async (file: File): Promise<File> => {
  const blob = await convertImageBlobToGrayscale(file);
  const filename = file.name.replace(/\.[^.]+$/, "") + "-grayscale.jpg";
  return new File([blob], filename, { type: "image/jpeg" });
};
