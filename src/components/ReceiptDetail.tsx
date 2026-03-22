import { Receipt } from "@/hooks/useReceiptApi";
import { X, Trash2, RotateCcw, Store, Calendar, DollarSign, CheckCircle2, AlertCircle, Loader2, FileText, Clock, List } from "lucide-react";

interface ReceiptDetailProps {
  receipt: Receipt;
  onClose: () => void;
  onRemove: (id: string) => void;
  onRetry: (id: string) => void;
}

const statusConfig = {
  pending: { label: "Pending", color: "bg-muted text-muted-foreground", icon: null },
  uploading: { label: "Uploading…", color: "bg-primary/10 text-primary", icon: <Loader2 className="w-3.5 h-3.5 animate-spin" /> },
  success: { label: "Uploaded", color: "bg-success/10 text-success", icon: <CheckCircle2 className="w-3.5 h-3.5" /> },
  error: { label: "Failed", color: "bg-destructive/10 text-destructive", icon: <AlertCircle className="w-3.5 h-3.5" /> },
};

export function ReceiptDetail({ receipt, onClose, onRemove, onRetry }: ReceiptDetailProps) {
  const status = statusConfig[receipt.status];
  const imageUrl = receipt.image_url || receipt.localImageUrl;
  const purchaseDate = receipt.purchase_date
    ? new Date(receipt.purchase_date).toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : "—";

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background animate-fade-in">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 border-b">
        <button
          onClick={onClose}
          className="p-2 -ml-2 rounded-md hover:bg-secondary transition-colors active:scale-95"
        >
          <X className="w-5 h-5" />
        </button>
        <h2 className="text-sm font-semibold">Receipt Details</h2>
        <div className="flex gap-1">
          {receipt.status === "error" && (
            <button
              onClick={() => onRetry(receipt.id)}
              className="p-2 rounded-md hover:bg-secondary transition-colors active:scale-95"
            >
              <RotateCcw className="w-5 h-5" />
            </button>
          )}
          <button
            onClick={() => { onRemove(receipt.id); onClose(); }}
            className="p-2 rounded-md hover:bg-destructive/10 text-destructive transition-colors active:scale-95"
          >
            <Trash2 className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {/* Image */}
        {imageUrl && (
          <div className="aspect-[3/4] max-h-[50vh] bg-muted overflow-hidden">
            <img
              src={imageUrl}
              alt="Receipt"
              className="w-full h-full object-contain"
            />
          </div>
        )}

        {/* Metadata */}
        <div className="p-4 space-y-3">
          <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${status.color}`}>
            {status.icon}
            {status.label}
          </div>

          <div className="space-y-2.5 pt-1">
            <div className="flex items-center gap-3 px-3.5 py-3 rounded-lg bg-secondary/50">
              <Store className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground">Vendor</p>
                <p className="text-sm font-medium">{receipt.vendor || "—"}</p>
              </div>
            </div>

            <div className="flex items-center gap-3 px-3.5 py-3 rounded-lg bg-secondary/50">
              <DollarSign className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground">Total</p>
                <p className="text-sm font-medium tabular-nums">
                  {receipt.currency === "USD" ? "$" : receipt.currency + " "}
                  {receipt.total.toFixed(2)}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3 px-3.5 py-3 rounded-lg bg-secondary/50">
              <Calendar className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground">Purchase Date</p>
                <p className="text-sm font-medium">{purchaseDate}</p>
              </div>
            </div>

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

          {/* Extracted Fields */}
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

          {/* Extracted Text */}
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
const statusConfig = {
  pending: { label: "Pending", color: "bg-muted text-muted-foreground", icon: null },
  uploading: { label: "Uploading…", color: "bg-primary/10 text-primary", icon: <Loader2 className="w-3.5 h-3.5 animate-spin" /> },
  success: { label: "Uploaded", color: "bg-success/10 text-success", icon: <CheckCircle2 className="w-3.5 h-3.5" /> },
  error: { label: "Failed", color: "bg-destructive/10 text-destructive", icon: <AlertCircle className="w-3.5 h-3.5" /> },
};

export function ReceiptDetail({ receipt, onClose, onRemove, onRetry }: ReceiptDetailProps) {
  const status = statusConfig[receipt.status];

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background animate-fade-in">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 border-b">
        <button
          onClick={onClose}
          className="p-2 -ml-2 rounded-md hover:bg-secondary transition-colors active:scale-95"
        >
          <X className="w-5 h-5" />
        </button>
        <h2 className="text-sm font-semibold">Receipt Details</h2>
        <div className="flex gap-1">
          {receipt.status === "error" && (
            <button
              onClick={() => onRetry(receipt.id)}
              className="p-2 rounded-md hover:bg-secondary transition-colors active:scale-95"
            >
              <RotateCcw className="w-5 h-5" />
            </button>
          )}
          <button
            onClick={() => { onRemove(receipt.id); onClose(); }}
            className="p-2 rounded-md hover:bg-destructive/10 text-destructive transition-colors active:scale-95"
          >
            <Trash2 className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {/* Image */}
        <div className="aspect-[3/4] max-h-[50vh] bg-muted overflow-hidden">
          <img
            src={receipt.imageUrl}
            alt="Receipt"
            className="w-full h-full object-contain"
          />
        </div>

        {/* Metadata */}
        <div className="p-4 space-y-3">
          <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${status.color}`}>
            {status.icon}
            {status.label}
          </div>

          <div className="space-y-2.5 pt-1">
            <div className="flex items-center gap-3 px-3.5 py-3 rounded-lg bg-secondary/50">
              <Store className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground">Store</p>
                <p className="text-sm font-medium">{receipt.storeName}</p>
              </div>
            </div>

            <div className="flex items-center gap-3 px-3.5 py-3 rounded-lg bg-secondary/50">
              <DollarSign className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground">Amount</p>
                <p className="text-sm font-medium tabular-nums">${receipt.amount.toFixed(2)}</p>
              </div>
            </div>

            <div className="flex items-center gap-3 px-3.5 py-3 rounded-lg bg-secondary/50">
              <Calendar className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground">Date</p>
                <p className="text-sm font-medium">
                  {receipt.date.toLocaleDateString("en-US", {
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                    year: "numeric",
                  })}
                </p>
              </div>
            </div>
          </div>

          {receipt.errorMessage && (
            <p className="text-xs text-destructive px-1">{receipt.errorMessage}</p>
          )}
        </div>
      </div>
    </div>
  );
}