import { MemoryRouter } from "react-router-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Index from "@/pages/Index";

const mocks = vi.hoisted(() => ({
  fetchAllReceipts: vi.fn(),
  buildReceiptExportZip: vi.fn(),
  filterReceipts: vi.fn(),
  filterReceiptsForExport: vi.fn(),
  receiptExportZipFilename: vi.fn(),
  fetchSignedReceiptImageUrl: vi.fn(),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ token: "token", isLoading: false, signOut: vi.fn() }),
}));

vi.mock("@/hooks/useReceiptApi", () => ({
  useReceiptApi: () => ({
    receipts: [{ id: "visible", vendor: "Visible", category: "Food", purchase_date: "2026-08-20", total: 1 }],
    receiptsByDate: {},
    isUploading: false,
    isLoadingMore: false,
    hasMore: false,
    uploadReceipt: vi.fn(),
    uploadReceiptImage: vi.fn(),
    replaceReceiptImage: vi.fn(),
    removeReceipt: vi.fn(),
    retryUpload: vi.fn(),
    fetchReceipt: vi.fn(),
    fetchAllReceipts: mocks.fetchAllReceipts,
    loadNextPage: vi.fn(),
    refreshLatest: vi.fn(),
  }),
}));

vi.mock("@/hooks/usePrepaidApi", () => ({
  usePrepaidStatus: () => ({ enabled: false }),
}));

vi.mock("@/hooks/useCategoryApi", () => ({
  useCategoryApi: () => ({ categories: [{ id: "Food", name: "Food", description: "" }] }),
}));

vi.mock("@/components/ReceiptList", () => ({
  ReceiptList: ({ receiptsByDate, onReceiptClick, emptyMessage }: {
    receiptsByDate: Record<string, Array<{ id: string; vendor: string }>>;
    onReceiptClick: (receipt: { id: string; vendor: string }) => void;
    emptyMessage?: string;
  }) => (
    <div>
      {Object.values(receiptsByDate).flat().map((receipt) => (
        <button key={receipt.id} type="button" onClick={() => onReceiptClick(receipt)}>{receipt.id}</button>
      ))}
      {Object.keys(receiptsByDate).length === 0 && <p>{emptyMessage}</p>}
    </div>
  ),
}));
vi.mock("@/components/ReceiptDetail", () => ({ ReceiptDetail: () => null }));
vi.mock("@/components/AddReceiptForm", () => ({ AddReceiptForm: () => null }));
vi.mock("@/lib/ffmpegImageConverter", () => ({ preloadReceiptImageConverter: vi.fn() }));
vi.mock("@/lib/receiptImage", () => ({ fetchSignedReceiptImageUrl: mocks.fetchSignedReceiptImageUrl }));
vi.mock("@/lib/receiptExport", () => ({
  buildReceiptExportZip: mocks.buildReceiptExportZip,
  filterReceipts: mocks.filterReceipts,
  filterReceiptsForExport: mocks.filterReceiptsForExport,
  receiptExportZipFilename: mocks.receiptExportZipFilename,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

describe("Index receipt filters and export", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    const allReceipts = [
      { id: "visible", vendor: "Visible", category: "Food", purchase_date: "2026-08-20", total: 1 },
      { id: "older-not-loaded", vendor: "Older", category: "Food", purchase_date: "2025-01-01", total: 2 },
    ];
    mocks.fetchAllReceipts.mockResolvedValue(allReceipts);
    mocks.filterReceipts.mockImplementation((receipts: Array<{ vendor: string; category: string; purchase_date: string }>, filters: { vendor?: string; categories?: string[]; fromDate?: string; toDate?: string }) => receipts.filter((receipt) => {
      const vendorMatches = !filters.vendor || receipt.vendor.toLowerCase().includes(filters.vendor.toLowerCase());
      const categoryMatches = !filters.categories?.length || filters.categories.includes(receipt.category);
      const fromMatches = !filters.fromDate || receipt.purchase_date >= filters.fromDate;
      const toMatches = !filters.toDate || receipt.purchase_date <= filters.toDate;
      return vendorMatches && categoryMatches && fromMatches && toMatches;
    }));
    mocks.filterReceiptsForExport.mockImplementation((receipts: unknown[]) => receipts);
    mocks.buildReceiptExportZip.mockImplementation(async (_receipts: unknown[], options: { onProgress?: (progress: unknown) => void }) => {
      options.onProgress?.({ completed: 2, total: 2, percentage: 100, phase: "complete" });
      return new Blob(["zip"], { type: "application/zip" });
    });
    mocks.receiptExportZipFilename.mockReturnValue("receipts.zip");
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  });

  it("uses the complete receipt metadata fetch rather than the visible page", async () => {
    render(<MemoryRouter><Index /></MemoryRouter>);

    fireEvent.click(screen.getByRole("button", { name: "Download Receipts" }));

    await waitFor(() => expect(mocks.buildReceiptExportZip).toHaveBeenCalled());
    expect(mocks.fetchAllReceipts).toHaveBeenCalledTimes(1);
    expect(mocks.filterReceiptsForExport).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ id: "older-not-loaded" }),
    ]), expect.objectContaining({ categories: [] }));
    expect(screen.getByText("2 matching receipts")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
  });

  it("filters the complete receipt set with case-insensitive partial store matching", async () => {
    render(<MemoryRouter><Index /></MemoryRouter>);

    fireEvent.change(screen.getByRole("searchbox", { name: "Store name" }), { target: { value: "OLDER" } });

    await waitFor(() => expect(screen.getByRole("button", { name: "older-not-loaded" })).toBeInTheDocument());
    expect(mocks.fetchAllReceipts).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "visible" })).not.toBeInTheDocument();
    expect(mocks.filterReceipts).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ id: "older-not-loaded" }),
    ]), expect.objectContaining({ vendor: "OLDER" }));
  });

  it("passes the shared store filter into the ZIP export", async () => {
    render(<MemoryRouter><Index /></MemoryRouter>);

    fireEvent.change(screen.getByRole("searchbox", { name: "Store name" }), { target: { value: "older" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "older-not-loaded" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Download Receipts" }));

    await waitFor(() => expect(mocks.buildReceiptExportZip).toHaveBeenCalled());
    expect(mocks.filterReceiptsForExport).toHaveBeenLastCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: "older-not-loaded" })]),
      expect.objectContaining({ vendor: "older", categories: [] }),
    );
  });

  it("uses a compact category dropdown for the shared filter", async () => {
    render(<MemoryRouter><Index /></MemoryRouter>);

    fireEvent.click(screen.getByLabelText("Filter receipt categories"));
    fireEvent.click(screen.getByRole("checkbox", { name: "Food" }));

    expect(screen.getByLabelText("Filter receipt categories")).toHaveTextContent("1 category");
    await waitFor(() => expect(mocks.filterReceipts).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ categories: ["Food"] }),
    ));
  });

  it("clears list filters and returns to the visible receipt list", async () => {
    render(<MemoryRouter><Index /></MemoryRouter>);

    fireEvent.change(screen.getByRole("searchbox", { name: "Store name" }), { target: { value: "older" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "older-not-loaded" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByRole("searchbox", { name: "Store name" })).toHaveValue("");
    await waitFor(() => expect(screen.queryByRole("button", { name: "older-not-loaded" })).not.toBeInTheDocument());
  });
});
