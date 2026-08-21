import { MemoryRouter } from "react-router-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Index from "@/pages/Index";

const mocks = vi.hoisted(() => ({
  fetchAllReceipts: vi.fn(),
  buildReceiptExportZip: vi.fn(),
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

vi.mock("@/components/ReceiptList", () => ({ ReceiptList: () => <div /> }));
vi.mock("@/components/ReceiptDetail", () => ({ ReceiptDetail: () => null }));
vi.mock("@/components/AddReceiptForm", () => ({ AddReceiptForm: () => null }));
vi.mock("@/lib/ffmpegImageConverter", () => ({ preloadReceiptImageConverter: vi.fn() }));
vi.mock("@/lib/receiptImage", () => ({ fetchSignedReceiptImageUrl: mocks.fetchSignedReceiptImageUrl }));
vi.mock("@/lib/receiptExport", () => ({
  buildReceiptExportZip: mocks.buildReceiptExportZip,
  filterReceiptsForExport: mocks.filterReceiptsForExport,
  receiptExportZipFilename: mocks.receiptExportZipFilename,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

describe("Index receipt export", () => {
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
});
