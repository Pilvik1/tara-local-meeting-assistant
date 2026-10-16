import { useSyncExternalStore } from "react";
import type {
  CaptureMode,
  MeetingNote,
  TranscriptionLanguage,
  TranscriptionQuality,
} from "./taraTypes";

export interface RecordingSession {
  title: string;
  templateId: string;
  captureMode: CaptureMode;
  microphoneDeviceId: string | null;
  microphoneLabel: string | null;
  language: TranscriptionLanguage;
  quality: TranscriptionQuality;
  hotwords: string[];
  startedAt: number;
  pausedMs: number;
  isPaused: boolean;
  notes: MeetingNote[];
}

let session: RecordingSession | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export function startSession(
  next: Omit<RecordingSession, "startedAt" | "pausedMs" | "isPaused" | "notes">,
) {
  session = { ...next, startedAt: Date.now(), pausedMs: 0, isPaused: false, notes: [] };
  emit();
}

export function patchSession(patch: Partial<RecordingSession>) {
  if (!session) return;
  session = { ...session, ...patch };
  emit();
}

export function addSessionNote(note: MeetingNote) {
  if (!session) return;
  session = { ...session, notes: [...session.notes, note] };
  emit();
}

export function endSession() {
  session = null;
  emit();
}

export function getSession(): RecordingSession | null {
  return session;
}

export function useRecordingSession(): RecordingSession | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => session,
    () => null,
  );
}
