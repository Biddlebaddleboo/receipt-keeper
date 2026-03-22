import { Receipt } from "@/hooks/useReceiptApi";
import { CheckCircle2, AlertCircle, Loader2, Trash2, RotateCcw } from "lucide-react";

interface ReceiptCardProps {
  receipt: Receipt;
  onRemove: (id: string) => void;
  onRetry: (id: string) => void;
  index: number;
}

export function ReceiptCard({ receipt, onRemove, onRetry, index }: ReceiptCardProps) {
  const statusConfig = {
    pending: { icon: null, label: "Pending", color: "text-muted-foreground" },
    uploading: {
      icon: <Loader2 className="w-4 h-4 animate-spin" />,
      label: "Uploading…",
      color: "text-primary",
    },
    success: {
      icon: <CheckCircle2 className="w-4 h-4" />,
      label: "Uploaded",
      color: "text-success",
    },
    error: {
      icon: <AlertCircle className="w-4 h-4" />,
      label: receipt.errorMessage || "Failed",
      color: "text-destructive",
    },
  };

  const status = statusConfig[receipt.status];

  return (
    <div
      className="group bg-card rounded-lg overflow-hidden receipt-shadow hover:receipt-shadow-hover transition-shadow duration-300 opacity-0 animate-scale-in"
      style={{ animationDelay: `${index * 80}ms` }}
    >
      <div className="relative aspect-[3/4] overflow-hidden bg-muted">
        <img
          src={receipt.imageUrl}
          alt="Receipt"
          className="w-full h-full object-cover"
          loading="lazy"
        />
        <div className="absolute inset-0 bg-foreground/0 group-hover:bg-foreground/5 transition-colors duration-200" />

        {/* Actions overlay */}
        <div className="absolute top-2 right-2 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
          {receipt.status === "error" && (
            <button
              onClick={() => onRetry(receipt.id)}
              className="p-2 rounded-md bg-card/90 backdrop-blur-sm text-foreground hover:bg-card transition-colors active:scale-95"
              title="Retry upload"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={() => onRemove(receipt.id)}
            className="p-2 rounded-md bg-card/90 backdrop-blur-sm text-destructive hover:bg-card transition-colors active:scale-95"
            title="Remove"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="px-3 py-2.5 flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {receipt.uploadedAt.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })}
        </span>
        <span className={`flex items-center gap-1 text-xs font-medium ${status.color}`}>
          {status.icon}
          {status.label}
        </span>
      </div>
    </div>
  );
}