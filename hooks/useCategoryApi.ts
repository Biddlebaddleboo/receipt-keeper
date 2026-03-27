import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { API_BASE_URL } from "@/config";
import { apiFetch } from "@/lib/api";

export interface Category {
  id: string;
  name: string;
  description: string;
}

export function useCategoryApi() {
  const { token, isLoading: authLoading } = useAuth();
  const tokenRef = useRef(token);
  useEffect(() => {
    tokenRef.current = token;
  }, [token]);

  const [categories, setCategories] = useState<Category[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCategories = useCallback(async () => {
    if (!tokenRef.current) return;

    setIsLoading(true);
    setError(null);
    try {
      const response = await apiFetch(`${API_BASE_URL}/categories`);
      if (!response.ok) throw new Error("Failed to fetch categories");
      const data = await response.json();
      const items: Category[] = Array.isArray(data) ? data : data.items || data.results || [];
      setCategories(items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load categories");
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (authLoading) return;
    if (!token) {
      setCategories([]);
      setIsLoading(false);
      return;
    }
    fetchCategories();
  }, [authLoading, token, fetchCategories]);

  const createCategory = async (name: string, description = "") => {
    if (!tokenRef.current) throw new Error("Not authenticated");

    const response = await apiFetch(`${API_BASE_URL}/categories`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, description }),
    });
    if (!response.ok) throw new Error("Failed to create category");
    const newCat: Category = await response.json();
    setCategories((prev) => [...prev, newCat].sort((a, b) => a.name.localeCompare(b.name)));
    return newCat;
  };

  const updateCategory = async (id: string, updates: { name?: string; description?: string }) => {
    if (!tokenRef.current) throw new Error("Not authenticated");

    const response = await apiFetch(`${API_BASE_URL}/categories/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    if (!response.ok) throw new Error("Failed to update category");
    const updated: Category = await response.json();
    setCategories((prev) =>
      prev.map((c) => (c.id === id ? updated : c)).sort((a, b) => a.name.localeCompare(b.name))
    );
    return updated;
  };

  const deleteCategory = async (id: string) => {
    if (!tokenRef.current) throw new Error("Not authenticated");

    const response = await apiFetch(`${API_BASE_URL}/categories/${id}`, {
      method: "DELETE",
    });
    if (!response.ok) throw new Error("Failed to delete category");
    setCategories((prev) => prev.filter((c) => c.id !== id));
  };

  return { categories, isLoading, error, createCategory, updateCategory, deleteCategory, refetch: fetchCategories };
}
