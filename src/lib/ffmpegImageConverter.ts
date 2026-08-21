import coreURL from "@ffmpeg/core?url";
import wasmURL from "@ffmpeg/core/wasm?url";

type FFmpegInstance = {
  loaded: boolean;
  load: (args: { coreURL: string; wasmURL: string; workerURL?: string }) => Promise<void>;
  writeFile: (path: string, data: Uint8Array) => Promise<void>;
  exec: (args: string[]) => Promise<void>;
  readFile: (path: string) => Promise<Uint8Array>;
  deleteFile: (path: string) => Promise<void>;
};

type ImageConversionOptions = {
  outputExtension: "webp" | "jpg";
  outputType: "image/webp" | "image/jpeg";
  failureLabel: string;
  buildArguments: (inputName: string, outputName: string) => string[];
};

let ffmpegLoadPromise: Promise<{
  ffmpeg: FFmpegInstance;
  fetchFile: (file: File | Blob | string) => Promise<Uint8Array>;
}> | null = null;
let conversionSequence = 0;
let ffmpegOperationQueue: Promise<void> = Promise.resolve();

const loadFFmpeg = async () => {
  if (ffmpegLoadPromise) return ffmpegLoadPromise;

  ffmpegLoadPromise = (async () => {
    const [{ FFmpeg }, { fetchFile }] = await Promise.all([
      import("@ffmpeg/ffmpeg"),
      import("@ffmpeg/util"),
    ]);

    const ffmpeg = new FFmpeg() as unknown as FFmpegInstance;
    if (!ffmpeg.loaded) {
      await ffmpeg.load({ coreURL, wasmURL });
    }

    return { ffmpeg, fetchFile };
  })().catch((error) => {
    ffmpegLoadPromise = null;
    throw error;
  });

  return ffmpegLoadPromise;
};

export const preloadReceiptImageConverter = () => {
  void loadFFmpeg().catch(() => {
    // Keep upload flow working even if prewarm fails.
  });
};

const fileExtensionFromType = (type: string) => {
  const normalizedType = type.split(";", 1)[0].trim().toLowerCase();
  if (normalizedType === "image/png") return "png";
  if (normalizedType === "image/webp") return "webp";
  return "jpg";
};

const temporaryFileNames = (inputExtension: string, outputExtension: string) => {
  const sequence = conversionSequence++;
  const randomPart = Math.random().toString(36).slice(2, 10);
  const prefix = `receipt-image-${Date.now().toString(36)}-${sequence}-${randomPart}`;
  return {
    inputName: `${prefix}-input.${inputExtension}`,
    outputName: `${prefix}-output.${outputExtension}`,
  };
};

const convertImageBlob = (blob: Blob, options: ImageConversionOptions): Promise<Blob> => {
  if (blob.type && !blob.type.startsWith("image/")) {
    throw new Error(`${options.failureLabel} failed: downloaded file is not an image`);
  }

  const operation = ffmpegOperationQueue.then(async () => {
    const { ffmpeg, fetchFile } = await loadFFmpeg();
    const { inputName, outputName } = temporaryFileNames(fileExtensionFromType(blob.type), options.outputExtension);

    try {
      await ffmpeg.writeFile(inputName, await fetchFile(blob));
      await ffmpeg.exec(options.buildArguments(inputName, outputName));
      const outputData = await ffmpeg.readFile(outputName);
      return new Blob([outputData as BlobPart], { type: options.outputType });
    } catch (error) {
      throw new Error(`${options.failureLabel} failed: ${error instanceof Error ? error.message : "unknown error"}`);
    } finally {
      await Promise.allSettled([ffmpeg.deleteFile(inputName), ffmpeg.deleteFile(outputName)]);
    }
  });
  ffmpegOperationQueue = operation.then(() => undefined, () => undefined);
  return operation;
};

export const convertReceiptImageFile = async (file: File): Promise<File> => {
  if (!file.type.startsWith("image/")) return file;

  const convertedBlob = await convertImageBlob(file, {
    outputExtension: "webp",
    outputType: "image/webp",
    failureLabel: "Image conversion to WebP",
    buildArguments: (inputName, outputName) => [
      "-i",
      inputName,
      "-vf",
      "scale='if(gt(iw,2000),2000,iw)':-2",
      "-c:v",
      "libwebp",
      "-q:v",
      "85",
      "-compression_level",
      "10",
      "-preset",
      "picture",
      "-y",
      outputName,
    ],
  });
  const convertedName = file.name.replace(/\.[^.]+$/, "") + ".webp";
  return new File([convertedBlob], convertedName, {
    type: "image/webp",
    lastModified: Date.now(),
  });
};

export const JPEG_DOWNLOAD_MAX_WIDTH = 1200;
export const JPEG_DOWNLOAD_QUALITY = 7;

/** Keep downloaded JPEGs readable while limiting their device/storage size. */
export const buildJpegConversionArguments = (inputName: string, outputName: string): string[] => [
  "-i",
  inputName,
  "-vf",
  `scale='if(gt(iw,${JPEG_DOWNLOAD_MAX_WIDTH}),${JPEG_DOWNLOAD_MAX_WIDTH},iw)':-2`,
  "-frames:v",
  "1",
  "-c:v",
  "mjpeg",
  "-q:v",
  String(JPEG_DOWNLOAD_QUALITY),
  "-y",
  outputName,
];

/** Convert a downloaded image to a real, size-limited JPEG. */
export const convertImageBlobToJpeg = async (blob: Blob): Promise<Blob> =>
  convertImageBlob(blob, {
    outputExtension: "jpg",
    outputType: "image/jpeg",
    failureLabel: "Image conversion to JPEG",
    buildArguments: buildJpegConversionArguments,
  });
