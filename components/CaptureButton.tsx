import { useRef } from "react";
import { Camera, Upload } from "lucide-react";

interface CaptureButtonProps {
  onCapture: (file: File) => void;
  disabled?: boolean;
}

export function CaptureButton({ onCapture, disabled }: CaptureButtonProps) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onCapture(file);
      e.target.value = "";
    }
  };

  return (
    <div className="flex gap-3">
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleFile}
      />
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFile}
      />

      <button
        onClick={() => cameraRef.current?.click()}
        disabled={disabled}
        className="flex-1 flex items-center justify-center gap-3 px-6 py-4 bg-primary text-primary-foreground rounded-lg font-medium text-base transition-all duration-200 ease-out hover:brightness-110 active:scale-[0.97] disabled:opacity-50 disabled:pointer-events-none receipt-shadow"
      >
        <Camera className="w-5 h-5" />
        Take Photo
      </button>

      <button
        onClick={() => fileRef.current?.click()}
        disabled={disabled}
        className="flex items-center justify-center gap-2 px-5 py-4 bg-secondary text-secondary-foreground rounded-lg font-medium text-base transition-all duration-200 ease-out hover:bg-muted active:scale-[0.97] disabled:opacity-50 disabled:pointer-events-none"
      >
        <Upload className="w-5 h-5" />
        Gallery
      </button>
    </div>
  );
}