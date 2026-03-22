import { Receipt } from "@/hooks/useReceiptApi";
import { ChevronRight, Tag } from "lucide-react";

interface ReceiptCardProps {
  receipt: Receipt;
  onClick: (receipt: Receipt) => void;
  index: number;
}

export function ReceiptCard({ receipt, onClick, index }: ReceiptCardProps) {
  const displayDate = receipt.purchase_date
    ? new Date(receipt.purchase_date).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "—";

  return (
    <button
      onClick={() => onClick(receipt)}
      className="w-full flex items-center gap-3.5 px-3.5 py-3 rounded-lg bg-card hover:bg-secondary/60 receipt-shadow hover:receipt-shadow-hover transition-all duration-300 text-left group opacity-0 animate-fade-up active:scale-[0.98]"
      style={{ animationDelay: `${index * 60}ms` }}
    >
      <div className="flex-1 min-w-0">
        <span className="text-sm font-medium truncate block">{receipt.vendor || "Unknown"}</span>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-xs text-muted-foreground">{displayDate}</span>
          {receipt.category && (
            <>
              <span className="text-xs text-muted-foreground/40">·</span>
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Tag className="w-3 h-3" />
                {receipt.category}
              </span>
            </>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1.5 flex-shrink-0">
        <span className="text-sm font-semibold tabular-nums">
          {receipt.currency === "USD" ? "$" : receipt.currency + " "}
          {receipt.total.toFixed(2)}
        </span>
        <ChevronRight className="w-4 h-4 text-muted-foreground/50 group-hover:text-muted-foreground transition-colors" />
      </div>
    </button>
  );
}
