import { useCallback, useEffect, useRef, useState } from "react";
import { X, Camera, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { convertReceiptImageFile } from "@/lib/ffmpegImageConverter";

interface AddReceiptFormProps {
  onSubmit: (file: File, onProgress?: (progress: number) => void) => Promise<void> | void;
  onClose: () => void;
  disabled?: boolean;
}

type CameraTrackCapabilities = MediaTrackCapabilities & {
  focusMode?: string[];
  pointsOfInterest?: unknown;
  torch?: boolean;
};

type CameraConstraintSet = MediaTrackConstraintSet & {
  focusMode?: string;
  pointsOfInterest?: unknown;
  torch?: boolean;
};

function mergeCameraConstraints(track: MediaStreamTrack, additional: CameraConstraintSet): MediaTrackConstraints {
  let existing: MediaTrackConstraints = {};
  try {
    existing = track.getConstraints?.() ?? {};
  } catch {
    // Browsers without readable track constraints can still apply the enhancement.
  }
  return {
    ...existing,
    advanced: [...(existing.advanced ?? []), additional],
  };
}

function applyCameraConstraints(track: MediaStreamTrack, additional: CameraConstraintSet) {
  return track.applyConstraints(mergeCameraConstraints(track, additional));
}

export function AddReceiptForm({ onSubmit, onClose, disabled }: AddReceiptFormProps) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [isQueueingUpload, setIsQueueingUpload] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraVideoRef = useRef<HTMLVideoElement>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const cameraTrackRef = useRef<MediaStreamTrack | null>(null);
  const cameraContinuousFocusRef = useRef(false);
  const cameraTapFocusSupportedRef = useRef(false);
  const cameraRequestRef = useRef(0);

  const stopCamera = useCallback(() => {
    cameraRequestRef.current += 1;
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    cameraStreamRef.current = null;
    cameraTrackRef.current = null;
    cameraContinuousFocusRef.current = false;
    cameraTapFocusSupportedRef.current = false;
    setCameraStream(null);
    if (cameraVideoRef.current) cameraVideoRef.current.srcObject = null;
  }, []);

  useEffect(() => stopCamera, [stopCamera]);

  useEffect(() => {
    if (!cameraStream || !cameraVideoRef.current) return;
    cameraVideoRef.current.srcObject = cameraStream;
    void cameraVideoRef.current.play().catch(() => {
      // Autoplay can be blocked until the user interacts with the preview.
    });
  }, [cameraStream]);

  const handleFile = (f: File) => {
    if (!f.type.startsWith("image/")) {
      setSubmitError("Only image files are allowed.");
      return;
    }
    setSubmitError(null);
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

  const fallbackToCaptureInput = () => {
    stopCamera();
    cameraRef.current?.click();
  };

  const openCamera = async () => {
    const requestId = cameraRequestRef.current + 1;
    cameraRequestRef.current = requestId;
    const getUserMedia = navigator.mediaDevices?.getUserMedia;
    if (!getUserMedia) {
      fallbackToCaptureInput();
      return;
    }

    let stream: MediaStream | null = null;
    try {
      stream = await getUserMedia.call(navigator.mediaDevices, {
        audio: false,
        video: {
          facingMode: { exact: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      });
      const track = stream.getVideoTracks()[0];
      const capabilities = track?.getCapabilities?.() as CameraTrackCapabilities | undefined;
      if (!track || !capabilities?.torch) throw new Error("Rear camera torch is unavailable");

      const supportsContinuousFocus = capabilities.focusMode?.includes("continuous") === true;
      const supportsTapFocus = capabilities.pointsOfInterest !== undefined;
      const torchConstraints: CameraConstraintSet = { torch: true };
      let continuousFocusApplied = false;
      if (supportsContinuousFocus) {
        try {
          await applyCameraConstraints(track, { torch: true, focusMode: "continuous" });
          continuousFocusApplied = true;
        } catch {
          // Some browsers report focus support but reject the combined constraint.
          // Keep the camera available by retrying the required torch constraint alone.
          await applyCameraConstraints(track, torchConstraints);
        }
      } else {
        await applyCameraConstraints(track, torchConstraints);
      }
      if (requestId !== cameraRequestRef.current) {
        stream.getTracks().forEach((activeTrack) => activeTrack.stop());
        return;
      }
      cameraTrackRef.current = track;
      cameraContinuousFocusRef.current = continuousFocusApplied;
      cameraTapFocusSupportedRef.current = supportsTapFocus;
      cameraStreamRef.current = stream;
      setCameraStream(stream);
    } catch {
      stream?.getTracks().forEach((track) => track.stop());
      if (requestId === cameraRequestRef.current) fallbackToCaptureInput();
    }
  };

  const handleCameraPreviewTap = (event: React.MouseEvent<HTMLVideoElement>) => {
    if (!cameraTapFocusSupportedRef.current) return;
    const track = cameraTrackRef.current;
    const rect = event.currentTarget.getBoundingClientRect();
    if (!track || rect.width <= 0 || rect.height <= 0) return;

    const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
    const focusPoint = {
      torch: true,
      ...(cameraContinuousFocusRef.current ? { focusMode: "continuous" } : {}),
      pointsOfInterest: [{ x, y }],
    };
    void applyCameraConstraints(track, focusPoint).catch(() => {
      // Tap-to-focus is an enhancement; unsupported or rejected points must not
      // interrupt the active camera preview or trigger the file-input fallback.
    });
  };

  const captureCameraFrame = () => {
    const video = cameraVideoRef.current;
    if (!video || video.videoWidth <= 0 || video.videoHeight <= 0) {
      fallbackToCaptureInput();
      return;
    }

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) {
      fallbackToCaptureInput();
      return;
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      stopCamera();
      if (!blob) {
        fallbackToCaptureInput();
        return;
      }
      handleFile(new File([blob], `receipt-camera-${Date.now()}.jpg`, { type: "image/jpeg" }));
    }, "image/jpeg", 0.92);
  };

  const handleClose = () => {
    stopCamera();
    onClose();
  };

  const handleSubmit = async () => {
    if (!file) return;
    if (isQueueingUpload) return;

    setIsQueueingUpload(true);
    setUploadProgress(2);
    setSubmitError(null);
    let conversionProgressTimer: number | null = null;
    try {
      conversionProgressTimer = window.setInterval(() => {
        setUploadProgress((prev) => {
          if (prev >= 14) return prev;
          return Math.min(14, prev + 1);
        });
      }, 220);

      const convertedFile = await convertReceiptImageFile(file);
      if (conversionProgressTimer) {
        window.clearInterval(conversionProgressTimer);
        conversionProgressTimer = null;
      }
      setUploadProgress((prev) => Math.max(prev, 15));
      if (convertedFile.type !== "image/webp") {
        throw new Error(`WebP conversion failed. Got type: ${convertedFile.type || "unknown"}`);
      }
      await onSubmit(convertedFile, (progress) => setUploadProgress(progress));
      onClose();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Upload failed";
      setSubmitError(message);
      console.error(error);
      setUploadProgress(0);
    } finally {
      if (conversionProgressTimer) window.clearInterval(conversionProgressTimer);
      setIsQueueingUpload(false);
    }
  };

  return (
    <div className={cameraStream ? "fixed inset-0 z-50 h-[100dvh] w-full overflow-hidden bg-black" : "fixed inset-0 z-50 flex flex-col bg-background animate-fade-in"}>
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleInputChange} />
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleInputChange} />

      {cameraStream ? (
        <div className="relative h-[100dvh] w-full overflow-hidden bg-black">
          <video
            ref={cameraVideoRef}
            autoPlay
            playsInline
            muted
            aria-label="Rear camera preview"
            onClick={handleCameraPreviewTap}
            className="absolute inset-0 h-full w-full bg-black object-cover"
          />
          <div className="absolute inset-x-0 top-0 flex items-start justify-between px-4 pt-[env(safe-area-inset-top)]">
            <button
              type="button"
              onClick={stopCamera}
              aria-label="Cancel camera"
              className="mt-3 rounded-full bg-black/55 p-3 text-white backdrop-blur-sm transition-colors hover:bg-black/70 active:scale-95"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="absolute inset-x-0 bottom-0 flex justify-center px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-16">
            <button
              type="button"
              onClick={captureCameraFrame}
              className="rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-lg transition-transform active:scale-95"
            >
              Capture photo
            </button>
          </div>
        </div>
      ) : (
        <>
          <header className="flex items-center justify-between px-4 py-3 border-b">
            <button onClick={handleClose} className="p-2 -ml-2 rounded-md hover:bg-secondary transition-colors active:scale-95">
              <X className="w-5 h-5" />
            </button>
            <h2 className="text-sm font-semibold">New Receipt</h2>
            <button
              onClick={handleSubmit}
              disabled={!file || disabled || isQueueingUpload}
              className={cn(
                "px-4 py-1.5 rounded-md text-sm font-medium transition-all active:scale-95",
                file ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground pointer-events-none"
              )}
            >
              Upload
            </button>
          </header>

          <div className="flex-1 overflow-y-auto p-4">
        {submitError && (
          <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {submitError}
          </div>
        )}

        {preview ? (
          <div className="space-y-3">
            <div className="relative aspect-[4/3] rounded-lg overflow-hidden bg-muted ring-1 ring-border">
              <img src={preview} alt="Receipt preview" className="w-full h-full object-cover" />
              <button
                onClick={() => { setFile(null); if (preview) URL.revokeObjectURL(preview); setPreview(null); setUploadProgress(0); }}
                disabled={isQueueingUpload}
                className="absolute top-2 right-2 p-1.5 rounded-md bg-card/90 backdrop-blur-sm hover:bg-card transition-colors active:scale-95 disabled:opacity-40"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {isQueueingUpload && (
              <div className="w-full h-2 rounded-full bg-secondary overflow-hidden ring-1 ring-border/60">
                <div
                  className="h-full bg-primary transition-[width] duration-200 ease-out"
                  style={{ width: `${Math.max(1, Math.min(100, uploadProgress))}%` }}
                />
              </div>
            )}
          </div>
        ) : (
          <div className="flex gap-3">
            <button
              onClick={() => void openCamera()}
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
        </>
      )}
    </div>
  );
}
