import type { Receipt } from "@/hooks/useReceiptApi";
import { convertImageBlobToJpeg } from "@/lib/ffmpegImageConverter";
import { createStoredZip, type StoredZipEntry } from "@/lib/zipStore";

export interface ReceiptExportFilters {
  fromDate?: string;
  toDate?: string;
  categories?: readonly string[];
}

export interface ReceiptExportOptions extends ReceiptExportFilters {
  getImageUrl: (receipt: Receipt) => Promise<string | null>;
  fetchImage?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  convert?: (blob: Blob) => Promise<Blob>;
}

const receiptDate = (value: string): string | null => {
  const match = value.trim().match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] ?? null;
};

const cleanFilenamePart = (value: string, fallback: string): string => {
  const cleaned = value
    .replace(/[<>:"/\\|?*]/g, "-")
    .split("")
    .map((character) => character.charCodeAt(0) < 32 ? "-" : character)
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "");
  return cleaned || fallback;
};

export const filterReceiptsForExport = (receipts: Receipt[], filters: ReceiptExportFilters = {}): Receipt[] => {
  const fromDate = filters.fromDate?.trim() || "";
  const toDate = filters.toDate?.trim() || "";
  const categories = new Set((filters.categories ?? []).map((category) => category.trim()).filter(Boolean));

  return receipts.filter((receipt) => {
    const date = receiptDate(receipt.purchase_date || "");
    if (fromDate && (!date || date < fromDate)) return false;
    if (toDate && (!date || date > toDate)) return false;
    if (categories.size > 0 && !categories.has(receipt.category.trim())) return false;
    return true;
  });
};

export const receiptExportFilename = (receipt: Receipt, usedNames: Map<string, number>): string => {
  const date = receiptDate(receipt.purchase_date || "") ?? "unknown-date";
  const retailer = cleanFilenamePart(receipt.vendor || "", "Unknown retailer");
  const base = `${date} - ${retailer}`;
  const nextNumber = (usedNames.get(base) ?? 0) + 1;
  usedNames.set(base, nextNumber);
  return `${base}${nextNumber > 1 ? ` (${nextNumber})` : ""}.jpg`;
};

const safeRangePart = (value?: string) => value?.trim().match(/^\d{4}-\d{2}-\d{2}$/)?.[0];

export const receiptExportZipFilename = (filters: ReceiptExportFilters): string => {
  const from = safeRangePart(filters.fromDate);
  const to = safeRangePart(filters.toDate);
  if (from && to) return `receipts-${from}-to-${to}.zip`;
  if (from) return `receipts-from-${from}.zip`;
  if (to) return `receipts-through-${to}.zip`;
  return "receipts.zip";
};

const readBlobBytes = async (blob: Blob): Promise<Uint8Array> => {
  const blobWithArrayBuffer = blob as Blob & { arrayBuffer?: () => Promise<ArrayBuffer> };
  if (blobWithArrayBuffer.arrayBuffer) return new Uint8Array(await blobWithArrayBuffer.arrayBuffer());
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Unable to read converted image"));
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.readAsArrayBuffer(blob);
  });
};

/** Fetch, convert, and package receipts sequentially so only one source image is live at a time. */
export const buildReceiptExportZip = async (receipts: Receipt[], options: ReceiptExportOptions): Promise<Blob> => {
  const matchingReceipts = filterReceiptsForExport(receipts, options);
  const fetchImage = options.fetchImage ?? fetch;
  const convert = options.convert ?? convertImageBlobToJpeg;
  const usedNames = new Map<string, number>();
  const entries: StoredZipEntry[] = [];

  for (const receipt of matchingReceipts) {
    const imageUrl = await options.getImageUrl(receipt);
    if (!imageUrl) throw new Error(`Signed image URL unavailable for ${receipt.id}`);
    const response = await fetchImage(imageUrl, { credentials: "omit" });
    if (!response.ok) throw new Error(`Failed to fetch receipt image (${response.status})`);
    const source = await response.blob();
    const jpeg = await convert(source);
    if (jpeg.type.split(";", 1)[0].trim().toLowerCase() !== "image/jpeg") {
      throw new Error("Receipt image conversion did not produce a JPEG");
    }
    const data = await readBlobBytes(jpeg);
    entries.push({ name: receiptExportFilename(receipt, usedNames), data });
  }

  return createStoredZip(entries);
};
