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
    const imageUrl = URL.createObjectURL(file);

    const newReceipt: Receipt = {
      id,
      imageUrl,
      file,
      capturedAt: new Date(),
      status: "uploading",
      storeName: metadata.storeName,
      amount: metadata.amount,
      date: metadata.date,
    };

    setReceipts((prev) => [newReceipt, ...prev]);
    setIsUploading(true);

    try {
      const formData = new FormData();
      formData.append("receipt", file);
      formData.append("storeName", metadata.storeName);
      formData.append("amount", metadata.amount.toString());
      formData.append("date", metadata.date.toISOString());

      const response = await fetch(`${API_BASE_URL}/receipts`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Upload failed: ${response.statusText}`);
      }

      setReceipts((prev) =>
        prev.map((r) => (r.id === id ? { ...r, status: "success" as const } : r))
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
      if (receipt) URL.revokeObjectURL(receipt.imageUrl);
      return prev.filter((r) => r.id !== id);
    });
  };

  const retryUpload = (id: string) => {
    const receipt = receipts.find((r) => r.id === id);
    if (receipt) {
      removeReceipt(id);
      uploadReceipt(receipt.file, {
        storeName: receipt.storeName,
        amount: receipt.amount,
        date: receipt.date,
      });
    }
  };

  // Group receipts by date
  const receiptsByDate = receipts.reduce<Record<string, Receipt[]>>((acc, receipt) => {
    const key = receipt.date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    if (!acc[key]) acc[key] = [];
    acc[key].push(receipt);
    return acc;
  }, {});

  return { receipts, receiptsByDate, isUploading, uploadReceipt, removeReceipt, retryUpload };
}