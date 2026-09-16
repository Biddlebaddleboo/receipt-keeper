import { autoCropReceiptImage } from "@/lib/receiptAutoCrop";
import { convertImageFileToGrayscale } from "@/lib/nativeImageConverter";
import { convertReceiptImageFile } from "@/lib/ffmpegImageConverter";
import type { PrepaidImageType } from "@/hooks/usePrepaidApi";

export interface PrepaidImagePipelineOptions {
  grayscale?: boolean;
  upload?: (file: File, imageType: PrepaidImageType) => Promise<string>;
}

/**
 * Prepare a prepaid document through the one upload-safe image path.
 * Auto-crop is deliberately fail-open: a detector or decoder failure returns
 * the original image and does not prevent the upload from continuing.
 */
export const preparePrepaidImage = async (
  file: File,
  options: Pick<PrepaidImagePipelineOptions, "grayscale"> = {},
): Promise<File> => {
  let cropped = file;
  try {
    cropped = await autoCropReceiptImage(file);
  } catch {
    cropped = file;
  }

  const source = options.grayscale ? await convertImageFileToGrayscale(cropped) : cropped;
  const webp = await convertReceiptImageFile(source);
  if (webp.type.toLowerCase() !== "image/webp") {
    throw new Error(`Prepaid image conversion must return image/webp; received ${webp.type || "unknown"}`);
  }
  return webp;
};

/** Prepare and upload a prepaid image, returning its reusable storage path. */
export const prepareAndUploadPrepaidImage = async (
  file: File,
  imageType: PrepaidImageType,
  options: PrepaidImagePipelineOptions = {},
): Promise<{ file: File; storagePath?: string }> => {
  const prepared = await preparePrepaidImage(file, options);
  if (!options.upload) return { file: prepared };
  return {
    file: prepared,
    storagePath: await options.upload(prepared, imageType),
  };
};
