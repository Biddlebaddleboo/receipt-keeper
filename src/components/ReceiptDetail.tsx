import { useState, useEffect, useCallback } from "react";
import { Receipt, ReceiptItem } from "@/hooks/useReceiptApi";
import { X, Trash2, RotateCcw, Store, Calendar, DollarSign, CheckCircle2, AlertCircle, Loader2, FileText, Clock, List, ShoppingCart, Pencil, Check, Plus, Minus, Tag, Receipt as ReceiptIcon, Download } from "lucide-react";
import { toast } from "sonner";
import { useCategoryApi } from "@/hooks/useCategoryApi";
import { useAuth } from "@/contexts/AuthContext";

const API_BASE_URL = "https://ai-receipt-tracker-backend-267658267276.northamerica-northeast2.run.app";

interface ReceiptDetailProps {
  receipt: Receipt;
  onClose: () => void;
  onRemove: (id: string) => void;
  onRetry: (id: string) => void;
  fetchReceipt: (id: string) => Promise<Receipt | null>;
}

const statusConfig = {
  pending: { label: "Pending", color: "bg-muted text-muted-foreground", icon: null },
  uploading: { label: "Uploading…", color: "bg-primary/10 text-primary", icon: <Loader2 className="w-3.5 h-3.5 animate-spin" /> },
  success: { label: "Uploaded", color: "bg-success/10 text-success", icon: <CheckCircle2 className="w-3.5 h-3.5" /> },
  error: { label: "Failed", color: "bg-destructive/10 text-destructive", icon: <AlertCircle className="w-3.5 h-3.5" /> },
};

interface EditingItem {
  index: number;
  name: string;
  quantity: string;
  price: string;
}

