import { describe, expect, it, vi } from "vitest";
import { formatReceiptPurchaseDate } from "@/lib/receiptDate";

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
});
