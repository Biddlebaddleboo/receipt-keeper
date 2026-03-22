import { useState } from "react";

export interface Receipt {
  id: string;
  imageUrl: string;
  file: File;
  uploadedAt: Date;
  status: "pending" | "uploading" | "success" | "error";
  errorMessage?: string;
}

// Configure your backend URL here
const API_BASE_URL = "/api";

export function useReceiptApi() {
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  const uploadReceipt = async (file: File) => {
    const id = crypto.randomUUID();
    const imageUrl = URL.createObjectURL(file);

    const newReceipt: Receipt = {
      id,
      imageUrl,
      file,
      uploadedAt: new Date(),
      status: "uploading",
    };

    setReceipts((prev) => [newReceipt, ...prev]);
    setIsUploading(true);

    try {
      const formData = new FormData();
      formData.append("receipt", file);

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
      uploadReceipt(receipt.file);
    }
  };

  return { receipts, isUploading, uploadReceipt, removeReceipt, retryUpload };
}