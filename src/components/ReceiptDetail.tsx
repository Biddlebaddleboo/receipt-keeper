import { Receipt } from "@/hooks/useReceiptApi";
import { X, Trash2, RotateCcw, Store, Calendar, DollarSign, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";

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