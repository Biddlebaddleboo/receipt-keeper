import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Plus, Tag, X } from "lucide-react";
import { Input } from "@/components/ui/input";

const DEFAULT_CATEGORIES = [
  "Food & Dining",
  "Groceries",
  "Transportation",
  "Shopping",
  "Entertainment",
  "Utilities",
  "Healthcare",
  "Travel",
  "Other",
];

const CategoryManager = () => {
  const navigate = useNavigate();
  const [categories, setCategories] = useState<string[]>(() => {
    const saved = localStorage.getItem("receipt-categories");
    return saved ? JSON.parse(saved) : DEFAULT_CATEGORIES;
  });
  const [newCategory, setNewCategory] = useState("");

  const save = (updated: string[]) => {
    setCategories(updated);
    localStorage.setItem("receipt-categories", JSON.stringify(updated));
  };

  const addCategory = () => {
    const trimmed = newCategory.trim();
    if (!trimmed || categories.includes(trimmed)) return;
    save([...categories, trimmed]);
    setNewCategory("");
  };

  const removeCategory = (cat: string) => {
    save(categories.filter((c) => c !== cat));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addCategory();
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 bg-background/80 backdrop-blur-md border-b px-4 py-4">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <button
            onClick={() => navigate("/settings")}
            className="p-2 -ml-2 rounded-md hover:bg-secondary transition-colors active:scale-95"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-lg font-semibold leading-tight tracking-tight">Categories</h1>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        {/* Add new category */}
        <div className="flex gap-2">
          <Input
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="New category name"
            className="flex-1"
          />
          <button
            onClick={addCategory}
            disabled={!newCategory.trim()}
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:brightness-110 transition-all active:scale-95 disabled:opacity-40 disabled:pointer-events-none flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" />
            Add
          </button>
        </div>

        {/* Category list */}
        <div className="space-y-1.5">
          {categories.map((cat) => (
            <div
              key={cat}
              className="flex items-center gap-3 px-3.5 py-3 rounded-lg bg-card receipt-shadow"
            >
              <Tag className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              <span className="text-sm font-medium flex-1">{cat}</span>
              <button
                onClick={() => removeCategory(cat)}
                className="p-1.5 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors active:scale-95"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}

          {categories.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">
              No categories yet. Add one above.
            </p>
          )}
        </div>
      </main>
    </div>
  );
};

export default CategoryManager;
