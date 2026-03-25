import { useState, useCallback, useRef, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { API_BASE_URL } from "@/config";
import { apiFetch } from "@/lib/api";

export interface ExtractedField {
  label: string;
  value: string;
}

export interface ReceiptItem {
  name: string;
  quantity: number;
  price: number;
}

interface ReceiptUploadMeta {
  vendor?: string;
  subtotal?: number;
  tax?: number;
  total?: number;
  category?: string;
  purchase_date?: string;
}

interface SignedUploadResponse {
  storage_path: string;
  upload_url: string;
  method: "PUT";
  headers: Record<string, string>;
  expires_at: string;
}

export interface Receipt {
  id: string;
  vendor: string;
  subtotal: number;
  tax: number;
  total: number;
  category: string;
  purchase_date: string;
  extracted_text: string;
  extracted_fields: ExtractedField[];
  items: ReceiptItem[];
  created_at: string;
  image_url?: string;
  // Client-side fields
  file?: File;
  localImageUrl?: string;
  status: "pending" | "uploading" | "success" | "error";
  errorMessage?: string;
}

export function useReceiptApi() {
  const { token, isLoading: authLoading } = useAuth();
  const tokenRef = useRef(token);
  useEffect(() => {
    tokenRef.current = token;
  }, [token]);

  const getSignedUpload = async (file: File): Promise<SignedUploadResponse> => {
    const contentType = file.type?.trim() || "image/jpeg";
    const response = await apiFetch(`${API_BASE_URL}/receipts/signed-upload`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        filename: file.name,
        content_type: contentType,
      }),
    });

    if (!response.ok) throw new Error(await response.text());
    return response.json() as Promise<SignedUploadResponse>;
  };

  const uploadToGCS = async (uploadUrl: string, file: File, headers: Record<string, string>) => {
    const response = await fetch(uploadUrl, {
      method: "PUT",
      headers,
      credentials: "omit",
      body: file,
    });

    if (!response.ok) throw new Error(`GCS upload failed: ${response.status}`);
  };

  const finalizeUpload = async (storagePath: string, meta?: ReceiptUploadMeta) => {
    const response = await apiFetch(`${API_BASE_URL}/receipts/finalize-upload`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        storage_path: storagePath,
        ...meta,
      }),
    });

    if (!response.ok) throw new Error(await response.text());
    return response.json();
  };

  const createReceiptViaSignedUpload = async (file: File, meta?: ReceiptUploadMeta) => {
    const signed = await getSignedUpload(file);
    await uploadToGCS(signed.upload_url, file, signed.headers);
    return finalizeUpload(signed.storage_path, meta);
  };

  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const pollTimerRef = useRef<number | null>(null);
  const isLoadingMoreRef = useRef(isLoadingMore);

  useEffect(() => {
    isLoadingMoreRef.current = isLoadingMore;
  }, [isLoadingMore]);

  const normalizeReceipt = useCallback((r: Receipt): Receipt => {
    return {
      ...r,
      status: "success" as const,
    };
  }, []);

  const mergeIncomingReceipts = useCallback((prev: Receipt[], incoming: Receipt[]) => {
    const incomingIds = new Set(incoming.map((r) => r.id));
    const incomingMap = new Map(incoming.map((r) => [r.id, r]));

    const mergedIncoming = incoming.map((incomingReceipt) => {
      const existing = prev.find((p) => p.id === incomingReceipt.id);
      if (!existing) return incomingReceipt;
      return {
        ...existing,
        ...incomingReceipt,
        localImageUrl: existing.localImageUrl || incomingReceipt.localImageUrl,
        file: existing.file,
        status: "success" as const,
        errorMessage: undefined,
      };
    });

    const rest = prev.filter((r) => !incomingIds.has(r.id));
    return [...mergedIncoming, ...rest.filter((r) => !incomingMap.has(r.id))];
  }, []);

  const uploadReceipt = async (file: File) => {
    if (authLoading || !tokenRef.current) return;

    const id = crypto.randomUUID();
    const localImageUrl = URL.createObjectURL(file);

    const newReceipt: Receipt = {
      id,
      vendor: "",
      total: 0,
      subtotal: 0,
      tax: 0,
      category: "",
      purchase_date: "",
      extracted_text: "",
      extracted_fields: [],
      items: [],
      created_at: new Date().toISOString(),
      localImageUrl,
      file,
      status: "uploading",
    };

    setReceipts((prev) => [newReceipt, ...prev]);
    setIsUploading(true);

    try {
      const data = (await createReceiptViaSignedUpload(file)) as Record<string, unknown>;

      setReceipts((prev) =>
        prev.map((r) =>
          r.id === id
            ? {
                ...r,
                ...data,
                id: typeof data.id === "string" ? data.id : id,
                status: "success" as const,
              }
            : r
        )
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Upload failed";
      setReceipts((prev) =>
        prev.map((r) => (r.id === id ? { ...r, status: "error" as const, errorMessage: message } : r))
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
    if (authLoading || !tokenRef.current) return null;

    try {
      const response = await apiFetch(`${API_BASE_URL}/receipts/${id}`);
      if (!response.ok) throw new Error("Failed to fetch receipt");
      const data = await response.json();
      return { ...data, status: "success" as const };
    } catch {
      return null;
    }
  };

  const loadNextPage = useCallback(async () => {
    if (authLoading || isLoadingMore || !hasMore || !tokenRef.current) return;
    setIsLoadingMore(true);
    try {
      const url = nextCursor
        ? `${API_BASE_URL}/receipts?start_after_id=${nextCursor}`
        : `${API_BASE_URL}/receipts`;
      const response = await apiFetch(url);
      if (!response.ok) throw new Error("Failed to load receipts");
      const data = await response.json();
      const items: Receipt[] = (data.receipts || []).map((r: Receipt) => normalizeReceipt(r));
      if (items.length === 0) {
        setHasMore(false);
      } else {
        setReceipts((prev) => mergeIncomingReceipts(prev, items));
        if (data.next_cursor) {
          setNextCursor(data.next_cursor);
        } else {
          setHasMore(false);
        }
      }
    } catch {
      // silently fail
    } finally {
      setIsLoadingMore(false);
    }
  }, [authLoading, nextCursor, isLoadingMore, hasMore, mergeIncomingReceipts, normalizeReceipt]);

  const refreshLatest = useCallback(async () => {
    if (authLoading || !tokenRef.current || isLoadingMoreRef.current) return;

    try {
      const response = await apiFetch(`${API_BASE_URL}/receipts`);
      if (!response.ok) return;
      const data = await response.json();
      const items: Receipt[] = (data.receipts || []).map((r: Receipt) => normalizeReceipt(r));
      if (items.length > 0) {
        setReceipts((prev) => mergeIncomingReceipts(prev, items));
      }
    } catch {
      // no-op; keep existing list
    }
  }, [authLoading, mergeIncomingReceipts, normalizeReceipt]);

  useEffect(() => {
    if (authLoading || !tokenRef.current) return;

    const tick = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      refreshLatest();
    };

    tick();
    pollTimerRef.current = window.setInterval(tick, 5_000);
    document.addEventListener("visibilitychange", tick);

    return () => {
      if (pollTimerRef.current) window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
      document.removeEventListener("visibilitychange", tick);
    };
  }, [authLoading, token, refreshLatest]);

  return {
    receipts,
    receiptsByDate,
    isUploading,
    isLoadingMore,
    hasMore,
    uploadReceipt,
    removeReceipt,
    retryUpload,
    fetchReceipt,
    loadNextPage,
  };
}
