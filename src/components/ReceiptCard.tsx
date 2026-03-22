import { Receipt } from "@/hooks/useReceiptApi";
import { CheckCircle2, AlertCircle, Loader2, Store, ChevronRight } from "lucide-react";

interface ReceiptCardProps {
  receipt: Receipt;
  onClick: (receipt: Receipt) => void;
  index: number;
}

const statusIcon = {
  pending: null,
  uploading: <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />,
  success: <CheckCircle2 className="w-3.5 h-3.5 text-success" />,
  error: <AlertCircle className="w-3.5 h-3.5 text-destructive" />,
};

export function ReceiptCard({ receipt, onClick, index }: ReceiptCardProps) {
  return (
    <button
      onClick={() => onClick(receipt)}
      className="w-full flex items-center gap-3.5 px-3.5 py-3 rounded-lg bg-card hover:bg-secondary/60 receipt-shadow hover:receipt-shadow-hover transition-all duration-300 text-left group opacity-0 animate-fade-up active:scale-[0.98]"
      style={{ animationDelay: `${index * 60}ms` }}
    >
      {/* Thumbnail */}
      <div className="w-12 h-12 rounded-md overflow-hidden bg-muted flex-shrink-0 ring-1 ring-border">
        <img
          src={receipt.imageUrl}
          alt="Receipt"
          className="w-full h-full object-cover"
          loading="lazy"
        />
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-0.5">
          <Store className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
          <span className="text-sm font-medium truncate">{receipt.storeName}</span>
          {statusIcon[receipt.status]}
        </div>
        <p className="text-xs text-muted-foreground">
          {receipt.date.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
        </p>
      </div>

      {/* Amount */}
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <span className="text-sm font-semibold tabular-nums">
          ${receipt.amount.toFixed(2)}
        </span>
        <ChevronRight className="w-4 h-4 text-muted-foreground/50 group-hover:text-muted-foreground transition-colors" />
      </div>
    </button>
  );
}