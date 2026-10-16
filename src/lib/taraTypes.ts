/**
 * Shared domain types for the Tara desktop app.
 * These mirror the local FastAPI backend at http://127.0.0.1:8765.
 */

export type MeetingStatus = "queued" | "processing" | "complete" | "failed";

export type ProcessingStage =
  "queued" | "downloading_model" | "transcribing" | "analysing" | "complete" | "failed";

export type CaptureMode = "microphone" | "system" | "both";

export type TranscriptionLanguage = "auto" | "no" | "en" | "mixed";

export type TranscriptionQuality = "fast" | "best";

export type SummaryKind = "basic_local" | "ai_local" | "ai_external";

export interface AnalysisTemplate {
  id: string;
  name: string;
  description: string;
}

export interface HealthStatus {
  ok: boolean;
  version: string;
  modelReady: boolean;
  modelName: string;
  externalAiEnabled: boolean;
  storagePath: string;
  audioPath: string;
  warnings: string[];
  intelligenceInstallState: "not_installed" | "downloading" | "installed" | "failed";
  intelligenceInstallError: string | null;
  intelligenceRuntimeAvailable: boolean;
  intelligenceModelInstalled: boolean;
  intelligenceModelVerified: boolean;
  intelligenceModelSizeBytes: number | null;
}

export interface TranscriptLine {
  id: string;
  /** Seconds from the start of the recording. */
  start: number;
  end: number;
  speaker: string;
  text: string;
}

export interface ActionItem {
  id: string;
  task: string;
  owner: string;
  deadline: string | null;
  priority: "low" | "medium" | "high";
  confidence: number;
  quote: string;
  quoteTimestamp: number;
}

export interface MeetingNote {
  id: string;
  timestamp: number;
  text: string;
  kind: "note" | "bookmark";
}

export interface MeetingSummary {
  kind: SummaryKind;
  /** True when nothing left this computer to produce the summary. */
  dataStayedLocal: boolean;
  generatedBy: string;
  executiveSummary: string;
  purpose: string;
  discussionPoints: string[];
  outcomes: string[];
  decisions: string[];
  risks: string[];
  topics: string[];
}

export interface RecordingDiagnostics {
  captureMode: CaptureMode;
  microphoneDevice: string | null;
  systemAudioDevice: string | null;
  sampleRate: number;
  channels: number;
  fileSizeBytes: number;
  filePath: string;
  droppedFrames: number;
  warnings: string[];
}

export interface MeetingListItem {
  id: string;
  title: string;
  createdAt: string;
  durationSeconds: number;
  templateId: string;
  status: MeetingStatus;
  summarySnippet: string;
  summaryKind: SummaryKind | null;
}

export interface Meeting extends MeetingListItem {
  language: TranscriptionLanguage;
  quality: TranscriptionQuality;
  transcriptionEngine: string;
  audioUrl: string | null;
  audioSources: RecordingSource[];
  waveformPeaks: number[];
  transcript: TranscriptLine[];
  actions: ActionItem[];
  notes: MeetingNote[];
  summary: MeetingSummary | null;
  diagnostics: RecordingDiagnostics;
}

export interface ProcessingState {
  meetingId: string;
  stage: ProcessingStage;
  /** 0-100, or null when exact progress is unavailable (indeterminate). */
  progress: number | null;
  message: string;
  error: string | null;
}

export interface CreateMeetingInput {
  title: string;
  templateId: string;
  durationSeconds: number;
  audioFile: string | null;
  audioSources: Partial<Record<RecordingSource, string>>;
  notes: MeetingNote[];
  language: TranscriptionLanguage;
  quality: TranscriptionQuality;
  hotwords?: string[];
}

export interface UpdateMeetingInput {
  title?: string;
  transcript?: TranscriptLine[];
  actions?: ActionItem[];
  notes?: MeetingNote[];
}

export interface ReprocessInput {
  language: TranscriptionLanguage;
  quality: TranscriptionQuality;
  hotwords?: string[];
}

export interface ChatCitation {
  speaker: string;
  quote: string;
  timestamp: number;
}

export interface ChatAnswer {
  answer: string;
  citations: ChatCitation[];
  usedExternalAi: boolean;
}

export type RecordingSource = "microphone" | "system" | "mixed";

export type ExportFormat = "markdown" | "actions" | "docx" | "pdf";

export interface AppSettings {
  defaultCaptureMode: CaptureMode;
  defaultMicrophoneDeviceId: string | null;
  language: TranscriptionLanguage;
  quality: TranscriptionQuality;
  externalAiEnabled: boolean;
  storagePath: string;
  audioPath: string;
  processingMode: ProcessingMode;
  providerId: ProviderId;
  providerModel: string;
  providerBaseUrl: string;
  hotwords: string[];
}

/* ------------------------------------------------------------------ *
 * Models (download manager)
 * ------------------------------------------------------------------ */

export type ModelKind = "transcription" | "summarisation";

export type ModelStatus = "not_downloaded" | "downloading" | "verifying" | "ready" | "error";

