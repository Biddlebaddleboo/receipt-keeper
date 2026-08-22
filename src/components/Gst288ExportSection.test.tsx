import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Gst288ExportSection } from "@/components/Gst288ExportSection";
import type { Receipt } from "@/hooks/useReceiptApi";
import { gst288SettingsStorageKey } from "@/lib/gst288Settings";

const mocks = vi.hoisted(() => ({
  toast: vi.fn(),
  buildPdf: vi.fn(),
  auth: { firebaseUID: "gst288-test-user", user: { email: "gst288@example.com" } },
}));

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => mocks.auth }));
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
  beforeEach(() => {
    window.localStorage.clear();
    mocks.toast.mockReset();
    mocks.buildPdf.mockReset();
  });

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

  it("loads names from user settings and debounced autosaves them without a business number", async () => {
    window.localStorage.setItem(
      gst288SettingsStorageKey("gst288@example.com"),
      JSON.stringify({ firstName: "Saved First", lastName: "Saved Last", businessNumber: "123456789RT0001" }),
    );

    render(<Gst288ExportSection fetchAllReceipts={vi.fn()} />);
    expect(screen.getByRole("textbox", { name: "GST288 first name" })).toHaveValue("Saved First");
    expect(screen.getByRole("textbox", { name: "GST288 last name" })).toHaveValue("Saved Last");

    fireEvent.change(screen.getByRole("textbox", { name: "GST288 first name" }), { target: { value: "Updated First" } });
    fireEvent.change(screen.getByRole("textbox", { name: "GST288 last name" }), { target: { value: "Updated Last" } });

    await waitFor(() => {
      const saved = JSON.parse(window.localStorage.getItem(gst288SettingsStorageKey("gst288@example.com")) ?? "{}");
      expect(saved).toEqual({ firstName: "Updated First", lastName: "Updated Last" });
    });
    expect(screen.queryByRole("textbox", { name: "GST288 business number" })).not.toBeInTheDocument();
  });

  it("reloads the persisted names for the same user", async () => {
    const { unmount } = render(<Gst288ExportSection fetchAllReceipts={vi.fn()} />);
    fireEvent.change(screen.getByRole("textbox", { name: "GST288 first name" }), { target: { value: "Alex" } });
    fireEvent.change(screen.getByRole("textbox", { name: "GST288 last name" }), { target: { value: "Example" } });
    await waitFor(() => expect(window.localStorage.getItem(gst288SettingsStorageKey("gst288@example.com"))).toContain("Alex"));

    unmount();
    render(<Gst288ExportSection fetchAllReceipts={vi.fn()} />);
    expect(screen.getByRole("textbox", { name: "GST288 first name" })).toHaveValue("Alex");
    expect(screen.getByRole("textbox", { name: "GST288 last name" })).toHaveValue("Example");
  });
});
