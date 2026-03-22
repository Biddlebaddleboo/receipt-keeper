import { useState } from "react";

export interface ExtractedField {
  label: string;
  value: string;
}

export interface Receipt {
  id: string;
  vendor: string;
  total: number;
  currency: string;
  purchase_date: string;
  image_url: string;
  extracted_text: string;
  extracted_fields: ExtractedField[];
  created_at: string;
  // Client-side fields
  file?: File;
  localImageUrl?: string;
  status: "pending" | "uploading" | "success" | "error";
  errorMessage?: string;
}

// Configure your backend URL here
const API_BASE_URL = "/api";

export function useReceiptApi() {
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  const uploadReceipt = async (file: File, metadata: { storeName: string; amount: number; date: Date }) => {
    const id = crypto.randomUUID();
    const localImageUrl = URL.createObjectURL(file);

    const newReceipt: Receipt = {
      id,
      vendor: metadata.storeName,
      total: metadata.amount,
      currency: "USD",
      purchase_date: metadata.date.toISOString(),
      image_url: "",
      extracted_text: "",
      extracted_fields: [],
      created_at: new Date().toISOString(),
      localImageUrl,
      file,
      status: "uploading",
    };

    setReceipts((prev) => [newReceipt, ...prev]);
    setIsUploading(true);

    try {
      const formData = new FormData();
      formData.append("receipt", file);
      formData.append("vendor", metadata.storeName);
      formData.append("total", metadata.amount.toString());
      formData.append("currency", "USD");
      formData.append("purchase_date", metadata.date.toISOString());

      const response = await fetch(`${API_BASE_URL}/receipts`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Upload failed: ${response.statusText}`);
      }

      const data = await response.json();

      setReceipts((prev) =>
        prev.map((r) =>
          r.id === id
            ? {
                ...r,
                ...data,
                id, // keep client id if backend doesn't return one
                status: "success" as const,
              }
            : r
        )
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Upload failed";
      setReceipts((prev) =>
        prev.map((r) =>
          r.id === id ? { ...r, status: "error" as const, errorMessage: message } : r
        )
      );
    } finally {
      setIsUploading(false);
    }
  };

  const removeReceipt = (id: string) => {
    setReceipts((prev) => {
      const receipt = prev.find((r) => r.id === id);
      if (receipt?.localImageUrl) URL.revokeObjectURL(receipt.localImageUrl);
      return prev.filter((r) => r.id !== id);
    });
  };

  const retryUpload = (id: string) => {
    const receipt = receipts.find((r) => r.id === id);
    if (receipt?.file) {
      removeReceipt(id);
      uploadReceipt(receipt.file, {
        storeName: receipt.vendor,
        amount: receipt.total,
        date: new Date(receipt.purchase_date),
      });
    }
  };

  // Group receipts by date
  const receiptsByDate = receipts.reduce<Record<string, Receipt[]>>((acc, receipt) => {
    const key = receipt.purchase_date
      ? new Date(receipt.purchase_date).toLocaleDateString("en-US", {
          year: "numeric",
          month: "long",
          day: "numeric",
        })
      : "Unknown Date";
    if (!acc[key]) acc[key] = [];
    acc[key].push(receipt);
    return acc;
  }, {});

  return { receipts, receiptsByDate, isUploading, uploadReceipt, removeReceipt, retryUpload };
}
