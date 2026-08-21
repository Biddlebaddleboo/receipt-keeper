import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

export type CameraTrackCapabilities = MediaTrackCapabilities & {
  focusMode?: string[];
  pointsOfInterest?: unknown;
  torch?: boolean;
};

type CameraConstraintSet = MediaTrackConstraintSet & {
  focusMode?: string;
  pointsOfInterest?: unknown;
  torch?: boolean;
};

const BASE_CAMERA_CONSTRAINTS: MediaTrackConstraints = {
  facingMode: { exact: "environment" },
  width: { ideal: 1920 },
  height: { ideal: 1080 },
};

function buildCameraConstraints(additional: CameraConstraintSet): MediaTrackConstraints {
  return {
    ...BASE_CAMERA_CONSTRAINTS,
    advanced: [additional],
  };
}

function applyCameraConstraints(track: MediaStreamTrack, additional: CameraConstraintSet) {
  return track.applyConstraints(buildCameraConstraints(additional));
}

export interface BrowserCameraProps {
  open: boolean;
  onCapture: (file: File) => void;
  onClose: () => void;
}

/**
 * Shared rear-camera preview. Consumers receive a captured JPEG File and own
 * all subsequent image processing/upload behavior.
 */
export function BrowserCamera({ open, onCapture, onClose }: BrowserCameraProps) {
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const cameraVideoRef = useRef<HTMLVideoElement>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const cameraTrackRef = useRef<MediaStreamTrack | null>(null);
  const cameraContinuousFocusRef = useRef(false);
  const cameraTapFocusSupportedRef = useRef(false);
  const cameraRequestRef = useRef(0);
  const onCaptureRef = useRef(onCapture);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCaptureRef.current = onCapture;
    onCloseRef.current = onClose;
  }, [onCapture, onClose]);

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

  const closeCamera = useCallback(() => {
    stopCamera();
    onCloseRef.current();
  }, [stopCamera]);

  useEffect(() => stopCamera, [stopCamera]);

  useEffect(() => {
    if (!cameraStream || !cameraVideoRef.current) return;
    cameraVideoRef.current.srcObject = cameraStream;
    void cameraVideoRef.current.play().catch(() => {
      // Autoplay can be blocked until the user interacts with the preview.
    });
  }, [cameraStream]);

  const fallbackToCaptureInput = useCallback(() => {
    stopCamera();
    cameraInputRef.current?.click();
    onCloseRef.current();
  }, [stopCamera]);

  const openCamera = useCallback(async () => {
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
        video: BASE_CAMERA_CONSTRAINTS,
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
  }, [fallbackToCaptureInput]);

  useEffect(() => {
    if (open) {
      void openCamera();
    } else {
      stopCamera();
    }
  }, [open, openCamera, stopCamera]);

  const handleCameraPreviewTap = (event: React.MouseEvent<HTMLVideoElement>) => {
    if (!cameraTapFocusSupportedRef.current) return;
    const track = cameraTrackRef.current;
    const rect = event.currentTarget.getBoundingClientRect();
    if (!track || rect.width <= 0 || rect.height <= 0) return;

    const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
    const focusPoint: CameraConstraintSet = {
      torch: true,
      ...(cameraContinuousFocusRef.current ? { focusMode: "continuous" } : {}),
      pointsOfInterest: [{ x, y }],
    };
    void applyCameraConstraints(track, focusPoint).catch(() => {
      // Tap-to-focus is an enhancement; rejected points must not interrupt the preview.
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
      onCaptureRef.current(new File([blob], `receipt-camera-${Date.now()}.jpg`, { type: "image/jpeg" }));
      onCloseRef.current();
    }, "image/jpeg", 0.92);
  };

  const handleFallbackInput = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) onCaptureRef.current(file);
    onCloseRef.current();
  };

  return (
    <>
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleFallbackInput}
      />
      {open && cameraStream && (
        <div className="fixed inset-0 z-[100] h-[100dvh] w-full overflow-hidden bg-black">
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
                onClick={closeCamera}
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
        </div>
      )}
    </>
  );
}
