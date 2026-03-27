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

let ffmpegLoadPromise: Promise<{
  ffmpeg: FFmpegInstance;
  fetchFile: (file: File | Blob | string) => Promise<Uint8Array>;
}> | null = null;

const loadFFmpeg = async () => {
  if (ffmpegLoadPromise) return ffmpegLoadPromise;

  ffmpegLoadPromise = (async () => {
    const [{ FFmpeg }, { fetchFile }] = await Promise.all([
      import("@ffmpeg/ffmpeg"),
      import("@ffmpeg/util"),
    ]);

    const ffmpeg = new FFmpeg() as FFmpegInstance;
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
  if (type === "image/png") return "png";
  if (type === "image/webp") return "webp";
  return "jpg";
};

export const convertReceiptImageFile = async (file: File): Promise<File> => {
  if (!file.type.startsWith("image/")) return file;

  const { ffmpeg, fetchFile } = await loadFFmpeg();
  const inputExt = fileExtensionFromType(file.type);
  const inputName = `input.${inputExt}`;
  const outputName = "output.webp";

  try {
    await ffmpeg.writeFile(inputName, await fetchFile(file));
    await ffmpeg.exec([
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
    ]);

    const outputData = await ffmpeg.readFile(outputName);
    const convertedBlob = new Blob([outputData], { type: "image/webp" });
    const convertedName = file.name.replace(/\.[^.]+$/, "") + ".webp";
    return new File([convertedBlob], convertedName, {
      type: "image/webp",
      lastModified: Date.now(),
    });
  } catch (error) {
    throw new Error(`Image conversion to WebP failed: ${error instanceof Error ? error.message : "unknown error"}`);
  } finally {
    await Promise.allSettled([ffmpeg.deleteFile(inputName), ffmpeg.deleteFile(outputName)]);
  }
};