export interface ModelInfo {
  id: string;
  kind: ModelKind;
  name: string;
  /** Short plain-language positioning, e.g. "Fastest, good for clear audio". */
  description: string;
  /** Maps a transcription model to a quality tier, when applicable. */
  qualityTier: TranscriptionQuality | null;
  sizeBytes: number;
  languages: string;
  /** Relative speed hint, e.g. "~4x realtime on CPU". */
  speedHint: string;
  recommended: boolean;
  /** Shipped inside the installer — cannot be deleted. */
  bundled: boolean;
  status: ModelStatus;
  /** 0-100 while downloading, null when indeterminate. */
  progress: number | null;
  downloadedBytes: number;
  error: string | null;
  installPath: string | null;
}

export interface ModelStorageUsage {
  modelsPath: string;
  usedBytes: number;
  freeBytes: number;
}

/* ------------------------------------------------------------------ *
 * Processing mode / external providers
 * ------------------------------------------------------------------ */

/**
 * fully_local          – audio, transcript and summary never leave the computer.
 * local_stt_external_ai – transcription local, transcript text sent for summarisation.
 * external_all          – audio uploaded for transcription and summarisation.
 */
export type ProcessingMode = "fully_local" | "local_stt_external_ai" | "external_all";

export type ProviderId = "openai" | "anthropic" | "azure_openai" | "openrouter" | "custom";

export interface ProviderDefinition {
  id: ProviderId;
  name: string;
  /** What the user must supply besides the API key. */
  needsBaseUrl: boolean;
  models: string[];
  supportsTranscription: boolean;
  docsHint: string;
}

export interface ProviderCredentialStatus {
  providerId: ProviderId;
  /** The key itself never reaches the renderer — only whether one is stored. */
  hasKey: boolean;
  lastTestedAt: string | null;
  lastTestOk: boolean | null;
  message: string | null;
}

export interface ProviderTestResult {
  ok: boolean;
  message: string;
  latencyMs: number | null;
}

/* ------------------------------------------------------------------ *
 * Raw FastAPI contracts. These stay snake_case and are mapped explicitly
 * before any response reaches the UI.
 * ------------------------------------------------------------------ */

export type RawProcessingStatus = "queued" | "transcribing" | "analyzing" | "done" | "failed";
export type RawAnalysisSource = "pending" | "local_llm" | "basic" | "openai" | "heuristic";
export type RawConfidence = "high" | "medium" | "low";

export interface RawTranscriptLine {
  speaker: string;
  start: number;
  end: number;
  text: string;
  source?: string;
  confidence?: number;
  words?: Array<{ word: string; start: number; end: number; confidence?: number }>;
}

export interface RawMeeting {
  id: number;
  title: string;
  date: string;
  duration_seconds: number;
  participants: string[];
  transcript: RawTranscriptLine[];
  summary: {
    executive_summary: string;
    purpose: string;
    key_discussion_points: string[];
    outcomes: string[];
    evidence?: Array<{ source: string; timestamp: number; quote: string }>;
  };
  decisions: Array<{
    text: string;
    confidence: RawConfidence;
    timestamp?: number;
    source?: string;
    quote?: string;
  }>;
  action_items: Array<{
    task: string;
    owner: string;
    deadline: string;
    priority: RawConfidence;
    confidence?: RawConfidence;
    timestamp?: number;
    source?: string;
    quote?: string;
    uncertainty?: string;
  }>;
  risks: string[];
  topics: string[];
  notes: Array<{ id: string; timestamp: number; text: string }>;
  bookmarks: Array<{ id: string; timestamp: number; label: string }>;
  audio_file?: string | null;
  audio_sources?: Record<string, string>;
  transcription_settings?: {
    model: "small" | "large-v3-turbo";
    language: TranscriptionLanguage;
    hotwords: string[];
  };
  transcription_metadata?: {
    sources?: Array<{
      source: string;
      model: string;
      requested_language: string;
      detected_language?: string;
      language_probability?: number;
      duration?: number;
      duration_after_vad?: number;
      average_log_probability?: number;
      transcription_seconds?: number;
      segments: number;
    }>;
  };
  processing_status: RawProcessingStatus;
  processing_error?: string | null;
  analysis_source: RawAnalysisSource;
  updated_at?: string | null;
  analysis_template: string;
  analysis_version: number;
}

export interface RawHealthResponse {
  ok: boolean;
  transcription?: {
    faster_whisper: boolean;
    ffmpeg: boolean;
    model: string;
    device?: string;
    compute_type?: string;
    language: string;
    model_loaded?: boolean;
    data_dir?: string;
    recordings_dir?: string;
    models_dir?: string;
  };
  analysis?: RawIntelligenceModelStatus;
  security?: {
    warnings: string[];
    storage?: { encrypted: boolean; data_dir: string; recordings_dir: string };
  };
}

export interface RawAppSettings {
  transcription_model: "small" | "large-v3-turbo";
  transcription_language: TranscriptionLanguage;
  transcription_hotwords: string[];
}

export interface RawIntelligenceModelStatus {
  mode: "local_llm" | "basic_extraction";
  external_ai: false;
  runtime_available: boolean;
  runtime_path?: string | null;
  model: string;
  model_repo?: string;
  model_file?: string;
  model_path?: string;
  model_installed: boolean;
  model_verified: boolean;
  model_size_bytes: number | null;
  install_state: "not_installed" | "downloading" | "installed" | "failed";
  install_error: string | null;
  last_error?: string | null;
  privacy?: string;
}
