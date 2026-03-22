import { CaptureButton } from "@/components/CaptureButton";
import { ReceiptGrid } from "@/components/ReceiptGrid";
import { useReceiptApi } from "@/hooks/useReceiptApi";
import { ScanLine } from "lucide-react";

const Index = () => {
  const { receipts, isUploading, uploadReceipt, removeReceipt, retryUpload } =
    useReceiptApi();

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-background/80 backdrop-blur-md border-b px-4 py-4">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-primary flex items-center justify-center">
            <ScanLine className="w-5 h-5 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-lg font-semibold leading-tight tracking-tight">
              Receipt Scanner
            </h1>
            <p className="text-xs text-muted-foreground">
              {receipts.length === 0
                ? "Capture & upload receipts"
                : `${receipts.length} receipt${receipts.length !== 1 ? "s" : ""}`}
            </p>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-2xl mx-auto px-4 py-6 pb-32 space-y-6">
        <div className="opacity-0 animate-fade-up">
          <ReceiptGrid
            receipts={receipts}
            onRemove={removeReceipt}
            onRetry={retryUpload}
          />
        </div>
      </main>

      {/* Sticky bottom capture bar */}
      <div className="fixed bottom-0 inset-x-0 bg-background/80 backdrop-blur-md border-t p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="max-w-2xl mx-auto">
          <CaptureButton onCapture={uploadReceipt} disabled={isUploading} />
        </div>
      </div>
    </div>
  );
};

export default Index;