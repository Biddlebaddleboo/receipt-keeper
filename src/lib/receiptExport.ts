import type { Receipt } from "@/hooks/useReceiptApi";
import { normalizeErrorMessage } from "@/lib/imageErrors";
import { convertImageBlobToJpeg, type NativeJpegConversionOptions } from "@/lib/nativeImageConverter";
import { normalizeReceiptPurchaseDate } from "@/lib/receiptDate";
import { createStoredZip, type StoredZipEntry } from "@/lib/zipStore";

export interface ReceiptExportFilters {
  fromDate?: string;
  toDate?: string;
  categories?: readonly string[];
  /** Case-insensitive partial match against the current canonical vendor. */
  vendor?: string;
}

export type ReceiptExportPhase = "fetching" | "converting" | "packaging" | "complete";

export interface ReceiptExportProgress {
  completed: number;
  total: number;
  percentage: number;
  phase: ReceiptExportPhase;
  filename?: string;
}

export interface ReceiptExportOptions extends ReceiptExportFilters {
  getImageUrl: (receipt: Receipt) => Promise<string | null>;
  fetchImage?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  convert?: (blob: Blob, options?: NativeJpegConversionOptions) => Promise<Blob>;
  onProgress?: (progress: ReceiptExportProgress) => void;
}

const receiptDate = (value: string): string | null => {
  return normalizeReceiptPurchaseDate(value);
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

/**
 * Apply the shared receipt filtering semantics used by both the main list and
 * ZIP exports. Dates are normalized before comparison and category selection
 * remains OR-based while all filter types combine with AND.
 */
export const filterReceipts = (receipts: Receipt[], filters: ReceiptExportFilters = {}): Receipt[] => {
  const fromDate = normalizeReceiptPurchaseDate(filters.fromDate?.trim() || "") ?? "";
  const toDate = normalizeReceiptPurchaseDate(filters.toDate?.trim() || "") ?? "";
  const categories = new Set((filters.categories ?? []).map((category) => category.trim()).filter(Boolean));
  const vendorQuery = filters.vendor?.trim().toLowerCase() ?? "";

  return receipts.filter((receipt) => {
    const date = receiptDate(receipt.purchase_date || "");
    if (fromDate && (!date || date < fromDate)) return false;
    if (toDate && (!date || date > toDate)) return false;
    if (categories.size > 0 && !categories.has(receipt.category.trim())) return false;
    if (vendorQuery && !receipt.vendor.trim().toLowerCase().includes(vendorQuery)) return false;
    return true;
  });
};

export const filterReceiptsForExport = (receipts: Receipt[], filters: ReceiptExportFilters = {}): Receipt[] =>
  filterReceipts(receipts, filters);

export const receiptExportFilename = (receipt: Receipt, usedNames: Map<string, number>): string => {
  const date = receiptDate(receipt.purchase_date || "") ?? "unknown-date";
  const retailer = cleanFilenamePart(receipt.vendor || "", "Unknown retailer");
  const base = `${date} - ${retailer}`;
  const nextNumber = (usedNames.get(base) ?? 0) + 1;
  usedNames.set(base, nextNumber);
  return `${base}${nextNumber > 1 ? ` (${nextNumber})` : ""}.jpg`;
};

const safeRangePart = (value?: string) => {
  const trimmed = value?.trim() || "";
  return trimmed ? normalizeReceiptPurchaseDate(trimmed) ?? undefined : undefined;
};

export const receiptExportZipFilename = (filters: ReceiptExportFilters): string => {
  const from = safeRangePart(filters.fromDate);
  const to = safeRangePart(filters.toDate);
  if (from && to) return `receipts-${from}-to-${to}.zip`;
  if (from) return `receipts-from-${from}.zip`;
  if (to) return `receipts-through-${to}.zip`;
  return "receipts.zip";
};

const csvField = (value: string): string => `"${value.replace(/"/g, '""')}"`;

const finiteNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

const formatReceiptItem = (item: Receipt["items"][number]): string => {
  if (!item || typeof item !== "object") return "";
  const name = typeof item.name === "string" ? item.name.trim() : "";
  const quantityValue = finiteNumber(item.quantity);
  const quantity = quantityValue !== null
    ? `x${Number.isInteger(quantityValue) ? quantityValue : quantityValue.toString()}`
    : "";
  const priceValue = finiteNumber(item.price);
  const price = priceValue !== null
    ? `($${priceValue.toFixed(2)})`
    : "";
  return [name, quantity, price].filter(Boolean).join(" ");
};

/** Serialize canonical receipt line items into one readable CSV cell. */
export const serializeReceiptItems = (items: Receipt["items"]): string =>
  (Array.isArray(items) ? items : []).map(formatReceiptItem).filter(Boolean).join("; ");

/** Build a UTF-8 CSV from the complete, already-enumerated receipt set. */
export const buildReceiptExportCsv = (
  receipts: Receipt[],
  filters: ReceiptExportFilters = {},
): Blob => {
  const matchingReceipts = filterReceiptsForExport(receipts, filters);
  const rows = [
    ["Date", "Invoice ID", "Merchant Name", "Items Purchased", "Total GST/HST"],
    ...matchingReceipts.map((receipt) => [
      receiptDate(receipt.purchase_date || "") ?? "",
      typeof receipt.invoice_id === "string" ? receipt.invoice_id : "",
      typeof receipt.vendor === "string" ? receipt.vendor : "",
      serializeReceiptItems(receipt.items),
      typeof receipt.tax === "number" && Number.isFinite(receipt.tax) ? String(receipt.tax) : "",
    ]),
  ];
  const csv = rows.map((row) => row.map((value) => csvField(value)).join(",")).join("\r\n") + "\r\n";
  return new Blob([csv], { type: "text/csv;charset=utf-8" });
};

export const receiptExportCsvFilename = (filters: ReceiptExportFilters): string => {
  const from = safeRangePart(filters.fromDate);
  const to = safeRangePart(filters.toDate);
  if (from && to) return `receipts-${from}-to-${to}.csv`;
  if (from) return `receipts-from-${from}.csv`;
  if (to) return `receipts-through-${to}.csv`;
  return "receipts.csv";
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
  const filenames = matchingReceipts.map((receipt) => receiptExportFilename(receipt, usedNames));
  const entries: StoredZipEntry[] = [];
  const total = matchingReceipts.length;
  const reportProgress = (completed: number, phase: ReceiptExportPhase, filename?: string, phaseFraction = 0) => {
    const percentage = total === 0
      ? phase === "complete" ? 100 : 0
      : Math.min(100, Math.round(((completed + phaseFraction) / total) * 100));
    options.onProgress?.({ completed, total, percentage, phase, filename });
  };

  if (total === 0) {
    reportProgress(0, "complete");
    return createStoredZip(entries);
  }

  reportProgress(0, "fetching", filenames[0], 0);
  for (let index = 0; index < matchingReceipts.length; index += 1) {
    const receipt = matchingReceipts[index];
    const filename = filenames[index];
    let response: Response | null = null;
    let sourceBlob: Blob | null = null;
    let jpegBlob: Blob | null = null;
    try {
      reportProgress(index, "fetching", filename, 0.05);
      const imageUrl = await options.getImageUrl(receipt);
      if (!imageUrl) throw new Error(`Signed image URL unavailable for ${receipt.id}`);
      response = await fetchImage(imageUrl, { credentials: "omit" });
      if (!response.ok) throw new Error(`Failed to fetch receipt image (${response.status})`);
      sourceBlob = await response.blob();

      reportProgress(index, "converting", filename, 0.5);
      const conversionOptions = receipt.image_grayscale === true ? { grayscale: true } : undefined;
      jpegBlob = conversionOptions ? await convert(sourceBlob, conversionOptions) : await convert(sourceBlob);
      if (jpegBlob.type.split(";", 1)[0].trim().toLowerCase() !== "image/jpeg") {
        throw new Error("Receipt image conversion did not produce a JPEG");
      }
      const data = await readBlobBytes(jpegBlob);
      entries.push({ name: filename, data });
      reportProgress(index + 1, "packaging", filename);
    } catch (error) {
      throw new Error(`Failed to export ${filename} (receipt ${receipt.id}): ${normalizeErrorMessage(error)}`);
    } finally {
      // The ZIP keeps only `data`; release the source and converted Blob
      // references immediately after this receipt has been added.
      response = null;
      sourceBlob = null;
      jpegBlob = null;
    }
  }

  reportProgress(total, "packaging");
  const zip = createStoredZip(entries);
  reportProgress(total, "complete");
  return zip;
};
