const dateOnlyPattern = /^(\d{4})([-/])(\d{2})\2(\d{2})$/;
const shortUsDatePattern = /^(\d{2})\/(\d{2})\/(\d{2})$/;

const daysInMonth = (year: number, month: number): number => {
  if (month === 2) {
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  }
  return [31, 0, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0;
};

/**
 * Normalize the supported canonical date-only formats without timezone-aware
 * Date parsing. Returns null for missing or clearly invalid values.
 */
export function normalizeReceiptPurchaseDate(value: string): string | null {
  const trimmed = value.trim();
  const canonicalMatch = dateOnlyPattern.exec(trimmed);
  const shortUsMatch = shortUsDatePattern.exec(trimmed);
  if (!canonicalMatch && !shortUsMatch) return null;

  const year = canonicalMatch ? Number(canonicalMatch[1]) : 2000 + Number(shortUsMatch![3]);
  const month = canonicalMatch ? Number(canonicalMatch[3]) : Number(shortUsMatch![1]);
  const day = canonicalMatch ? Number(canonicalMatch[4]) : Number(shortUsMatch![2]);
  if (year < 1 || month < 1 || month > 12) return null;

  if (day < 1 || day > daysInMonth(year, month)) return null;

  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function formatReceiptPurchaseDate(value: string, options: Intl.DateTimeFormatOptions) {
  const trimmed = value.trim();
  if (!trimmed) return "";

  const normalized = normalizeReceiptPurchaseDate(trimmed);
  if (!normalized && (dateOnlyPattern.test(trimmed) || shortUsDatePattern.test(trimmed))) return trimmed;

  const date = normalized
    ? new Date(Number(normalized.slice(0, 4)), Number(normalized.slice(5, 7)) - 1, Number(normalized.slice(8, 10)))
    : new Date(trimmed);

  if (Number.isNaN(date.getTime())) {
    return trimmed;
  }

  return date.toLocaleDateString("en-US", options);
}
