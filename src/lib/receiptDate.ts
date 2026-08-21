const dateOnlyPattern = /^(\d{4})([-/])(\d{2})\2(\d{2})$/;
const shortUsDatePattern = /^(\d{2})\/(\d{2})\/(\d{2})$/;
const monthNameDatePattern = /^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/;

const monthNameToNumber: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

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
  const monthNameMatch = monthNameDatePattern.exec(trimmed);
  let year: number;
  let month: number;
  let day: number;

  if (canonicalMatch) {
    year = Number(canonicalMatch[1]);
    month = Number(canonicalMatch[3]);
    day = Number(canonicalMatch[4]);
  } else if (shortUsMatch) {
    year = 2000 + Number(shortUsMatch[3]);
    month = Number(shortUsMatch[1]);
    day = Number(shortUsMatch[2]);
  } else if (monthNameMatch) {
    month = monthNameToNumber[monthNameMatch[1].toLowerCase()] ?? 0;
    day = Number(monthNameMatch[2]);
    year = Number(monthNameMatch[3]);
  } else {
    return null;
  }

  if (year < 1 || month < 1 || month > 12) return null;

  if (day < 1 || day > daysInMonth(year, month)) return null;

  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function formatReceiptPurchaseDate(value: string, options: Intl.DateTimeFormatOptions) {
  const trimmed = value.trim();
  if (!trimmed) return "";

  const normalized = normalizeReceiptPurchaseDate(trimmed);
  if (!normalized && (dateOnlyPattern.test(trimmed) || shortUsDatePattern.test(trimmed) || monthNameDatePattern.test(trimmed))) return trimmed;

  const date = normalized
    ? new Date(Number(normalized.slice(0, 4)), Number(normalized.slice(5, 7)) - 1, Number(normalized.slice(8, 10)))
    : new Date(trimmed);

  if (Number.isNaN(date.getTime())) {
    return trimmed;
  }

  return date.toLocaleDateString("en-US", options);
}
