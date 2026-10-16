import { useCallback, useSyncExternalStore } from "react";
import type { AppSettings } from "./taraTypes";

const STORAGE_KEY = "tara.settings.v1";
const ONBOARDING_KEY = "tara.onboarding.v1";

const defaultSettings: AppSettings = {
  defaultCaptureMode: "both",
  defaultMicrophoneDeviceId: null,
  language: "auto",
  quality: "best",
  externalAiEnabled: false,
  storagePath: "",
  audioPath: "",
  processingMode: "fully_local",
  providerId: "openai",
  providerModel: "gpt-4.1-mini",
  providerBaseUrl: "",
  hotwords: [],
};

let state: AppSettings = defaultSettings;
let hydrated = false;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function hydrate() {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const stored = JSON.parse(raw) as Partial<AppSettings> & { quality?: string };
      state = {
        ...defaultSettings,
        ...stored,
        quality: stored.quality === "fast" ? "fast" : "best",
        hotwords: Array.isArray(stored.hotwords) ? stored.hotwords : [],
        processingMode: "fully_local",
        externalAiEnabled: false,
      };
      emit();
    }
  } catch {
    /* ignore corrupt storage */
  }
}

function subscribe(listener: () => void) {
  hydrate();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function updateSettings(patch: Partial<AppSettings>) {
  state = { ...state, ...patch };
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* ignore quota errors */
    }
  }
  emit();
}

export function useSettings(): [AppSettings, (patch: Partial<AppSettings>) => void] {
  const settings = useSyncExternalStore(
    subscribe,
    () => state,
    () => defaultSettings,
  );
  const set = useCallback((patch: Partial<AppSettings>) => updateSettings(patch), []);
  return [settings, set];
}

export function hasSeenOnboarding(): boolean {
  if (typeof window === "undefined") return true;
  return window.localStorage.getItem(ONBOARDING_KEY) === "done";
}

export function markOnboardingSeen() {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ONBOARDING_KEY, "done");
}
