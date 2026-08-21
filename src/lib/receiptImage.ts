import { API_BASE_URL } from "@/config";
import { apiFetch } from "@/lib/api";

/** Get the short-lived, authenticated image URL for an owned receipt. */
export const fetchSignedReceiptImageUrl = async (receiptId: string): Promise<string | null> => {
  try {
    const response = await apiFetch(`${API_BASE_URL}/receipts/sign-image`, {
      method: "POST",
      body: JSON.stringify({ receipt_id: receiptId }),
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as { image_url?: string };
    return typeof payload.image_url === "string" && payload.image_url.trim() ? payload.image_url : null;
  } catch {
    return null;
  }
};
