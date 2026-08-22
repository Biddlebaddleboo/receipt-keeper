import { MemoryRouter } from "react-router-dom";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Settings from "@/pages/Settings";

const mocks = vi.hoisted(() => ({ prepaidEnabled: false }));

vi.mock("@/contexts/ThemeContext", () => ({ useTheme: () => ({ theme: "light", toggleTheme: vi.fn() }) }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ token: "token" }) }));
vi.mock("@/hooks/usePrepaidApi", () => ({ usePrepaidStatus: () => ({ enabled: mocks.prepaidEnabled, isLoading: false }) }));
vi.mock("@/hooks/useReceiptApi", () => ({ useReceiptApi: () => ({ fetchAllReceipts: vi.fn() }) }));
vi.mock("@/hooks/usePaymentPlanApi", () => ({ usePaymentPlanApi: () => ({ plans: [], isLoading: false, error: null }) }));
vi.mock("@/hooks/useUserPlanApi", () => ({ useUserPlanApi: () => ({ userPlan: null, isLoading: false, refetch: vi.fn() }) }));
vi.mock("@/components/AIAccessSettings", () => ({ AIAccessSettings: () => null }));

describe("Settings GST288 feature gate", () => {
  beforeEach(() => {
    mocks.prepaidEnabled = false;
  });

  it("hides GST288 export when prepaid is disabled", () => {
    render(<MemoryRouter><Settings /></MemoryRouter>);
    expect(screen.queryByRole("region", { name: "GST288 export" })).not.toBeInTheDocument();
  });

  it("shows GST288 export when prepaid is enabled", () => {
    mocks.prepaidEnabled = true;
    render(<MemoryRouter><Settings /></MemoryRouter>);
    expect(screen.getByRole("region", { name: "GST288 export" })).toBeInTheDocument();
  });
});
