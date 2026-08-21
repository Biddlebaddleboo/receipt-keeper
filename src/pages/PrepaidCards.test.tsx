import { MemoryRouter } from "react-router-dom";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PrepaidCards from "@/pages/PrepaidCards";

const mocks = vi.hoisted(() => ({
  listPurchases: vi.fn(),
  signActivationReceiptImage: vi.fn(),
  fetchReceipt: vi.fn(),
}));

vi.mock("@/hooks/usePrepaidApi", () => ({
  usePrepaidStatus: () => ({ enabled: true, isLoading: false }),
  usePrepaidApi: () => ({
    listPurchases: mocks.listPurchases,
    signActivationReceiptImage: mocks.signActivationReceiptImage,
    uploadPrepaidImage: vi.fn(),
    extractOpenedCard: vi.fn(),
    updateCard: vi.fn(),
    archiveCard: vi.fn(),
    getCardDetail: vi.fn(),
  }),
}));

vi.mock("@/hooks/useReceiptApi", () => ({
  useReceiptApi: () => ({
    fetchReceipt: mocks.fetchReceipt,
  }),
}));

vi.mock("@/lib/ffmpegImageConverter", () => ({
  convertReceiptImageFile: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe("PrepaidCards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listPurchases.mockImplementation((state: string) => {
      if (state === "active") {
        return Promise.resolve([
          {
            id: "purchase-1",
            owner_email: "owner@example.com",
            sales_receipt_id: "receipt-1",
            activation_receipts: [
              { id: "activation-1", storage_path: "path-1" },
              { id: "activation-2", storage_path: "path-2" },
            ],
            cards: [
              {
                id: "card-1",
                activation_barcode: "123456789012345678901234567890",
                vanilla_serial: "12345678901",
                denomination: 75,
                state: "active",
                last4: "1234",
                details_captured: true,
              },
              {
                id: "card-2",
                activation_barcode: "9999999999999999999999123456",
                vanilla_serial: "10987654321",
                denomination: 75,
                state: "active",
                details_captured: false,
              },
            ],
            active_card_count: 2,
            archived_card_count: 0,
            created_at: "2026-08-20T12:00:00Z",
          },
        ]);
      }
      return Promise.resolve([]);
    });
    mocks.fetchReceipt.mockResolvedValue({
      id: "receipt-1",
      vendor: "Circle K",
      purchase_date: "2026-08-20",
      total: 150,
      subtotal: 0,
      tax: 0,
      category: "",
      extracted_text: "",
      extracted_fields: [],
      items: [],
      created_at: "2026-08-20T12:00:00Z",
      status: "success",
    });
  });

  it("groups active cards by purchase with receipt metadata and activation count", async () => {
    render(
      <MemoryRouter>
        <PrepaidCards />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText("Circle K")).toBeInTheDocument());

    expect(screen.getByText("Aug 20, 2026")).toBeInTheDocument();
    expect(screen.getByText("Sales receipt ✓")).toBeInTheDocument();
    expect(screen.getByText("Activation receipts (2)")).toBeInTheDocument();
    expect(screen.getByText("•••• 1234")).toBeInTheDocument();
    expect(screen.getByText("Card details not captured")).toBeInTheDocument();
    expect(screen.getAllByText("$75.00 Vanilla")).toHaveLength(2);
  });
});
