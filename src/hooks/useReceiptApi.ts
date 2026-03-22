import { useState, useCallback } from "react";

export interface ExtractedField {
  label: string;
  value: string;
}

export interface ReceiptItem {
  name: string;
  quantity: number;
  price: number;
}

export interface Receipt {
  id: string;
  vendor: string;
  total: number;
  currency: string;
  category: string;
  purchase_date: string;
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
const API_BASE_URL = "";

export function useReceiptApi() {
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const uploadReceipt = async (file: File) => {
    const id = crypto.randomUUID();
    const localImageUrl = URL.createObjectURL(file);

    const newReceipt: Receipt = {
      id,
      vendor: "",
      total: 0,
      currency: "USD",
      category: "",
      purchase_date: "",
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
      uploadReceipt(receipt.file);
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

  const fetchReceipt = async (id: string): Promise<Receipt | null> => {
    try {
      const response = await fetch(`${API_BASE_URL}/receipts/${id}`);
      if (!response.ok) throw new Error("Failed to fetch receipt");
      const data = await response.json();
      return { ...data, status: "success" as const };
    } catch {
      return null;
    }
  };

  const loadNextPage = useCallback(async () => {
    if (isLoadingMore || !hasMore) return;
    setIsLoadingMore(true);
    try {
      const lastReceipt = receipts[receipts.length - 1];
      const url = lastReceipt
        ? `${API_BASE_URL}/receipts?start_after_id=${lastReceipt.id}`
        : `${API_BASE_URL}/receipts`;
      const response = await fetch(url);
      if (!response.ok) throw new Error("Failed to load receipts");
      const data = await response.json();
      const items: Receipt[] = (data.items || data.results || data).map((r: Receipt) => ({
        ...r,
        status: "success" as const,
      }));
      if (items.length === 0) {
        setHasMore(false);
      } else {
        setReceipts((prev) => [...prev, ...items]);
        if (data.has_more === false || data.next === null) {
          setHasMore(false);
        }
      }
    } catch {
      // silently fail
    } finally {
      setIsLoadingMore(false);
    }
  }, [receipts, isLoadingMore, hasMore]);

  return { receipts, receiptsByDate, isUploading, isLoadingMore, hasMore, uploadReceipt, removeReceipt, retryUpload, fetchReceipt, loadNextPage };
}
