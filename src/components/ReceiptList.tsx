import { Receipt } from "@/hooks/useReceiptApi";
import { ReceiptCard } from "./ReceiptCard";
import { ReceiptText, Loader2 } from "lucide-react";

interface ReceiptListProps {
  receiptsByDate: Record<string, Receipt[]>;
  onReceiptClick: (receipt: Receipt) => void;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  onLoadMore?: () => void;
}

export function ReceiptList({ receiptsByDate, onReceiptClick, hasMore, isLoadingMore, onLoadMore }: ReceiptListProps) {
  const dateKeys = Object.keys(receiptsByDate);

  if (dateKeys.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 opacity-0 animate-fade-up">
        <div className="w-16 h-16 rounded-2xl bg-secondary flex items-center justify-center mb-4">
          <ReceiptText className="w-7 h-7 text-muted-foreground" />
        </div>
        <p className="text-muted-foreground font-medium mb-1">No receipts yet</p>
        <p className="text-sm text-muted-foreground/70">
          Take a photo or upload from your gallery
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {dateKeys.map((dateLabel) => {
        const group = receiptsByDate[dateLabel];
        const total = group.reduce((sum, r) => sum + r.total, 0);

        return (
          <section key={dateLabel}>
            <div className="flex items-baseline justify-between mb-2 px-1">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {dateLabel}
              </h2>
              <span className="text-xs font-medium text-muted-foreground tabular-nums">
                ${total.toFixed(2)}
              </span>
            </div>
            <div className="space-y-1.5">
              {group.map((receipt, i) => (
                <ReceiptCard
                  key={receipt.id}
                  receipt={receipt}
                  onClick={onReceiptClick}
                  index={i}
                />
              ))}
            </div>
          </section>
        );
      })}

      {hasMore && (
        <div className="flex justify-center pt-2 pb-4">
          <button
            onClick={onLoadMore}
            disabled={isLoadingMore}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-secondary hover:bg-secondary/80 text-sm font-medium text-foreground transition-colors active:scale-[0.98] disabled:opacity-50"
          >
            {isLoadingMore ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading…
              </>
            ) : (
              "Load more receipts"
            )}
          </button>
        </div>
      )}
    </div>
  );
}