import {
  createAudioCaptureSession,
  listAudioInputs,
  type AudioCaptureSession,
} from "../audioCapture";
import { USE_MOCK_API } from "./taraApi";
import type { CaptureMode, RecordingSource } from "./taraTypes";

export interface AudioInputDevice {
  deviceId: string;
  label: string;
}

export interface CaptureLevels {
  microphone: number;
  system: number;
}

export interface StartCaptureOptions {
  mode: CaptureMode;
  microphoneDeviceId: string | null;
}

export interface CaptureResult {
  blobs: Partial<Record<RecordingSource, Blob>>;
  durationSeconds: number;
}

export interface AudioCaptureAdapter {
  listMicrophones(): Promise<AudioInputDevice[]>;
  isSystemAudioReady(): Promise<boolean>;
  startMonitoring(
    options: StartCaptureOptions,
    onLevels: (levels: CaptureLevels) => void,
  ): Promise<void>;
  stopMonitoring(): Promise<void>;
  startRecording(options: StartCaptureOptions): Promise<void>;
  pauseRecording(): Promise<void>;
  resumeRecording(): Promise<void>;
  stopRecording(): Promise<CaptureResult>;
  cancel(): Promise<void>;
}

type RecorderState = {
  recorder: MediaRecorder;
  chunks: Blob[];
  mimeType: string;
};

class BrowserAudioCaptureAdapter implements AudioCaptureAdapter {
  private capture: AudioCaptureSession | null = null;
  private optionsKey = "";
  private monitorTimer: number | null = null;
  private recorders: Partial<Record<RecordingSource, RecorderState>> = {};
  private startedAt = 0;
  private pausedAt = 0;
  private pausedMs = 0;

  async listMicrophones(): Promise<AudioInputDevice[]> {
    return listAudioInputs();
  }

  async isSystemAudioReady(): Promise<boolean> {
    return Boolean(navigator.mediaDevices?.getDisplayMedia);
  }

  private key(options: StartCaptureOptions) {
    return `${options.mode}:${options.microphoneDeviceId ?? ""}`;
  }

  private async ensureCapture(options: StartCaptureOptions) {
    const key = this.key(options);
    if (this.capture && this.optionsKey === key) return this.capture;
    if (Object.keys(this.recorders).length) {
      throw new Error("Cannot change audio sources while a recording is active.");
    }
    await this.closeCapture();
    this.capture = await createAudioCaptureSession(options.mode, options.microphoneDeviceId ?? "");
    this.optionsKey = key;
    return this.capture;
  }

  async startMonitoring(
    options: StartCaptureOptions,
    onLevels: (levels: CaptureLevels) => void,
  ): Promise<void> {
    const capture = await this.ensureCapture(options);
    if (this.monitorTimer !== null) window.clearInterval(this.monitorTimer);
    const publish = () => {
      const levels = capture.getLevels();
      onLevels({ microphone: levels.microphone, system: levels.system });
    };
    publish();
    this.monitorTimer = window.setInterval(publish, 90);
  }

  async stopMonitoring(): Promise<void> {
    if (this.monitorTimer !== null) window.clearInterval(this.monitorTimer);
    this.monitorTimer = null;
    if (!Object.keys(this.recorders).length) await this.closeCapture();
  }