export function ReceiptDetail({ receipt: initialReceipt, onClose, onRemove, onRetry, fetchReceipt }: ReceiptDetailProps) {
  const [receipt, setReceipt] = useState(initialReceipt);
  const [loading, setLoading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [editingItem, setEditingItem] = useState<EditingItem | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const { categories } = useCategoryApi();

  const saveField = async (field: string, value: string) => {
    const payload: Record<string, unknown> = {};
    if (field === "vendor") payload.vendor = value.trim();
    else if (field === "total") payload.total = parseFloat(value);
    else if (field === "subtotal") payload.subtotal = parseFloat(value);
    else if (field === "tax") payload.tax = parseFloat(value);
    else if (field === "category") payload.category = value;
    else if (field === "purchase_date") payload.purchase_date = value;

    if ((field === "total" || field === "subtotal" || field === "tax") && isNaN(payload[field] as number)) {
      toast.error(`Invalid ${field}`);
      return;
    }

    setIsSaving(true);
    try {
      const response = await fetch(`${API_BASE_URL}/receipts/${receipt.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error("Failed to save");
      setReceipt((prev) => ({ ...prev, ...payload }));
      setEditingField(null);
      toast.success(`${field.charAt(0).toUpperCase() + field.slice(1).replace("_", " ")} updated`);
    } catch {
      toast.error("Failed to save changes");
    } finally {
      setIsSaving(false);
    }
  };

  const startFieldEdit = (field: string, currentValue: string) => {
    setEditingField(field);
    setEditValue(currentValue);
  };

  const handleDelete = useCallback(async () => {
    setIsDeleting(true);
    try {
      const response = await fetch(`${API_BASE_URL}/receipts/${receipt.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Failed to delete");
      onRemove(receipt.id);
      onClose();
    } catch {
      setIsDeleting(false);
    }
  }, [receipt.id, onRemove, onClose]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchReceipt(initialReceipt.id).then((data) => {
      if (!cancelled && data) setReceipt(data);
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [initialReceipt.id, fetchReceipt]);

  const startEditing = (index: number) => {
    const item = receipt.items[index];
    setEditingItem({
      index,
      name: item.name,
      quantity: String(item.quantity),
      price: String(item.price),
    });
  };

  const cancelEditing = () => setEditingItem(null);

  const saveItem = async () => {
    if (!editingItem) return;
    const quantity = parseFloat(editingItem.quantity);
    const price = parseFloat(editingItem.price);
    if (!editingItem.name.trim() || isNaN(quantity) || isNaN(price)) {
      toast.error("Please fill in all fields with valid values");
      return;
    }

    const updatedItems = receipt.items.map((item, i) =>
      i === editingItem.index ? { name: editingItem.name.trim(), quantity, price } : item
    );

    setIsSaving(true);
    try {
      const response = await fetch(`${API_BASE_URL}/receipts/${receipt.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: updatedItems }),
      });
      if (!response.ok) throw new Error("Failed to save");
      setReceipt((prev) => ({ ...prev, items: updatedItems }));
      setEditingItem(null);
      toast.success("Item updated");
    } catch {
      toast.error("Failed to save changes");
    } finally {
      setIsSaving(false);
    }
  };

  const deleteItem = async (index: number) => {
    const updatedItems = receipt.items.filter((_, i) => i !== index);
    setIsSaving(true);
    try {
      const response = await fetch(`${API_BASE_URL}/receipts/${receipt.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: updatedItems }),
      });
      if (!response.ok) throw new Error("Failed to delete item");
      setReceipt((prev) => ({ ...prev, items: updatedItems }));
      if (editingItem?.index === index) setEditingItem(null);
      toast.success("Item removed");
    } catch {
      toast.error("Failed to remove item");
    } finally {
      setIsSaving(false);
    }
  };

  const addItem = async () => {
    const newItem: ReceiptItem = { name: "New item", quantity: 1, price: 0 };
    const updatedItems = [...(receipt.items || []), newItem];
    setIsSaving(true);
    try {
      const response = await fetch(`${API_BASE_URL}/receipts/${receipt.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: updatedItems }),
      });
      if (!response.ok) throw new Error("Failed to add item");
      setReceipt((prev) => ({ ...prev, items: updatedItems }));
      startEditing(updatedItems.length - 1);
    } catch {
      toast.error("Failed to add item");
    } finally {
      setIsSaving(false);
    }
  };

  const status = statusConfig[receipt.status];
  const imageUrl = receipt.localImageUrl || `${API_BASE_URL}/receipts/${receipt.id}/image`;
  const purchaseDate = receipt.purchase_date
    ? new Date(receipt.purchase_date).toLocaleDateString("en-US", {
        weekday: "long", month: "long", day: "numeric", year: "numeric",
      })
    : "—";

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background animate-fade-in">
      <header className="flex items-center justify-between px-4 py-3 border-b">
        <button onClick={onClose} className="p-2 -ml-2 rounded-md hover:bg-secondary transition-colors active:scale-95">
          <X className="w-5 h-5" />
        </button>
        <h2 className="text-sm font-semibold">Receipt Details</h2>
        <div className="flex gap-1">
          {receipt.status === "error" && (
            <button onClick={() => onRetry(receipt.id)} className="p-2 rounded-md hover:bg-secondary transition-colors active:scale-95">
              <RotateCcw className="w-5 h-5" />
            </button>
          )}
          <a
            href={`${API_BASE_URL}/receipts/${receipt.id}/image`}
            download={`receipt-${receipt.vendor || receipt.id}.jpg`}
            className="p-2 rounded-md hover:bg-secondary transition-colors active:scale-95"
          >
            <Download className="w-5 h-5" />
          </a>
          <button
            onClick={handleDelete}
            disabled={isDeleting}
            className="p-2 rounded-md hover:bg-destructive/10 text-destructive transition-colors active:scale-95 disabled:opacity-50"
          >
            {isDeleting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Trash2 className="w-5 h-5" />}
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {imageUrl && (
          <div className="aspect-[3/4] max-h-[50vh] bg-muted overflow-hidden">
            <img src={imageUrl} alt="Receipt" className="w-full h-full object-contain" />
          </div>
        )}

        <div className="p-4 space-y-3">
          <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${status.color}`}>
            {status.icon}
            {status.label}
          </div>

          <div className="space-y-2.5 pt-1">
            {/* Vendor */}
            {editingField === "vendor" ? (
              <div className="px-3.5 py-3 rounded-lg bg-secondary/80 space-y-2 ring-1 ring-primary/20">
                <label className="text-xs text-muted-foreground">Vendor</label>
                <input type="text" value={editValue} onChange={(e) => setEditValue(e.target.value)} className="w-full bg-background/80 rounded-md px-2.5 py-1.5 text-sm border border-border focus:outline-none focus:ring-1 focus:ring-primary" autoFocus />
                <div className="flex justify-end gap-1.5">
                  <button onClick={() => setEditingField(null)} className="px-2.5 py-1 rounded-md text-xs text-muted-foreground hover:bg-secondary transition-colors active:scale-95">Cancel</button>
                  <button onClick={() => saveField("vendor", editValue)} disabled={isSaving} className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors active:scale-95 disabled:opacity-50">
                    {isSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Save
                  </button>
                </div>
              </div>
            ) : (
              <button onClick={() => startFieldEdit("vendor", receipt.vendor || "")} className="w-full flex items-center gap-3 px-3.5 py-3 rounded-lg bg-secondary/50 hover:bg-secondary/70 transition-colors text-left group">
                <Store className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                <div className="flex-1">
                  <p className="text-xs text-muted-foreground">Vendor</p>
                  <p className="text-sm font-medium">{receipt.vendor || "—"}</p>
                </div>
                <Pencil className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>
            )}

            {/* Subtotal */}
            {editingField === "subtotal" ? (
              <div className="px-3.5 py-3 rounded-lg bg-secondary/80 space-y-2 ring-1 ring-primary/20">
                <label className="text-xs text-muted-foreground">Subtotal</label>
                <input type="number" value={editValue} onChange={(e) => setEditValue(e.target.value)} step="0.01" min="0" className="w-full bg-background/80 rounded-md px-2.5 py-1.5 text-sm tabular-nums border border-border focus:outline-none focus:ring-1 focus:ring-primary" autoFocus />
                <div className="flex justify-end gap-1.5">
                  <button onClick={() => setEditingField(null)} className="px-2.5 py-1 rounded-md text-xs text-muted-foreground hover:bg-secondary transition-colors active:scale-95">Cancel</button>
                  <button onClick={() => saveField("subtotal", editValue)} disabled={isSaving} className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors active:scale-95 disabled:opacity-50">
                    {isSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Save
                  </button>
                </div>
              </div>
            ) : (
              <button onClick={() => startFieldEdit("subtotal", String(receipt.subtotal ?? 0))} className="w-full flex items-center gap-3 px-3.5 py-3 rounded-lg bg-secondary/50 hover:bg-secondary/70 transition-colors text-left group">
                <DollarSign className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                <div className="flex-1">
                  <p className="text-xs text-muted-foreground">Subtotal</p>
                  <p className="text-sm font-medium tabular-nums">${(receipt.subtotal ?? 0).toFixed(2)}</p>
                </div>
                <Pencil className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>
            )}

            {/* Tax */}
            {editingField === "tax" ? (
              <div className="px-3.5 py-3 rounded-lg bg-secondary/80 space-y-2 ring-1 ring-primary/20">
                <label className="text-xs text-muted-foreground">Tax</label>
                <input type="number" value={editValue} onChange={(e) => setEditValue(e.target.value)} step="0.01" min="0" className="w-full bg-background/80 rounded-md px-2.5 py-1.5 text-sm tabular-nums border border-border focus:outline-none focus:ring-1 focus:ring-primary" autoFocus />
                <div className="flex justify-end gap-1.5">
                  <button onClick={() => setEditingField(null)} className="px-2.5 py-1 rounded-md text-xs text-muted-foreground hover:bg-secondary transition-colors active:scale-95">Cancel</button>
                  <button onClick={() => saveField("tax", editValue)} disabled={isSaving} className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors active:scale-95 disabled:opacity-50">
                    {isSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Save
                  </button>
                </div>
              </div>
            ) : (
              <button onClick={() => startFieldEdit("tax", String(receipt.tax ?? 0))} className="w-full flex items-center gap-3 px-3.5 py-3 rounded-lg bg-secondary/50 hover:bg-secondary/70 transition-colors text-left group">
                <ReceiptIcon className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                <div className="flex-1">
                  <p className="text-xs text-muted-foreground">Tax</p>
                  <p className="text-sm font-medium tabular-nums">${(receipt.tax ?? 0).toFixed(2)}</p>
                </div>
                <Pencil className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>
            )}

            {/* Total */}
            {editingField === "total" ? (
              <div className="px-3.5 py-3 rounded-lg bg-secondary/80 space-y-2 ring-1 ring-primary/20">
                <label className="text-xs text-muted-foreground">Total</label>
                <input type="number" value={editValue} onChange={(e) => setEditValue(e.target.value)} step="0.01" min="0" className="w-full bg-background/80 rounded-md px-2.5 py-1.5 text-sm tabular-nums border border-border focus:outline-none focus:ring-1 focus:ring-primary" autoFocus />
                <div className="flex justify-end gap-1.5">
                  <button onClick={() => setEditingField(null)} className="px-2.5 py-1 rounded-md text-xs text-muted-foreground hover:bg-secondary transition-colors active:scale-95">Cancel</button>
                  <button onClick={() => saveField("total", editValue)} disabled={isSaving} className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors active:scale-95 disabled:opacity-50">
                    {isSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Save
                  </button>
                </div>
              </div>
            ) : (
              <button onClick={() => startFieldEdit("total", String(receipt.total))} className="w-full flex items-center gap-3 px-3.5 py-3 rounded-lg bg-secondary/50 hover:bg-secondary/70 transition-colors text-left group">
                <DollarSign className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                <div className="flex-1">
                  <p className="text-xs text-muted-foreground">Total</p>
                  <p className="text-sm font-medium tabular-nums">${receipt.total.toFixed(2)}</p>
                </div>
                <Pencil className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>
            )}

            {/* Category */}
            {editingField === "category" ? (
              <div className="px-3.5 py-3 rounded-lg bg-secondary/80 space-y-2 ring-1 ring-primary/20">
                <label className="text-xs text-muted-foreground">Category</label>
                <select value={editValue} onChange={(e) => setEditValue(e.target.value)} className="w-full bg-background/80 rounded-md px-2.5 py-1.5 text-sm border border-border focus:outline-none focus:ring-1 focus:ring-primary" autoFocus>
                  <option value="">— None —</option>
                  {categories.map((cat) => (
                    <option key={cat.id} value={cat.name}>{cat.name}</option>
                  ))}
                </select>
                <div className="flex justify-end gap-1.5">
                  <button onClick={() => setEditingField(null)} className="px-2.5 py-1 rounded-md text-xs text-muted-foreground hover:bg-secondary transition-colors active:scale-95">Cancel</button>
                  <button onClick={() => saveField("category", editValue)} disabled={isSaving} className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors active:scale-95 disabled:opacity-50">
                    {isSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Save
                  </button>
                </div>
              </div>
            ) : (
              <button onClick={() => startFieldEdit("category", receipt.category || "")} className="w-full flex items-center gap-3 px-3.5 py-3 rounded-lg bg-secondary/50 hover:bg-secondary/70 transition-colors text-left group">
                <Tag className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                <div className="flex-1">
                  <p className="text-xs text-muted-foreground">Category</p>
                  <p className="text-sm font-medium">{receipt.category || "—"}</p>
                </div>
                <Pencil className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>
            )}

            {/* Purchase Date */}
            {editingField === "purchase_date" ? (
              <div className="px-3.5 py-3 rounded-lg bg-secondary/80 space-y-2 ring-1 ring-primary/20">
                <label className="text-xs text-muted-foreground">Purchase Date</label>
                <input type="date" value={editValue} onChange={(e) => setEditValue(e.target.value)} className="w-full bg-background/80 rounded-md px-2.5 py-1.5 text-sm border border-border focus:outline-none focus:ring-1 focus:ring-primary" autoFocus />
                <div className="flex justify-end gap-1.5">
                  <button onClick={() => setEditingField(null)} className="px-2.5 py-1 rounded-md text-xs text-muted-foreground hover:bg-secondary transition-colors active:scale-95">Cancel</button>
                  <button onClick={() => saveField("purchase_date", editValue)} disabled={isSaving} className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors active:scale-95 disabled:opacity-50">
                    {isSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Save
                  </button>
                </div>
              </div>
            ) : (
              <button onClick={() => startFieldEdit("purchase_date", receipt.purchase_date || "")} className="w-full flex items-center gap-3 px-3.5 py-3 rounded-lg bg-secondary/50 hover:bg-secondary/70 transition-colors text-left group">
                <Calendar className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                <div className="flex-1">
                  <p className="text-xs text-muted-foreground">Purchase Date</p>
                  <p className="text-sm font-medium">{purchaseDate}</p>
                </div>
                <Pencil className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>
            )}

            <div className="flex items-center gap-3 px-3.5 py-3 rounded-lg bg-secondary/50">
              <Clock className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground">Created</p>
                <p className="text-sm font-medium">
                  {receipt.created_at
                    ? new Date(receipt.created_at).toLocaleString("en-US", {
                        month: "short", day: "numeric", year: "numeric",
                        hour: "numeric", minute: "2-digit",
                      })
                    : "—"}
                </p>
              </div>
            </div>
          </div>

          <div className="pt-2">
            <div className="flex items-center justify-between mb-2 px-0.5">
              <div className="flex items-center gap-2">
                <ShoppingCart className="w-3.5 h-3.5 text-muted-foreground" />
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Items</p>
              </div>
              <button
                onClick={addItem}
                disabled={isSaving}
                className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-primary hover:bg-primary/10 transition-colors active:scale-95 disabled:opacity-50"
              >
                <Plus className="w-3.5 h-3.5" />
                Add
              </button>
            </div>
            <div className="space-y-1.5">
              {receipt.items && receipt.items.length > 0 ? (
                receipt.items.map((item, i) =>
                  editingItem?.index === i ? (
                    <div key={i} className="px-3.5 py-3 rounded-lg bg-secondary/80 space-y-2.5 ring-1 ring-primary/20">
                      <input
                        type="text"
                        value={editingItem.name}
                        onChange={(e) => setEditingItem({ ...editingItem, name: e.target.value })}
                        placeholder="Item name"
                        className="w-full bg-background/80 rounded-md px-2.5 py-1.5 text-sm border border-border focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                      <div className="flex gap-2">
                        <div className="flex-1">
                          <label className="text-[10px] text-muted-foreground mb-0.5 block">Qty</label>
                          <input
                            type="number"
                            value={editingItem.quantity}
                            onChange={(e) => setEditingItem({ ...editingItem, quantity: e.target.value })}
                            min="0"
                            step="1"
                            className="w-full bg-background/80 rounded-md px-2.5 py-1.5 text-sm tabular-nums border border-border focus:outline-none focus:ring-1 focus:ring-primary"
                          />
                        </div>
                        <div className="flex-1">
                          <label className="text-[10px] text-muted-foreground mb-0.5 block">Price</label>
                          <input
                            type="number"
                            value={editingItem.price}
                            onChange={(e) => setEditingItem({ ...editingItem, price: e.target.value })}
                            min="0"
                            step="0.01"
                            className="w-full bg-background/80 rounded-md px-2.5 py-1.5 text-sm tabular-nums border border-border focus:outline-none focus:ring-1 focus:ring-primary"
                          />
                        </div>
                      </div>
                      <div className="flex justify-end gap-1.5 pt-0.5">
                        <button
                          onClick={cancelEditing}
                          className="px-2.5 py-1 rounded-md text-xs text-muted-foreground hover:bg-secondary transition-colors active:scale-95"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={saveItem}
                          disabled={isSaving}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors active:scale-95 disabled:opacity-50"
                        >
                          {isSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                          Save
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div key={i} className="group flex items-center justify-between px-3.5 py-2.5 rounded-lg bg-secondary/50 hover:bg-secondary/70 transition-colors">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{item.name}</p>
                        <p className="text-xs text-muted-foreground">Qty: {item.quantity}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium tabular-nums">
                          ${item.price.toFixed(2)}
                        </span>
                        <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => startEditing(i)}
                            className="p-1 rounded hover:bg-background/60 transition-colors active:scale-95"
                          >
                            <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
                          </button>
                          <button
                            onClick={() => deleteItem(i)}
                            disabled={isSaving}
                            className="p-1 rounded hover:bg-destructive/10 transition-colors active:scale-95 disabled:opacity-50"
                          >
                            <Minus className="w-3.5 h-3.5 text-destructive" />
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                )
              ) : (
                <p className="text-xs text-muted-foreground px-1 py-2">No items yet</p>
              )}
            </div>
          </div>

          {receipt.extracted_fields && receipt.extracted_fields.length > 0 && (
            <div className="pt-2">
              <div className="flex items-center gap-2 mb-2 px-0.5">
                <List className="w-3.5 h-3.5 text-muted-foreground" />
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Extracted Fields</p>
              </div>
              <div className="space-y-1.5">
                {receipt.extracted_fields.map((field, i) => (
                  <div key={i} className="flex justify-between items-center px-3.5 py-2.5 rounded-lg bg-secondary/50">
                    <span className="text-xs text-muted-foreground">{field.label}</span>
                    <span className="text-sm font-medium tabular-nums">{field.value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {receipt.extracted_text && (
            <div className="pt-2">
              <div className="flex items-center gap-2 mb-2 px-0.5">
                <FileText className="w-3.5 h-3.5 text-muted-foreground" />
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Extracted Text</p>
              </div>
              <pre className="px-3.5 py-3 rounded-lg bg-secondary/50 text-xs text-muted-foreground whitespace-pre-wrap font-mono leading-relaxed max-h-48 overflow-y-auto">
                {receipt.extracted_text}
              </pre>
            </div>
          )}

          {receipt.errorMessage && (
            <p className="text-xs text-destructive px-1">{receipt.errorMessage}</p>
          )}
        </div>
      </div>
    </div>
  );
}
