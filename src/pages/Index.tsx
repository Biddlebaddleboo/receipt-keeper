import { useState } from "react";
import { ReceiptList } from "@/components/ReceiptList";
import { ReceiptDetail } from "@/components/ReceiptDetail";
import { AddReceiptForm } from "@/components/AddReceiptForm";
import { useReceiptApi, Receipt } from "@/hooks/useReceiptApi";
import { ScanLine, Plus } from "lucide-react";

const Index = () => {
  const { receipts, receiptsByDate, isUploading, uploadReceipt, removeReceipt, retryUpload, fetchReceipt } =
    useReceiptApi();
  const [selectedReceipt, setSelectedReceipt] = useState<Receipt | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);

  const totalSpent = receipts.reduce((sum, r) => sum + r.total, 0);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-background/80 backdrop-blur-md border-b px-4 py-4">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-primary flex items-center justify-center">
            <ScanLine className="w-5 h-5 text-primary-foreground" />
          </div>
          <div className="flex-1">
            <h1 className="text-lg font-semibold leading-tight tracking-tight">
              Receipt Scanner
            </h1>
            <p className="text-xs text-muted-foreground">
              {receipts.length === 0
                ? "Capture & upload receipts"
                : `${receipts.length} receipt${receipts.length !== 1 ? "s" : ""} · $${totalSpent.toFixed(2)} total`}
            </p>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-2xl mx-auto px-4 py-6 pb-28">
        <ReceiptList
          receiptsByDate={receiptsByDate}
          onReceiptClick={setSelectedReceipt}
        />
      </main>

      {/* FAB */}
      <button
        onClick={() => setShowAddForm(true)}
        className="fixed bottom-6 right-6 w-14 h-14 rounded-full bg-primary text-primary-foreground flex items-center justify-center receipt-shadow hover:brightness-110 transition-all active:scale-95 z-10"
      >
        <Plus className="w-6 h-6" />
      </button>

      {/* Detail overlay */}
      {selectedReceipt && (
        <ReceiptDetail
          receipt={selectedReceipt}
          onClose={() => setSelectedReceipt(null)}
          onRemove={removeReceipt}
          onRetry={retryUpload}
          fetchReceipt={fetchReceipt}
        />
      )}

      {/* Add form overlay */}
      {showAddForm && (
        <AddReceiptForm
          onSubmit={uploadReceipt}
          onClose={() => setShowAddForm(false)}
          disabled={isUploading}
        />
      )}
    </div>
  );
};

export default Index;