  async startRecording(options: StartCaptureOptions): Promise<void> {
    if (Object.keys(this.recorders).length) throw new Error("A recording is already active.");
    const capture = await this.ensureCapture(options);
    const sources: RecordingSource[] =
      options.mode === "both"
        ? ["microphone", "system", "mixed"]
        : options.mode === "microphone"
          ? ["microphone"]
          : ["system"];
    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : "audio/webm";
    try {
      for (const source of sources) {
        const stream = capture.sourceStreams[source];
        if (!stream?.getAudioTracks().length) throw new Error(`${source} audio is unavailable.`);
        const chunks: Blob[] = [];
        const recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 128_000 });
        recorder.addEventListener("dataavailable", (event) => {
          if (event.data.size) chunks.push(event.data);
        });
        recorder.start(1_000);
        this.recorders[source] = { recorder, chunks, mimeType };
      }
    } catch (error) {
      await this.cancel();
      throw error;
    }
    this.startedAt = Date.now();
    this.pausedAt = 0;
    this.pausedMs = 0;
  }

  async pauseRecording(): Promise<void> {
    Object.values(this.recorders).forEach((state) => {
      if (state.recorder.state === "recording") state.recorder.pause();
    });
    this.pausedAt = Date.now();
  }

  async resumeRecording(): Promise<void> {
    Object.values(this.recorders).forEach((state) => {
      if (state.recorder.state === "paused") state.recorder.resume();
    });
    if (this.pausedAt) this.pausedMs += Date.now() - this.pausedAt;
    this.pausedAt = 0;
  }

  async stopRecording(): Promise<CaptureResult> {
    const entries = Object.entries(this.recorders) as Array<[RecordingSource, RecorderState]>;
    if (!entries.length) throw new Error("No recording is active.");
    const blobs: Partial<Record<RecordingSource, Blob>> = {};
    const now = Date.now();
    const paused = this.pausedMs + (this.pausedAt ? now - this.pausedAt : 0);
    const durationSeconds = Math.max(0, Math.round((now - this.startedAt - paused) / 1_000));
    try {
      await Promise.all(
        entries.map(
          ([source, state]) =>
            new Promise<void>((resolve, reject) => {
              state.recorder.addEventListener(
                "stop",
                () => {
                  const blob = new Blob(state.chunks, { type: state.mimeType });
                  if (blob.size) blobs[source] = blob;
                  resolve();
                },
                { once: true },
              );
              state.recorder.addEventListener(
                "error",
                () => reject(new Error(`${source} recorder failed.`)),
                { once: true },
              );
              if (state.recorder.state === "inactive") resolve();
              else state.recorder.stop();
            }),
        ),
      );
    } finally {
      this.recorders = {};
      await this.closeCapture();
    }
    return { blobs, durationSeconds };
  }

  async cancel(): Promise<void> {
    Object.values(this.recorders).forEach((state) => {
      if (state.recorder.state !== "inactive") state.recorder.stop();
    });
    this.recorders = {};
    await this.closeCapture();
  }

  private async closeCapture() {
    if (this.monitorTimer !== null) window.clearInterval(this.monitorTimer);
    this.monitorTimer = null;
    this.capture?.close();
    this.capture = null;
    this.optionsKey = "";
  }
}

class MockAudioCaptureAdapter implements AudioCaptureAdapter {
  private timer: number | null = null;
  private startedAt = 0;

  async listMicrophones() {
    return [{ deviceId: "demo", label: "Demo microphone" }];
  }

  async isSystemAudioReady() {
    return true;
  }

  async startMonitoring(options: StartCaptureOptions, onLevels: (levels: CaptureLevels) => void) {
    if (this.timer !== null) window.clearInterval(this.timer);
    let tick = 0;
    this.timer = window.setInterval(() => {
      tick += 1;
      onLevels({
        microphone: options.mode === "system" ? 0 : 0.25 + Math.abs(Math.sin(tick / 5)) * 0.5,
        system: options.mode === "microphone" ? 0 : 0.2 + Math.abs(Math.cos(tick / 7)) * 0.45,
      });
    }, 90);
  }

  async stopMonitoring() {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
  }

  async startRecording() {
    this.startedAt = Date.now();
  }

  async pauseRecording() {}
  async resumeRecording() {}

  async stopRecording(): Promise<CaptureResult> {
    await this.stopMonitoring();
    return {
      blobs: { mixed: new Blob(["demo audio"], { type: "audio/webm" }) },
      durationSeconds: Math.max(1, Math.round((Date.now() - this.startedAt) / 1_000)),
    };
  }

  async cancel() {
    await this.stopMonitoring();
  }
}

let adapter: AudioCaptureAdapter = USE_MOCK_API
  ? new MockAudioCaptureAdapter()
  : new BrowserAudioCaptureAdapter();

export const AUDIO_CAPTURE_IS_SIMULATED = USE_MOCK_API;

export function setAudioCaptureAdapter(next: AudioCaptureAdapter) {
  adapter = next;
}

export function getAudioCaptureAdapter(): AudioCaptureAdapter {
  return adapter;
}
