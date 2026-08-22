import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Gst288ExportSection } from "@/components/Gst288ExportSection";
import type { Receipt } from "@/hooks/useReceiptApi";

const mocks = vi.hoisted(() => ({ toast: vi.fn(), buildPdf: vi.fn() }));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@/lib/gst288Pdf", () => ({
  buildGst288Pdf: mocks.buildPdf,
  gst288PdfFilename: () => "gst288-test.pdf",
}));

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

  it("passes claimant fields and complete receipts through the PDF action", async () => {
    const fetchAllReceipts = vi.fn().mockResolvedValue([receipt("full-set", "2026-08-20")]);
    mocks.buildPdf.mockResolvedValue({
      rows: [],
      summary: { totalReceipts: 1, matched: 1, ambiguous: 0, unmatched: 0 },
      blob: new Blob(["pdf"], { type: "application/pdf" }),
      filename: "gst288-test.pdf",
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    render(<Gst288ExportSection fetchAllReceipts={fetchAllReceipts} />);
    expect(screen.queryByRole("textbox", { name: "GST288 business number" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "GST288 last name" }), { target: { value: "Example" } });
    fireEvent.change(screen.getByRole("textbox", { name: "GST288 first name" }), { target: { value: "Alex" } });
    fireEvent.click(screen.getByRole("button", { name: "Download GST288 PDF" }));

    await waitFor(() => expect(mocks.buildPdf).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: "full-set" })]),
      expect.objectContaining({ taxRatePercent: 13 }),
      { lastName: "Example", firstName: "Alex" },
    ));
    expect(await screen.findByRole("status")).toHaveTextContent("1 receipts · 1 matched · 0 ambiguous · 0 unmatched");
  });
});
