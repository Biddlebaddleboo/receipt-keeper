import type { Receipt } from "@/hooks/useReceiptApi";
import { normalizeReceiptPurchaseDate } from "@/lib/receiptDate";

export interface Gst288ExportFilters {
  fromDate?: string;
  toDate?: string;
  /** Percentage, e.g. 13 for 13%. */
  taxRatePercent?: number;
}

export type Gst288MatchStatus = "matched" | "ambiguous" | "unmatched";

export interface Gst288ReceiptRow {
  date: string;
  invoiceId: string;
  supplierName: string;
  description: string;
  tax: string;
  receiptId: string;
  status: Gst288MatchStatus;
}

export interface Gst288ExportSummary {
  totalReceipts: number;
  matched: number;
  ambiguous: number;
  unmatched: number;
}

export interface Gst288ExportResult {
  rows: Gst288ReceiptRow[];
  summary: Gst288ExportSummary;
  blob: Blob;
}

const CSV_COLUMNS = ["Date", "Invoice ID", "Supplier Name", "Brief Description of Purchases", "GST/HST"];
const RATE_SCALE = 10_000;

const finiteNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

const toCents = (value: unknown): number | null => {
  const number = finiteNumber(value);
  if (number === null) return null;
  return Math.round((number + Number.EPSILON) * 100);
};

const rateBasisPoints = (ratePercent: number | undefined): number | null => {
  const rate = finiteNumber(ratePercent ?? 13);
  if (rate === null || rate <= 0) return null;
  return Math.round((rate + Number.EPSILON) * 100);
};

/** Calculate tax in cents using integer cents and nearest-cent rounding. */
export const calculateGstCents = (amountCents: number, taxRatePercent = 13): number | null => {
  const basisPoints = rateBasisPoints(taxRatePercent);
  if (basisPoints === null || !Number.isSafeInteger(amountCents) || amountCents < 0) return null;
  return Math.floor((amountCents * basisPoints + RATE_SCALE / 2) / RATE_SCALE);
};

const csvField = (value: string): string => `"${value.replace(/"/g, '""')}"`;

const formatTax = (taxCents: number): string => (taxCents / 100).toFixed(2);

const normalizedFilterDate = (value?: string): string | null => {
  const trimmed = value?.trim() || "";
  return trimmed ? normalizeReceiptPurchaseDate(trimmed) : null;
};

interface TaxableCandidate {
  name: string;
  cents: number;
}

const nonPurchaseLinePattern = /\b(?:discount|coupon|adjustment)\b/i;

const positivePurchasedItemNames = (receipt: Receipt): string[] =>
  (Array.isArray(receipt.items) ? receipt.items : []).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const quantity = finiteNumber(item.quantity);
    const price = finiteNumber(item.price);
    const name = typeof item.name === "string" ? item.name.trim() : "";
    if (quantity === null || price === null || quantity <= 0 || price <= 0 || !name || nonPurchaseLinePattern.test(name)) {
      return [];
    }
    return [name];
  });

/**
 * Find the uniquely determined taxable item subset. At most two selections
 * are retained for each subtotal, since a second selection is enough to mark
 * the receipt ambiguous without retaining unnecessary combinations.
 */
export const inferTaxableDescription = (
  receipt: Receipt,
  taxRatePercent = 13,
): { status: Gst288MatchStatus; description: string } => {
  const actualTaxCents = toCents(receipt.tax);
  const basisPoints = rateBasisPoints(taxRatePercent);
  if (actualTaxCents === null || actualTaxCents <= 0 || basisPoints === null) {
    return { status: "unmatched", description: "" };
  }

  const subtotalCents = toCents(receipt.subtotal);
  if (subtotalCents !== null && subtotalCents >= 0 && calculateGstCents(subtotalCents, taxRatePercent) === actualTaxCents) {
    return { status: "matched", description: positivePurchasedItemNames(receipt).join("; ") };
  }

  const candidates: TaxableCandidate[] = (Array.isArray(receipt.items) ? receipt.items : []).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const quantity = finiteNumber(item.quantity);
    const price = finiteNumber(item.price);
    if (quantity === null || price === null || quantity < 0 || price < 0) return [];
    const cents = Math.round((quantity * price + Number.EPSILON) * 100);
    return [{ name: typeof item.name === "string" ? item.name.trim() : "", cents }];
  });

  let selectionsByAmount = new Map<number, number[][]>([[0, [[]]]]);
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const additions = Array.from(selectionsByAmount.entries()).map(([amount, selections]) => [
      amount,
      selections.map((selection) => [...selection]),
    ] as const);
    const nextSelectionsByAmount = new Map<number, number[][]>(
      additions.map(([amount, selections]) => [amount, selections.map((selection) => [...selection])]),
    );
    for (const [amount, selections] of additions) {
      const nextAmount = amount + candidate.cents;
      const current = nextSelectionsByAmount.get(nextAmount) ?? [];
      for (const selection of selections) {
        if (current.length >= 2) break;
        current.push([...selection, index]);
      }
      if (current.length > 0) nextSelectionsByAmount.set(nextAmount, current.slice(0, 2));
    }
    selectionsByAmount = nextSelectionsByAmount;
  }

  const matches: number[][] = [];
  for (const [amount, selections] of selectionsByAmount) {
    if (calculateGstCents(amount, taxRatePercent) !== actualTaxCents) continue;
    for (const selection of selections) {
      if (matches.length >= 2) break;
      matches.push(selection);
    }
    if (matches.length >= 2) break;
  }

  if (matches.length === 0) return { status: "unmatched", description: "" };
  if (matches.length > 1) return { status: "ambiguous", description: "" };
  const description = matches[0]
    .map((index) => candidates[index].name)
    .filter(Boolean)
    .join("; ");
  return { status: "matched", description };
};

