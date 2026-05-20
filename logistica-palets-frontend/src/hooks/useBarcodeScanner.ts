/**
 * useBarcodeScanner — dual-mode barcode input hook
 *
 * Mode 1 (USB/Bluetooth reader):
 *   Detects rapid keyboard input (>4 chars in <100ms) ending with Enter.
 *   Works anywhere on the page when `enabled: true`.
 *
 * Mode 2 (Camera):
 *   Uses the native BarcodeDetector API (Chrome 88+, Edge 88+).
 *   Opens getUserMedia() stream, scans frames with requestAnimationFrame.
 *   Returns null if BarcodeDetector is not available.
 *
 * Usage:
 * ```tsx
 * const { startCamera, stopCamera, cameraActive, cameraSupported } = useBarcodeScanner({
 *   enabled: true,
 *   onScan: (code) => console.log('scanned:', code),
 * });
 * ```
 */
import { useCallback, useEffect, useRef, useState } from "react";

interface UseBarcannnerOptions {
  /** Whether the USB/keyboard scanner listener is active. */
  enabled?: boolean;
  /** Called when a barcode is successfully scanned (USB or camera). */
  onScan: (code: string) => void;
  /**
   * Minimum barcode length to trigger onScan (filters accidental keystrokes).
   * Default: 3.
   */
  minLength?: number;
}

/* ── BarcodeDetector type (not in lib.dom.d.ts yet) ──────────────────────── */

interface BarcodeDetectorLike {
  detect(image: CanvasImageSource): Promise<Array<{ rawValue: string }>>;
}

declare global {
  interface Window {
    BarcodeDetector?: new (options?: { formats?: string[] }) => BarcodeDetectorLike;
  }
}

/* ── Hook ─────────────────────────────────────────────────────────────────── */

export function useBarcodeScanner({
  enabled = true,
  onScan,
  minLength = 3,
}: UseBarcannnerOptions) {
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraSupported] = useState(() => typeof window.BarcodeDetector !== "undefined");

  // ── USB / keyboard scanner ────────────────────────────────────────────────

  const bufferRef = useRef<string>("");
  const lastKeyRef = useRef<number>(0);
  const RAF_THRESHOLD_MS = 120; // scanners type faster than humans

  useEffect(() => {
    if (!enabled) return;

    const handler = (e: KeyboardEvent) => {
      const now = Date.now();
      const delta = now - lastKeyRef.current;
      lastKeyRef.current = now;

      if (e.key === "Enter") {
        const code = bufferRef.current.trim();
        bufferRef.current = "";
        if (code.length >= minLength) {
          onScan(code);
        }
        return;
      }

      // If the gap between keystrokes is too large, reset the buffer
      // (human typing is slower than a barcode reader)
      if (delta > RAF_THRESHOLD_MS) {
        bufferRef.current = "";
      }

      if (e.key.length === 1) {
        bufferRef.current += e.key;
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [enabled, minLength, onScan]);

  // ── Camera scanner ────────────────────────────────────────────────────────

  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const rafRef = useRef<number>(0);
  const detectorRef = useRef<BarcodeDetectorLike | null>(null);

  const stopCamera = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
  }, []);

  /**
   * Start camera scanning.
   * Returns a cleanup function; call stopCamera() to stop.
   * @param videoEl  The <video> element to stream into (can be hidden).
   */
  const startCamera = useCallback(
    async (videoEl: HTMLVideoElement) => {
      if (!cameraSupported) {
        console.warn("BarcodeDetector API not available in this browser.");
        return;
      }

      videoRef.current = videoEl;

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
        streamRef.current = stream;
        videoEl.srcObject = stream;
        await videoEl.play();
        setCameraActive(true);

        detectorRef.current = new window.BarcodeDetector!({
          formats: ["code_128", "code_39", "ean_13", "ean_8", "qr_code", "upc_a", "upc_e"],
        });

        const scan = async () => {
          if (!detectorRef.current || videoEl.readyState < 2) {
            rafRef.current = requestAnimationFrame(scan);
            return;
          }

          try {
            const results = await detectorRef.current.detect(videoEl);
            if (results.length > 0) {
              const code = results[0].rawValue.trim();
              if (code.length >= minLength) {
                onScan(code);
                stopCamera();
                return;
              }
            }
          } catch {
            /* detection frame errors are normal */
          }

          rafRef.current = requestAnimationFrame(scan);
        };

        rafRef.current = requestAnimationFrame(scan);
      } catch (err) {
        console.error("Camera access error:", err);
        stopCamera();
      }
    },
    [cameraSupported, minLength, onScan, stopCamera],
  );

  // Clean up on unmount
  useEffect(() => () => stopCamera(), [stopCamera]);

  return {
    /** Whether the camera scanner is currently active. */
    cameraActive,
    /** Whether BarcodeDetector API is available in this browser. */
    cameraSupported,
    /** Start camera scanning into the provided <video> element. */
    startCamera,
    /** Stop the camera scanner and release the stream. */
    stopCamera,
  };
}
