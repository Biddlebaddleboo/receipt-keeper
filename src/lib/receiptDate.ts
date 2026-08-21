const dateOnlyPattern = /^(\d{4})-(\d{2})-(\d{2})$/;

export function formatReceiptPurchaseDate(value: string, options: Intl.DateTimeFormatOptions) {
  const trimmed = value.trim();
  if (!trimmed) return "";

  const match = dateOnlyPattern.exec(trimmed);
  const date = match
    ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    : new Date(trimmed);

  if (Number.isNaN(date.getTime())) {
    return trimmed;
  }

  return date.toLocaleDateString("en-US", options);
}
