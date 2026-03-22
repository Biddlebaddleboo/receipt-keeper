import { useState, useEffect, useCallback } from "react";

export interface Category {
  id: string;
  name: string;
  description: string;
}

const API_BASE_URL = "https://ai-receipt-tracker-backend-267658267276.northamerica-northeast2.run.app";

export function useCategoryApi() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCategories = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE_URL}/categories`);
      if (!response.ok) throw new Error("Failed to fetch categories");
      const data = await response.json();
      const items: Category[] = Array.isArray(data) ? data : data.items || data.results || [];
      setCategories(items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load categories");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

  const createCategory = async (name: string, description = "") => {
    const response = await fetch(`${API_BASE_URL}/categories`, {
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
    const response = await fetch(`${API_BASE_URL}/categories/${id}`, {
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
    const response = await fetch(`${API_BASE_URL}/categories/${id}`, { method: "DELETE" });
    if (!response.ok) throw new Error("Failed to delete category");
    setCategories((prev) => prev.filter((c) => c.id !== id));
  };

  return { categories, isLoading, error, createCategory, updateCategory, deleteCategory, refetch: fetchCategories };
}
