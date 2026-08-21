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
    ["06/21/26", "2026-06-21"],
    ["06/07/26", "2026-06-07"],
    ["Jun 7, 2026", "2026-06-07"],
    ["Jun 07, 2026", "2026-06-07"],
    ["June 7, 2026", "2026-06-07"],
    ["jUnE 7, 2026", "2026-06-07"],
  ])("normalizes %s to %s without changing the calendar date", (value, expected) => {
    expect(normalizeReceiptPurchaseDate(value)).toBe(expected);
    expect(formatReceiptPurchaseDate(value, { year: "numeric", month: "2-digit", day: "2-digit" })).toBe(
      `${expected.slice(5, 7)}/${expected.slice(8, 10)}/${expected.slice(0, 4)}`,
    );
  });

  it.each([
    ["Jan", "01"], ["January", "01"], ["Feb", "02"], ["February", "02"],
    ["Mar", "03"], ["March", "03"], ["Apr", "04"], ["April", "04"],
    ["May", "05"], ["Jun", "06"], ["June", "06"], ["Jul", "07"],
    ["July", "07"], ["Aug", "08"], ["August", "08"], ["Sep", "09"],
    ["Sept", "09"], ["September", "09"], ["Oct", "10"], ["October", "10"],
    ["Nov", "11"], ["November", "11"], ["Dec", "12"], ["December", "12"],
  ])("normalizes the English month name %s", (monthName, month) => {
    expect(normalizeReceiptPurchaseDate(`${monthName} 7, 2026`)).toBe(`2026-${month}-07`);
  });

  it.each(["02/29/25", "13/01/26", "06/31/26", "Feb 29, 2025", "Jun 31, 2026", "Foo 7, 2026", "", "2026/02/30", "2026-13-01", "not-a-date"]) ("rejects invalid date %s", (value) => {
    expect(normalizeReceiptPurchaseDate(value)).toBeNull();
  });

  it("does not reinterpret an invalid supported date with native parsing", () => {
    expect(formatReceiptPurchaseDate("02/29/25", { year: "numeric", month: "2-digit", day: "2-digit" })).toBe("02/29/25");
    expect(formatReceiptPurchaseDate("Feb 29, 2025", { year: "numeric", month: "2-digit", day: "2-digit" })).toBe("Feb 29, 2025");
  });

  it("accepts a leap day in a short US date", () => {
    expect(normalizeReceiptPurchaseDate("02/29/24")).toBe("2024-02-29");
  });

  it("accepts leap day in a month-name date", () => {
    expect(normalizeReceiptPurchaseDate("February 29, 2024")).toBe("2024-02-29");
  });
});