const receiptIsInDateRange = (date: string | null, filters: Gst288ExportFilters): boolean => {
  const from = normalizedFilterDate(filters.fromDate);
  const to = normalizedFilterDate(filters.toDate);
  if (from && (!date || date < from)) return false;
  if (to && (!date || date > to)) return false;
  return true;
};

export const gst288CsvFilename = (filters: Gst288ExportFilters = {}): string => {
  const from = normalizedFilterDate(filters.fromDate);
  const to = normalizedFilterDate(filters.toDate);
  if (from && to) return `gst288-${from}-to-${to}.csv`;
  if (from) return `gst288-from-${from}.csv`;
  if (to) return `gst288-through-${to}.csv`;
  return "gst288.csv";
};

export const analyzeGst288Receipts = (
  receipts: Receipt[],
  filters: Gst288ExportFilters = {},
): Omit<Gst288ExportResult, "blob"> => {
  const taxRate = filters.taxRatePercent ?? 13;
  const eligible = receipts.flatMap((receipt) => {
    const date = normalizeReceiptPurchaseDate(receipt.purchase_date || "");
    const taxCents = toCents(receipt.tax);
    if (!receiptIsInDateRange(date, filters) || taxCents === null || taxCents <= 0) return [];
    const match = inferTaxableDescription(receipt, taxRate);
    return [{
      date: date ?? "",
      invoiceId: typeof receipt.invoice_id === "string" ? receipt.invoice_id : "",
      supplierName: typeof receipt.vendor === "string" ? receipt.vendor : "",
      description: match.description,
      tax: formatTax(taxCents),
      receiptId: receipt.id,
      status: match.status,
    } satisfies Gst288ReceiptRow];
  });

  eligible.sort((a, b) => {
    if (!a.date && b.date) return 1;
    if (a.date && !b.date) return -1;
    return a.date.localeCompare(b.date) || a.receiptId.localeCompare(b.receiptId);
  });

  const summary = eligible.reduce<Gst288ExportSummary>((result, row) => {
    result.totalReceipts += 1;
    result[row.status] += 1;
    return result;
  }, { totalReceipts: 0, matched: 0, ambiguous: 0, unmatched: 0 });

  return { rows: eligible, summary };
};

export const buildGst288Csv = (
  receipts: Receipt[],
  filters: Gst288ExportFilters = {},
): Blob => {
  const { rows } = analyzeGst288Receipts(receipts, filters);
  const lines = [CSV_COLUMNS, ...rows.map((row) => [
    row.date,
    row.invoiceId,
    row.supplierName,
    row.description,
    row.tax,
  ])].map((row) => row.map(csvField).join(","));
  return new Blob([`${lines.join("\r\n")}\r\n`], { type: "text/csv;charset=utf-8" });
};

export const buildGst288Export = (
  receipts: Receipt[],
  filters: Gst288ExportFilters = {},
): Gst288ExportResult => {
  const analyzed = analyzeGst288Receipts(receipts, filters);
  const lines = [CSV_COLUMNS, ...analyzed.rows.map((row) => [
    row.date,
    row.invoiceId,
    row.supplierName,
    row.description,
    row.tax,
  ])].map((row) => row.map(csvField).join(","));
  return {
    ...analyzed,
    blob: new Blob([`${lines.join("\r\n")}\r\n`], { type: "text/csv;charset=utf-8" }),
  };
};
