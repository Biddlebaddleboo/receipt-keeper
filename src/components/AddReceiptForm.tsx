import { useState, useRef } from "react";
import { format } from "date-fns";
import { CalendarIcon, X, Camera, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

interface AddReceiptFormProps {
  onSubmit: (file: File, metadata: { storeName: string; amount: number; date: Date }) => void;
  onClose: () => void;
  disabled?: boolean;
}

export function AddReceiptForm({ onSubmit, onClose, disabled }: AddReceiptFormProps) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [storeName, setStoreName] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState<Date>(new Date());
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = (f: File) => {
    setFile(f);
    setPreview(URL.createObjectURL(f));
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
    e.target.value = "";
  };

  const canSubmit = file && storeName.trim() && amount && parseFloat(amount) > 0;

  const handleSubmit = () => {
    if (!canSubmit || !file) return;
    onSubmit(file, {
      storeName: storeName.trim(),
      amount: parseFloat(amount),
      date,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background animate-fade-in">
      <header className="flex items-center justify-between px-4 py-3 border-b">
        <button onClick={onClose} className="p-2 -ml-2 rounded-md hover:bg-secondary transition-colors active:scale-95">
          <X className="w-5 h-5" />
        </button>
        <h2 className="text-sm font-semibold">New Receipt</h2>
        <button
          onClick={handleSubmit}
          disabled={!canSubmit || disabled}
          className={cn(
            "px-4 py-1.5 rounded-md text-sm font-medium transition-all active:scale-95",
            canSubmit ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground pointer-events-none"
          )}
        >
          Save
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Image capture */}
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleInputChange} />
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleInputChange} />

        {preview ? (
          <div className="relative aspect-[4/3] rounded-lg overflow-hidden bg-muted ring-1 ring-border">
            <img src={preview} alt="Receipt preview" className="w-full h-full object-cover" />
            <button
              onClick={() => { setFile(null); if (preview) URL.revokeObjectURL(preview); setPreview(null); }}
              className="absolute top-2 right-2 p-1.5 rounded-md bg-card/90 backdrop-blur-sm hover:bg-card transition-colors active:scale-95"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div className="flex gap-3">
            <button
              onClick={() => cameraRef.current?.click()}
              className="flex-1 flex flex-col items-center gap-2 py-10 rounded-lg border-2 border-dashed border-border hover:border-primary/40 hover:bg-secondary/50 transition-colors active:scale-[0.98]"
            >
              <Camera className="w-6 h-6 text-muted-foreground" />
              <span className="text-sm text-muted-foreground font-medium">Camera</span>
            </button>
            <button
              onClick={() => fileRef.current?.click()}
              className="flex-1 flex flex-col items-center gap-2 py-10 rounded-lg border-2 border-dashed border-border hover:border-primary/40 hover:bg-secondary/50 transition-colors active:scale-[0.98]"
            >
              <Upload className="w-6 h-6 text-muted-foreground" />
              <span className="text-sm text-muted-foreground font-medium">Gallery</span>
            </button>
          </div>
        )}

        {/* Store name */}
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1.5 px-0.5">Store name</label>
          <input
            type="text"
            value={storeName}
            onChange={(e) => setStoreName(e.target.value)}
            placeholder="e.g. Trader Joe's"
            className="w-full px-3.5 py-2.5 rounded-lg border bg-card text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring transition-shadow"
          />
        </div>

        {/* Amount */}
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1.5 px-0.5">Amount</label>
          <div className="relative">
            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
            <input
              type="number"
              step="0.01"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="w-full pl-7 pr-3.5 py-2.5 rounded-lg border bg-card text-sm tabular-nums placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring transition-shadow"
            />
          </div>
        </div>

        {/* Date */}
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1.5 px-0.5">Date</label>
          <Popover>
            <PopoverTrigger asChild>
              <button className="w-full flex items-center gap-2 px-3.5 py-2.5 rounded-lg border bg-card text-sm text-left hover:bg-secondary/50 transition-colors">
                <CalendarIcon className="w-4 h-4 text-muted-foreground" />
                {format(date, "PPP")}
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={date}
                onSelect={(d) => d && setDate(d)}
                initialFocus
                className="p-3 pointer-events-auto"
              />
            </PopoverContent>
          </Popover>
        </div>
      </div>
    </div>
  );
}