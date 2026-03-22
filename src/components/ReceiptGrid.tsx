import { Receipt } from "@/hooks/useReceiptApi";
import { ReceiptCard } from "./ReceiptCard";
import { ReceiptText } from "lucide-react";

interface ReceiptGridProps {
  receipts: Receipt[];
  onRemove: (id: string) => void;
  onRetry: (id: string) => void;
}

export function ReceiptGrid({ receipts, onRemove, onRetry }: ReceiptGridProps) {
  if (receipts.length === 0) {
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
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      {receipts.map((receipt, i) => (
        <ReceiptCard
          key={receipt.id}
          receipt={receipt}
          onRemove={onRemove}
          onRetry={onRetry}
          index={i}
        />
      ))}
    </div>
  );
}