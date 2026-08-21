import { useCallback, useEffect, useState } from "react";
import { API_BASE_URL } from "@/config";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";

export type PrepaidCardState = "active" | "archived";
export type PrepaidImageType = "activation_receipt" | "package" | "opened_card";

export interface PrepaidActivationReceipt {
  id: string;
  storage_path: string;
  filename?: string;
  content_type?: string;
  created_at?: string;
}

export interface PrepaidCard {
  id: string;
  activation_barcode: string;
  vanilla_serial: string;
  denomination?: number;
  pan?: string;
  expiry?: string;
  cvv?: string;
  state: PrepaidCardState;
  archived_at?: string;
  package_image_storage_path?: string;
  opened_card_image_storage_path?: string;
  extraction_status?: string;
  created_at?: string;
  updated_at?: string;
}

export interface PrepaidPurchase {
  id: string;
  owner_email: string;
  sales_receipt_id: string;
  activation_receipts: PrepaidActivationReceipt[];
  cards: PrepaidCard[];
  active_card_count: number;
  archived_card_count: number;
  created_at?: string;
  updated_at?: string;
}

export interface PrepaidPackageExtraction {
  activation_barcode: string;
  serial_number: string;
  denomination?: number;
}

export interface PrepaidOpenedCardExtraction {
  pan: string;
  expiry: string;
  cvv: string;
}

export interface PrepaidCardInput {
  activation_barcode?: string;
  vanilla_serial?: string;
  serial_number?: string;
  denomination?: number;
  pan?: string;
  expiry?: string;
  cvv?: string;
  package_image_storage_path?: string;
  opened_card_image_storage_path?: string;
  confirmed: boolean;
}

export interface PrepaidCreatePurchaseInput {
  sales_receipt_id: string;
  activation_receipts: Array<{
    storage_path: string;
    filename?: string;
    content_type?: string;
  }>;
  cards: PrepaidCardInput[];
}

interface SignedUploadResponse {
  storage_path: string;
  upload_url: string;
  form_fields?: Record<string, string> | null;
  fields?: Record<string, string> | null;
  expires_at: string;
}

async function readError(response: Response) {
  const payload = await response.json().catch(() => null);
  if (payload && typeof payload.detail === "string") return payload.detail;
  return response.text().catch(() => "Request failed");
}

async function uploadToGCSViaPolicy(uploadUrl: string, file: File, formFields: Record<string, string>) {
  const formData = new FormData();
  Object.entries(formFields).forEach(([key, value]) => formData.append(key, value));
  formData.append("file", file);
  const response = await fetch(uploadUrl, { method: "POST", body: formData });
  if (response.status === 201 || response.status === 204) return;
  throw new Error(`GCS upload failed (${response.status})`);
}

export function usePrepaidStatus() {
  const { token, isLoading: authLoading } = useAuth();
  const [enabled, setEnabled] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (authLoading || !token) {
      setEnabled(false);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    void apiFetch(`${API_BASE_URL}/prepaid/status`)
      .then((response) => {
        if (!cancelled) setEnabled(response.ok);
      })
      .catch(() => {
        if (!cancelled) setEnabled(false);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [authLoading, token]);

  return { enabled, isLoading };
}

export function usePrepaidApi() {
  const listPurchases = useCallback(async (state: "active" | "archived" | "all" = "active") => {
    const response = await apiFetch(`${API_BASE_URL}/prepaid/purchases?state=${state}`);
    if (!response.ok) throw new Error(await readError(response));
    const payload = (await response.json()) as { purchases?: PrepaidPurchase[] };
    return Array.isArray(payload.purchases) ? payload.purchases : [];
  }, []);

  const createSignedUpload = useCallback(async (file: File, imageType: PrepaidImageType) => {
    const response = await apiFetch(`${API_BASE_URL}/prepaid/images/signed-upload`, {
      method: "POST",
      body: JSON.stringify({
        filename: file.name,
        content_type: file.type || "image/webp",
        image_type: imageType,
      }),
    });
    if (!response.ok) throw new Error(await readError(response));
    return response.json() as Promise<SignedUploadResponse>;
  }, []);

  const uploadPrepaidImage = useCallback(async (file: File, imageType: PrepaidImageType) => {
    if (file.type !== "image/webp") {
      throw new Error(`Only WebP uploads are allowed. Received: ${file.type || "unknown"}`);
    }
    const signed = await createSignedUpload(file, imageType);
    const fields = signed.form_fields ?? signed.fields;
    if (!fields || typeof signed.upload_url !== "string" || typeof signed.storage_path !== "string") {
      throw new Error("Signed upload response is incomplete.");
    }
    await uploadToGCSViaPolicy(signed.upload_url, file, fields);
    return signed.storage_path;
  }, [createSignedUpload]);

  const extractPackage = useCallback(async (storagePath: string) => {
    const response = await apiFetch(`${API_BASE_URL}/prepaid/package-extract`, {
      method: "POST",
      body: JSON.stringify({ storage_path: storagePath }),
    });
    if (!response.ok) throw new Error(await readError(response));
    return response.json() as Promise<{
      extraction: PrepaidPackageExtraction;
      warnings: string[];
      requires_confirmation: boolean;
    }>;
  }, []);

  const extractOpenedCard = useCallback(async (storagePath: string) => {
    const response = await apiFetch(`${API_BASE_URL}/prepaid/opened-card-extract`, {
      method: "POST",
      body: JSON.stringify({ storage_path: storagePath }),
    });
    if (!response.ok) throw new Error(await readError(response));
    return response.json() as Promise<{
      extraction: PrepaidOpenedCardExtraction;
      warnings: string[];
      requires_confirmation: boolean;
    }>;
  }, []);

  const createPurchase = useCallback(async (input: PrepaidCreatePurchaseInput) => {
    const response = await apiFetch(`${API_BASE_URL}/prepaid/purchases`, {
      method: "POST",
      body: JSON.stringify(input),
    });
    if (!response.ok) throw new Error(await readError(response));
    return response.json() as Promise<PrepaidPurchase>;
  }, []);

  const updateCard = useCallback(async (purchaseID: string, cardID: string, input: PrepaidCardInput) => {
    const response = await apiFetch(`${API_BASE_URL}/prepaid/purchases/${purchaseID}/cards/${cardID}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
    if (!response.ok) throw new Error(await readError(response));
    return response.json() as Promise<PrepaidPurchase>;
  }, []);

  const archiveCard = useCallback(async (purchaseID: string, cardID: string) => {
    const response = await apiFetch(`${API_BASE_URL}/prepaid/purchases/${purchaseID}/cards/${cardID}/archive`, {
      method: "POST",
    });
    if (!response.ok) throw new Error(await readError(response));
    return response.json() as Promise<PrepaidPurchase>;
  }, []);

  return {
    listPurchases,
    uploadPrepaidImage,
    extractPackage,
    extractOpenedCard,
    createPurchase,
    updateCard,
    archiveCard,
  };
}
