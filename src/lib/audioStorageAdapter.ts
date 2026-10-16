/**
 * Saved audio is isolated here.
 *
 * INTEGRATION REQUIRED: `window.tara` is provided by the Electron preload
 * script in Tara. This frontend only declares the expected contract and
 * calls it — it never implements the bridge.
 */
import { API_BASE, USE_MOCK_API } from "./taraApi";

export interface SaveAudioInput {
  title: string;
  source?: string;
  buffer: ArrayBuffer;
  mimeType: string;
}

/** The complete contract this frontend expects from the Electron preload. */
export interface TaraBridge {
  platform: string;
  saveAudio(input: SaveAudioInput): Promise<{ path: string }>;
}

declare global {
  interface Window {
    tara?: TaraBridge;
  }
}

export interface SaveAudioResult {
  filePath: string;
  bytes: number;
}

export function hasElectronBridge(): boolean {
  return typeof window !== "undefined" && typeof window.tara?.saveAudio === "function";
}

export function getPlatform(): string | null {
  if (typeof window === "undefined") return null;
  return window.tara?.platform ?? null;
}

export class AudioStorageUnavailableError extends Error {
  constructor() {
    super(
      "Saving audio is not connected in this build. window.tara.saveAudio must be provided by the Electron preload script.",
    );
    this.name = "AudioStorageUnavailableError";
  }
}

/**
 * Persist a finished recording.
 * - Electron: `window.tara.saveAudio` (audio never leaves the machine).
 * - Demo mode: returns a fake path; no file is written.
 * - Browser fallback: multipart upload to Tara's local-only /audio endpoint.
 */
export async function saveAudio(
  title: string,
  blob: Blob,
  source?: string,
): Promise<SaveAudioResult> {
  if (USE_MOCK_API) {
    return {
      filePath: `C:\\Tara\\audio\\${title || "recording"}.wav (demo, not written)`,
      bytes: blob.size,
    };
  }

  if (hasElectronBridge()) {
    const buffer = await blob.arrayBuffer();
    const result = await window.tara!.saveAudio({
      title,
      ...(source ? { source } : {}),
      buffer,
      mimeType: blob.type || "audio/webm",
    });
    return { filePath: result.path, bytes: blob.size };
  }

  if (typeof fetch !== "function") throw new AudioStorageUnavailableError();
  const form = new FormData();
  form.append("file", blob, `${title || "recording"}-${source ?? "mixed"}.webm`);
  const response = await fetch(`${API_BASE}/audio`, { method: "POST", body: form });
  if (!response.ok) {
    let message = `Saving audio failed (${response.status})`;
    try {
      const payload = (await response.json()) as { detail?: string };
      if (payload.detail) message = payload.detail;
    } catch {
      // Keep the status-based message.
    }
    throw new Error(message);
  }
  const result = (await response.json()) as { path: string; size: number };
  return { filePath: result.path, bytes: result.size };
}
