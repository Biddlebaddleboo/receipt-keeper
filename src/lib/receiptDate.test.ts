import { describe, expect, it, vi } from "vitest";
import { formatReceiptPurchaseDate, normalizeReceiptPurchaseDate } from "@/lib/receiptDate";

describe("formatReceiptPurchaseDate", () => {
  it("keeps YYYY-MM-DD on the same calendar date in Toronto", () => {
    vi.stubEnv("TZ", "America/Toronto");
    try {
      expect(
        formatReceiptPurchaseDate("2026-08-20", {
          month: "short",
          day: "numeric",
          year: "numeric",
        }),
      ).toBe("Aug 20, 2026");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it.each([
    ["2026-07-23", "2026-07-23"],
    ["2026/07/23", "2026-07-23"],
  ])("normalizes %s to %s without changing the calendar date", (value, expected) => {
    expect(normalizeReceiptPurchaseDate(value)).toBe(expected);
    expect(formatReceiptPurchaseDate(value, { year: "numeric", month: "2-digit", day: "2-digit" })).toBe("07/23/2026");
  });

  it.each(["", "2026/02/30", "2026-13-01", "not-a-date"]) ("rejects invalid canonical date %s", (value) => {
    expect(normalizeReceiptPurchaseDate(value)).toBeNull();
  });
});
