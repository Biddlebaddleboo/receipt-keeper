import { useEffect, useRef } from "react";
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
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!hasMore || !onLoadMore) return;
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !isLoadingMore) {
          onLoadMore();
        }
      },
      { rootMargin: "200px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, isLoadingMore, onLoadMore]);

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

      <div ref={sentinelRef} className="flex justify-center py-4">
        {isLoadingMore && (
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        )}
      </div>
    </div>
  );
}