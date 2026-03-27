import { useState, useRef } from "react";
import { X, Camera, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { convertReceiptImageFile } from "@/lib/ffmpegImageConverter";

interface AddReceiptFormProps {
  onSubmit: (file: File) => void;
  onClose: () => void;
  disabled?: boolean;
}

export function AddReceiptForm({ onSubmit, onClose, disabled }: AddReceiptFormProps) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [isQueueingUpload, setIsQueueingUpload] = useState(false);
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = (f: File) => {
    setFile(f);
    setPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(f);
    });
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
    e.target.value = "";
  };

  const handleSubmit = async () => {
    if (!file) return;
    if (isQueueingUpload) return;

    setIsQueueingUpload(true);
    try {
      const convertedFile = await convertReceiptImageFile(file);
      onSubmit(convertedFile);
      onClose();
    } catch (error) {
      console.error(error);
    } finally {
      setIsQueueingUpload(false);
    }
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
          disabled={!file || disabled}
          className={cn(
            "px-4 py-1.5 rounded-md text-sm font-medium transition-all active:scale-95",
            file ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground pointer-events-none"
          )}
        >
          Upload
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-4">
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
      </div>
    </div>
  );
}
