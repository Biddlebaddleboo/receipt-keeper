import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Gst288ExportSection } from "@/components/Gst288ExportSection";
import type { Receipt } from "@/hooks/useReceiptApi";

const mocks = vi.hoisted(() => ({ toast: vi.fn() }));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));

const receipt = (id: string, date: string): Receipt => ({
  id,
  vendor: "Store",
  subtotal: 5.5,
  tax: 0.72,
  total: 6.22,
  category: "Food",
  purchase_date: date,
  invoice_id: id,
  extracted_text: "",
  extracted_fields: [],
  items: [{ name: "Fee", quantity: 1, price: 5.5 }],
  created_at: `${date}T00:00:00.000Z`,
  status: "success",
});

describe("Gst288ExportSection", () => {
  it("fetches the complete receipt set, downloads CSV, and shows the summary", async () => {
    const fetchAllReceipts = vi.fn().mockResolvedValue([
      receipt("older", "2026-08-01"),
      receipt("visible", "2026-08-31"),
    ]);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    render(<Gst288ExportSection fetchAllReceipts={fetchAllReceipts} />);
    fireEvent.change(screen.getByRole("spinbutton", { name: "GST/HST rate" }), { target: { value: "13" } });
    fireEvent.click(screen.getByRole("button", { name: "Download CSV" }));

    await waitFor(() => expect(fetchAllReceipts).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("status")).toHaveTextContent("2 receipts · 2 matched · 0 ambiguous · 0 unmatched");
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "GST288 CSV downloaded" }));
  });
});
