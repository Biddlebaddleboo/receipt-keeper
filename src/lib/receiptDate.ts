const dateOnlyPattern = /^(\d{4})([-/])(\d{2})\2(\d{2})$/;

/**
 * Normalize the supported canonical date-only formats without timezone-aware
 * Date parsing. Returns null for missing or clearly invalid values.
 */
export function normalizeReceiptPurchaseDate(value: string): string | null {
  const match = dateOnlyPattern.exec(value.trim());
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[3]);
  const day = Number(match[4]);
  if (year < 1 || month < 1 || month > 12) return null;

  const daysInMonth = [31, (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (day < 1 || day > daysInMonth) return null;

  return `${match[1]}-${match[3]}-${match[4]}`;
}

export function formatReceiptPurchaseDate(value: string, options: Intl.DateTimeFormatOptions) {
  const trimmed = value.trim();
  if (!trimmed) return "";

  const normalized = normalizeReceiptPurchaseDate(trimmed);
  const date = normalized
    ? new Date(Number(normalized.slice(0, 4)), Number(normalized.slice(5, 7)) - 1, Number(normalized.slice(8, 10)))
    : new Date(trimmed);

  if (Number.isNaN(date.getTime())) {
    return trimmed;
  }

  return date.toLocaleDateString("en-US", options);
}
