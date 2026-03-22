import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Plus, Tag, Loader2, Pencil, Check, X, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useCategoryApi, Category } from "@/hooks/useCategoryApi";
import { toast } from "sonner";

const CategoryManager = () => {
  const navigate = useNavigate();
  const { categories, isLoading, error, createCategory, updateCategory, deleteCategory } = useCategoryApi();
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const handleCreate = async () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    setIsCreating(true);
    try {
      await createCategory(trimmed, newDesc.trim());
      setNewName("");
      setNewDesc("");
      toast.success("Category created");
    } catch {
      toast.error("Failed to create category");
    } finally {
      setIsCreating(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleCreate();
    }
  };

  const startEdit = (cat: Category) => {
    setEditingId(cat.id);
    setEditName(cat.name);
    setEditDesc(cat.description);
  };

  const cancelEdit = () => {
    setEditingId(null);
  };

  const saveEdit = async () => {
    if (!editingId || !editName.trim()) return;
    setIsSaving(true);
    try {
      await updateCategory(editingId, { name: editName.trim(), description: editDesc.trim() });
      setEditingId(null);
      toast.success("Category updated");
    } catch {
      toast.error("Failed to update category");
    } finally {
      setIsSaving(false);
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
        <div className="space-y-2">
          <div className="flex gap-2">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Category name"
              className="flex-1"
              disabled={isCreating}
            />
            <button
              onClick={handleCreate}
              disabled={!newName.trim() || isCreating}
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:brightness-110 transition-all active:scale-95 disabled:opacity-40 disabled:pointer-events-none flex items-center gap-1.5"
            >
              {isCreating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Add
            </button>
          </div>
          <Input
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Description (optional)"
            disabled={isCreating}
          />
        </div>

        {/* Loading / Error states */}
        {isLoading && (
          <div className="flex justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {error && !isLoading && (
          <p className="text-sm text-destructive text-center py-8">{error}</p>
        )}

        {/* Category list */}
        {!isLoading && !error && (
          <div className="space-y-1.5">
            {categories.map((cat) => (
              <div
                key={cat.id}
                className="flex items-center gap-3 px-3.5 py-3 rounded-lg bg-card receipt-shadow"
              >
                {editingId === cat.id ? (
                  <div className="flex-1 flex items-center gap-2">
                    <div className="flex-1 space-y-1.5">
                      <Input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="h-8 text-sm"
                        disabled={isSaving}
                      />
                      <Input
                        value={editDesc}
                        onChange={(e) => setEditDesc(e.target.value)}
                        placeholder="Description"
                        className="h-8 text-sm"
                        disabled={isSaving}
                      />
                    </div>
                    <button
                      onClick={saveEdit}
                      disabled={!editName.trim() || isSaving}
                      className="p-1.5 rounded-md hover:bg-primary/10 text-primary transition-colors active:scale-95 disabled:opacity-40"
                    >
                      {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    </button>
                    <button
                      onClick={cancelEdit}
                      disabled={isSaving}
                      className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground transition-colors active:scale-95"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <>
                    <Tag className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium block">{cat.name}</span>
                      {cat.description && (
                        <span className="text-xs text-muted-foreground block truncate">{cat.description}</span>
                      )}
                    </div>
                    <button
                      onClick={() => startEdit(cat)}
                      className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors active:scale-95"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                  </>
                )}
              </div>
            ))}

            {categories.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8">
                No categories yet. Add one above.
              </p>
            )}
          </div>
        )}
      </main>
    </div>
  );
};

export default CategoryManager;
