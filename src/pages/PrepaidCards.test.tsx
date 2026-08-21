import { MemoryRouter } from "react-router-dom";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PrepaidCards from "@/pages/PrepaidCards";

const mocks = vi.hoisted(() => ({
  listPurchases: vi.fn(),
  searchCards: vi.fn(),
  signActivationReceiptImage: vi.fn(),
  signCardImage: vi.fn(),
  getCardDetail: vi.fn(),
  fetchReceipt: vi.fn(),
}));

vi.mock("@/hooks/usePrepaidApi", () => ({
  usePrepaidStatus: () => ({ enabled: true, isLoading: false }),
  usePrepaidApi: () => ({
    listPurchases: mocks.listPurchases,
    searchCards: mocks.searchCards,
    signActivationReceiptImage: mocks.signActivationReceiptImage,
    uploadPrepaidImage: vi.fn(),
    extractOpenedCard: vi.fn(),
    updateCard: vi.fn(),
    archiveCard: vi.fn(),
    getCardDetail: mocks.getCardDetail,
    signCardImage: mocks.signCardImage,
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
                package_image_storage_path: "receipts/u_owner/prepaid/package/card-1.webp",
                opened_card_image_storage_path: "receipts/u_owner/prepaid/opened/card-1.webp",
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
    mocks.searchCards.mockResolvedValue([]);
    mocks.getCardDetail.mockResolvedValue({
      id: "card-1",
      activation_barcode: "123456789012345678901234567890",
      vanilla_serial: "12345678901",
      denomination: 75,
      state: "active",
      last4: "1234",
      details_captured: true,
      pan: "1234567890121234",
      expiry: "12/29",
      cvv: "123",
      package_image_storage_path: "receipts/u_owner/prepaid/package/card-1.webp",
      opened_card_image_storage_path: "receipts/u_owner/prepaid/opened/card-1.webp",
    });
    mocks.signCardImage.mockImplementation((_purchaseID: string, _cardID: string, kind: string) => {
      return Promise.resolve(kind === "package" ? "https://signed.example/package.webp" : "https://signed.example/opened.webp");
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

  it("renders saved card images after reload and exposes download actions", async () => {
    render(
      <MemoryRouter>
        <PrepaidCards />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText("Circle K")).toBeInTheDocument());
    const salesActions = screen.getByRole("group", { name: "Sales receipt actions" });
    expect(within(salesActions).getByRole("button", { name: /download sales/i })).toBeInTheDocument();
    for (const activationIndex of [1, 2]) {
      const activationActions = screen.getByRole("group", { name: `Activation receipt ${activationIndex}` });
      expect(within(activationActions).getByRole("button", { name: "Download" })).toBeInTheDocument();
    }

    fireEvent.click(screen.getAllByText("$75.00 Vanilla")[0].closest("button") as HTMLButtonElement);

    await waitFor(() => expect(screen.getByAltText("Package image")).toBeInTheDocument());
    expect(screen.getByAltText("Opened-card image")).toBeInTheDocument();
    expect(screen.getByAltText("Package image")).toHaveAttribute("src", "https://signed.example/package.webp");
    expect(screen.getByAltText("Opened-card image")).toHaveAttribute("src", "https://signed.example/opened.webp");
    const packageImage = screen.getByRole("region", { name: "Package image" });
    expect(within(packageImage).getByRole("button", { name: "View" })).toBeInTheDocument();
    expect(within(packageImage).getByRole("button", { name: "Download" })).toBeInTheDocument();
    const openedCardImage = screen.getByRole("region", { name: "Opened-card image" });
    expect(within(openedCardImage).getByRole("button", { name: "View" })).toBeInTheDocument();
    expect(within(openedCardImage).getByRole("button", { name: "Download" })).toBeInTheDocument();
  });

  it("renders multiple last4 matches and opens the existing card detail", async () => {
    mocks.searchCards.mockResolvedValue([
      {
        purchase_id: "purchase-1",
        card_id: "card-1",
        last4: "3456",
        denomination: 75,
        state: "active",
        activation_barcode: "123456789012345678901234567890",
        vanilla_serial: "12345678901",
        sales_receipt_id: "receipt-1",
        activation_receipt_count: 2,
        details_captured: true,
      },
      {
        purchase_id: "purchase-1",
        card_id: "card-2",
        last4: "3456",
        denomination: 50,
        state: "active",
        activation_barcode: "9999999999999999999999123456",
        vanilla_serial: "10987654321",
        sales_receipt_id: "receipt-1",
        activation_receipt_count: 2,
        details_captured: true,
      },
    ]);
    mocks.getCardDetail.mockImplementation((_purchaseID: string, cardID: string) => Promise.resolve({
      id: cardID,
      activation_barcode: cardID === "card-2" ? "9999999999999999999999123456" : "123456789012345678901234567890",
      vanilla_serial: cardID === "card-2" ? "10987654321" : "12345678901",
      denomination: cardID === "card-2" ? 50 : 75,
      state: "active",
      last4: "3456",
      details_captured: true,
      pan: cardID === "card-2" ? "9999999999993456" : "1234567890123456",
      expiry: "12/29",
      cvv: "123",
      package_image_storage_path: "receipts/u_owner/prepaid/package/card-2.webp",
      opened_card_image_storage_path: "receipts/u_owner/prepaid/opened/card-2.webp",
    }));

    render(
      <MemoryRouter>
        <PrepaidCards />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText("Circle K")).toBeInTheDocument());
    fireEvent.change(screen.getByRole("textbox", { name: "Search full card number or last 4" }), { target: { value: "34-56" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    await waitFor(() => expect(mocks.searchCards).toHaveBeenCalledWith("3456"));
    const results = screen.getByRole("region", { name: "Search results" });
    expect(within(results).getAllByRole("button", { name: /card ending 3456/i })).toHaveLength(2);
    expect(within(results).getByText("$50.00 Vanilla")).toBeInTheDocument();
    fireEvent.click(within(results).getAllByRole("button", { name: /card ending 3456/i })[1]);

    await waitFor(() => expect(screen.getByDisplayValue("9999999999993456")).toBeInTheDocument());
    expect(screen.getByDisplayValue("12/29")).toBeInTheDocument();
    expect(screen.getByDisplayValue("123")).toBeInTheDocument();
    expect(screen.getByText("Package barcode: 9999999999999999999999123456")).toBeInTheDocument();
    expect(screen.getByText("Vanilla serial: 10987654321")).toBeInTheDocument();
    const relatedReceipts = screen.getByRole("region", { name: "Related receipts" });
    expect(relatedReceipts).toBeInTheDocument();
    expect(within(relatedReceipts).getByRole("group", { name: "Activation receipt 1" })).toBeInTheDocument();
    expect(within(relatedReceipts).getByRole("group", { name: "Activation receipt 2" })).toBeInTheDocument();
    expect(screen.getByAltText("Package image")).toBeInTheDocument();
    expect(screen.getByAltText("Opened-card image")).toBeInTheDocument();
  });

  it("validates search length before submitting", async () => {
    render(
      <MemoryRouter>
        <PrepaidCards />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText("Circle K")).toBeInTheDocument());
    fireEvent.change(screen.getByRole("textbox", { name: "Search full card number or last 4" }), { target: { value: "12345" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Enter exactly 4 or 16 digits.");
    expect(mocks.searchCards).not.toHaveBeenCalled();
  });
});
