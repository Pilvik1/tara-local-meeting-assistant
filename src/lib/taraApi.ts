/** All renderer communication with Tara's localhost FastAPI service. */
import {
  MOCK_HEALTH,
  MOCK_MEETINGS,
  MOCK_MODELS,
  MOCK_MODEL_STORAGE,
  MOCK_TEMPLATES,
  mockChatAnswer,
  mockProcessingState,
} from "./mockData";
import type {
  AnalysisTemplate,
  AppSettings,
  ChatAnswer,
  CreateMeetingInput,
  ExportFormat,
  HealthStatus,
  Meeting,
  MeetingListItem,
  MeetingNote,
  MeetingStatus,
  ModelInfo,
  ModelStorageUsage,
  ProcessingState,
  RawAppSettings,
  RawHealthResponse,
  RawIntelligenceModelStatus,
  RawMeeting,
  RawProcessingStatus,
  ReprocessInput,
  SummaryKind,
  TranscriptLine,
  TranscriptionQuality,
  UpdateMeetingInput,
} from "./taraTypes";

export const API_BASE =
  (import.meta.env.VITE_TARA_API_BASE as string | undefined) ?? "http://127.0.0.1:8765";
export const USE_MOCK_API = import.meta.env.DEV && import.meta.env.VITE_USE_MOCK_API === "true";
export const MODEL_MANAGEMENT_AVAILABLE = true;
export const EXTERNAL_PROVIDERS_AVAILABLE = false;

const REQUEST_TIMEOUT_MS = 15_000;

export class TaraApiError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "TaraApiError";
    this.status = status;
  }
}

async function errorDetail(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { detail?: unknown };
    if (typeof payload.detail === "string") return payload.detail;
    if (Array.isArray(payload.detail)) {
      return payload.detail
        .map((item) =>
          typeof item === "object" && item && "msg" in item ? String(item.msg) : String(item),
        )
        .join("; ");
    }
  } catch {
    // Fall through to status text.
  }
  return `Request failed (${response.status})`;
}

async function request<T>(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), init?.timeoutMs ?? REQUEST_TIMEOUT_MS);
  const requestInit: RequestInit = { ...init };
  delete (requestInit as RequestInit & { timeoutMs?: number }).timeoutMs;
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...requestInit,
      headers: { "Content-Type": "application/json", ...requestInit.headers },
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new TaraApiError("The Tara service took too long to respond.");
    }
    throw new TaraApiError(
      "Cannot reach the Tara service on this computer. It may still be starting up.",
    );
  } finally {
    globalThis.clearTimeout(timeout);
  }
  if (!response.ok) throw new TaraApiError(await errorDetail(response), response.status);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

function delay<T>(value: T, ms = 180): Promise<T> {
  return new Promise((resolve) => globalThis.setTimeout(() => resolve(value), ms));
}

const mockStore: Meeting[] = USE_MOCK_API ? MOCK_MEETINGS.map((meeting) => ({ ...meeting })) : [];

function listItem(meeting: Meeting): MeetingListItem {
  const { id, title, createdAt, durationSeconds, templateId, status, summarySnippet, summaryKind } =
    meeting;
  return { id, title, createdAt, durationSeconds, templateId, status, summarySnippet, summaryKind };
}

function qualityFor(model?: string): TranscriptionQuality {
  return model === "small" ? "fast" : "best";
}

function backendModelFor(quality: TranscriptionQuality): RawAppSettings["transcription_model"] {
  return quality === "fast" ? "small" : "large-v3-turbo";
}

function meetingStatus(status: RawProcessingStatus): MeetingStatus {
  if (status === "done") return "complete";
  if (status === "failed") return "failed";
  if (status === "queued") return "queued";
  return "processing";
}

function summaryKind(source: RawMeeting["analysis_source"]): SummaryKind | null {
  if (source === "pending") return null;
  if (source === "local_llm") return "ai_local";
  if (source === "openai") return "ai_external";
  return "basic_local";
}

function confidenceNumber(confidence?: "high" | "medium" | "low"): number {
  return confidence === "high" ? 0.95 : confidence === "medium" ? 0.72 : 0.45;
}

export function meetingAudioUrl(id: string, source: string): string {
  return `${API_BASE}/meetings/${encodeURIComponent(id)}/audio/${encodeURIComponent(source)}`;
}

export function mapMeeting(raw: RawMeeting): Meeting {
  const id = String(raw.id);
  const sourceNames = Object.keys(raw.audio_sources ?? {}).filter(
    (source): source is "microphone" | "system" | "mixed" =>
      source === "microphone" || source === "system" || source === "mixed",
  );
  if (raw.audio_file && !sourceNames.includes("mixed")) sourceNames.push("mixed");
  const preferredSource = sourceNames.includes("mixed") ? "mixed" : sourceNames[0];
  const kind = summaryKind(raw.analysis_source);
  const settings = raw.transcription_settings;
  const metadata = raw.transcription_metadata?.sources ?? [];
  const captureMode = sourceNames.includes("microphone") && sourceNames.includes("system")
    ? "both"
    : sourceNames.includes("system")
      ? "system"
      : "microphone";
  const transcript: TranscriptLine[] = raw.transcript.map((line, index) => ({
    id: `${id}-line-${index}`,
    start: line.start,
    end: line.end,
    speaker: line.speaker,
    text: line.text,
  }));
  const notes: MeetingNote[] = [
    ...raw.notes.map((note) => ({ ...note, kind: "note" as const })),
    ...raw.bookmarks.map((bookmark) => ({
      id: bookmark.id,
      timestamp: bookmark.timestamp,
      text: bookmark.label,
      kind: "bookmark" as const,
    })),
  ].sort((left, right) => left.timestamp - right.timestamp);

  return {
    id,
    title: raw.title,
    createdAt: raw.date,
    durationSeconds: raw.duration_seconds,
    templateId: raw.analysis_template,
    status: meetingStatus(raw.processing_status),
    summarySnippet: raw.summary.executive_summary || raw.processing_error || "Processing meeting…",
    summaryKind: kind,
    language: settings?.language ?? "auto",
    quality: qualityFor(settings?.model),
    transcriptionEngine: `Local Whisper (${settings?.model ?? "configured model"})`,
    audioUrl: preferredSource ? meetingAudioUrl(id, preferredSource) : null,
    audioSources: sourceNames,
    waveformPeaks: [],
    transcript,
    actions: raw.action_items.map((action, index) => ({
      id: `${id}-action-${index}`,
      task: action.task,
      owner: action.owner,
      deadline: action.deadline && action.deadline !== "Unclear" ? action.deadline : null,
      priority: action.priority,
      confidence: confidenceNumber(action.confidence),
      quote: action.quote ?? "No supporting quote was stored.",
      quoteTimestamp: action.timestamp ?? 0,
    })),
    notes,
    summary: kind
      ? {
          kind,
          dataStayedLocal: kind !== "ai_external",
          generatedBy:
            kind === "ai_local"
              ? "Local intelligence model"
              : kind === "ai_external"
                ? "External analysis"
                : "Private basic extraction",
          executiveSummary: raw.summary.executive_summary,
          purpose: raw.summary.purpose,
          discussionPoints: raw.summary.key_discussion_points,
          outcomes: raw.summary.outcomes,
          decisions: raw.decisions.map((decision) => decision.text),
          risks: raw.risks,
          topics: raw.topics,
        }
      : null,
    diagnostics: {
      captureMode,
      microphoneDevice: captureMode === "system" ? null : "Recorded microphone track",
      systemAudioDevice: captureMode === "microphone" ? null : "Recorded system-audio track",
      sampleRate: 0,
      channels: sourceNames.length,
      fileSizeBytes: 0,
      filePath: raw.audio_file ?? Object.values(raw.audio_sources ?? {})[0] ?? "",
      droppedFrames: 0,
      warnings: metadata.flatMap((entry) =>
        entry.detected_language
          ? [`${entry.source}: detected ${entry.detected_language}${entry.language_probability == null ? "" : ` (${Math.round(entry.language_probability * 100)}%)`}`]
          : [],
      ),
    },
  };
}

function mapHealth(raw: RawHealthResponse): HealthStatus {
  const analysis = raw.analysis;
  const security = raw.security;
  return {
    ok: raw.ok,
    version: __TARA_VERSION__,
    modelReady: Boolean(raw.transcription?.faster_whisper && raw.transcription?.ffmpeg),
    modelName: raw.transcription?.model ?? "unknown",
    externalAiEnabled: Boolean(analysis?.external_ai),
    storagePath: security?.storage?.data_dir ?? raw.transcription?.data_dir ?? "",
    audioPath: security?.storage?.recordings_dir ?? raw.transcription?.recordings_dir ?? "",
    warnings: security?.warnings ?? [],
    intelligenceInstallState: analysis?.install_state ?? "not_installed",
    intelligenceInstallError: analysis?.install_error ?? null,
    intelligenceRuntimeAvailable: Boolean(analysis?.runtime_available),
    intelligenceModelInstalled: Boolean(analysis?.model_installed),
    intelligenceModelVerified: Boolean(analysis?.model_verified),
    intelligenceModelSizeBytes: analysis?.model_size_bytes ?? null,
  };
}

export async function getHealth(): Promise<HealthStatus> {
  if (USE_MOCK_API) return delay(MOCK_HEALTH, 100);
  return mapHealth(await request<RawHealthResponse>("/health"));
}

export async function getBackendSettings(): Promise<RawAppSettings> {
  if (USE_MOCK_API) {
    return delay({
      transcription_model: "large-v3-turbo",
      transcription_language: "auto",
      transcription_hotwords: [],
    });
  }
  return request<RawAppSettings>("/settings");
}

export async function patchBackendSettings(input: Partial<RawAppSettings>): Promise<RawAppSettings> {
  if (USE_MOCK_API) return delay({
    transcription_model: input.transcription_model ?? "large-v3-turbo",
    transcription_language: input.transcription_language ?? "auto",
    transcription_hotwords: input.transcription_hotwords ?? [],
  });
  return request<RawAppSettings>("/settings", { method: "PATCH", body: JSON.stringify(input) });
}

export async function getTemplates(): Promise<AnalysisTemplate[]> {
  if (USE_MOCK_API) return delay(MOCK_TEMPLATES, 100);
  const response = await request<{
    templates: Array<{ id: string; label: string; description: string }>;
  }>("/analysis/templates");
  return response.templates.map((template) => ({
    id: template.id,
    name: template.label,
    description: template.description,
  }));
}

export async function listMeetings(params?: {
  query?: string;
  status?: MeetingStatus | "all";
}): Promise<MeetingListItem[]> {
  const query = params?.query?.trim() ?? "";
  const status = params?.status ?? "all";
  if (USE_MOCK_API) {
    return delay(
      mockStore
        .filter((meeting) =>
          (!query || `${meeting.title} ${meeting.summarySnippet}`.toLowerCase().includes(query.toLowerCase())) &&
          (status === "all" || meeting.status === status || (status === "processing" && meeting.status === "queued")),
        )
        .map(listItem),
    );
  }
  if (query || status !== "all") {
    const search = new URLSearchParams({ q: query, status: status === "complete" ? "done" : status });
    const response = await request<{ meetings: RawMeeting[]; count: number }>(
      `/meetings/search?${search.toString()}`,
    );
    return response.meetings.map(mapMeeting).map(listItem);
  }
  const response = await request<{ meetings: RawMeeting[] }>("/meetings");
  return response.meetings.map(mapMeeting).map(listItem);
}

export async function getMeeting(id: string): Promise<Meeting> {
  if (USE_MOCK_API) {
    const found = mockStore.find((meeting) => meeting.id === id);
    if (!found) throw new TaraApiError("Meeting not found", 404);
    return delay({ ...found });
  }
  return mapMeeting(await request<RawMeeting>(`/meetings/${encodeURIComponent(id)}`));
}

export async function getProcessingState(id: string): Promise<ProcessingState> {
  if (USE_MOCK_API) {
    const found = mockStore.find((meeting) => meeting.id === id);
    if (!found) throw new TaraApiError("Meeting not found", 404);
    return delay(mockProcessingState(found));
  }
  const state = await request<{
    id: number;
    processing_status: RawProcessingStatus;
    processing_error: string | null;
    analysis_source: RawMeeting["analysis_source"];
  }>(`/meetings/${encodeURIComponent(id)}/processing`);
  const stage = state.processing_status === "analyzing"
    ? "analysing"
    : state.processing_status === "done"
      ? "complete"
      : state.processing_status;
  return {
    meetingId: String(state.id),
    stage,
    progress: null,
    message:
      stage === "queued"
        ? "Queued for local processing"
        : stage === "transcribing"
          ? "Transcribing locally"
          : stage === "analysing"
            ? "Analysing on this computer"
            : stage === "complete"
              ? "Processing complete"
              : "Processing failed",
    error: state.processing_error,
  };
}

function rawCreateInput(input: CreateMeetingInput) {
  const notes = input.notes.filter((note) => note.kind === "note");
  const bookmarks = input.notes.filter((note) => note.kind === "bookmark");
  return {
    title: input.title,
    duration_seconds: input.durationSeconds,
    participants: [],
    audio_file: input.audioFile,
    audio_sources: input.audioSources,
    notes: notes.map(({ id, timestamp, text }) => ({ id, timestamp, text })),
    bookmarks: bookmarks.map(({ id, timestamp, text }) => ({ id, timestamp, label: text })),
    analysis_template: input.templateId,
    transcription_model: backendModelFor(input.quality),
    transcription_language: input.language,
    transcription_hotwords: input.hotwords ?? [],
  };
}

export async function createMeeting(input: CreateMeetingInput): Promise<Meeting> {
  if (USE_MOCK_API) {
    const template = MOCK_TEMPLATES.find((item) => item.id === input.templateId);
    const meeting: Meeting = {
      id: `mtg-${Date.now()}`,
      title: input.title,
      createdAt: new Date().toISOString(),
      durationSeconds: input.durationSeconds,
      templateId: template?.id ?? "general",
      status: "queued",
      summarySnippet: "Waiting to be processed…",
      summaryKind: null,
      language: input.language,
      quality: input.quality,
      transcriptionEngine: "Local Whisper · demo",
      audioUrl: null,
      audioSources: Object.keys(input.audioSources) as Meeting["audioSources"],
      waveformPeaks: [],
      transcript: [],
      actions: [],
      notes: input.notes,
      summary: null,
      diagnostics: {
        captureMode: "both",
        microphoneDevice: "Demo microphone",
        systemAudioDevice: "Demo system audio",
        sampleRate: 48_000,
        channels: 2,
        fileSizeBytes: 0,
        filePath: "(demo)",
        droppedFrames: 0,
        warnings: [],
      },
    };
    mockStore.unshift(meeting);
    return delay(meeting);
  }
  return mapMeeting(
    await request<RawMeeting>("/meetings", {
      method: "POST",
      body: JSON.stringify(rawCreateInput(input)),
      timeoutMs: 30_000,
    }),
  );
}

function rawUpdateInput(input: UpdateMeetingInput) {
  const payload: Record<string, unknown> = {};
  if (input.title !== undefined) payload.title = input.title;
  if (input.transcript !== undefined) {
    payload.transcript = input.transcript.map(({ speaker, start, end, text }) => ({
      speaker,
      start,
      end,
      text,
    }));
  }
  if (input.actions !== undefined) {
    payload.action_items = input.actions.map((action) => ({
      task: action.task,
      owner: action.owner || "Unclear",
      deadline: action.deadline || "Unclear",
      priority: action.priority,
      confidence:
        action.confidence >= 0.85 ? "high" : action.confidence >= 0.6 ? "medium" : "low",
      timestamp: action.quoteTimestamp,
      quote: action.quote,
    }));
  }
  if (input.notes !== undefined) {
    payload.notes = input.notes
      .filter((note) => note.kind === "note")
      .map(({ id, timestamp, text }) => ({ id, timestamp, text }));
    payload.bookmarks = input.notes
      .filter((note) => note.kind === "bookmark")
      .map(({ id, timestamp, text }) => ({ id, timestamp, label: text }));
  }
  return payload;
}

export async function updateMeeting(id: string, input: UpdateMeetingInput): Promise<Meeting> {
  if (USE_MOCK_API) {
    const index = mockStore.findIndex((meeting) => meeting.id === id);
    const existing = mockStore[index];
    if (!existing) throw new TaraApiError("Meeting not found", 404);
    const next = { ...existing, ...input };
    mockStore[index] = next;
    return delay(next);
  }
  return mapMeeting(
    await request<RawMeeting>(`/meetings/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(rawUpdateInput(input)),
    }),
  );
}

export async function reprocessMeeting(id: string, input: ReprocessInput): Promise<Meeting> {
  if (USE_MOCK_API) {
    const index = mockStore.findIndex((meeting) => meeting.id === id);
    const existing = mockStore[index];
    if (!existing) throw new TaraApiError("Meeting not found", 404);
    const next: Meeting = {
      ...existing,
      status: "queued",
      language: input.language,
      quality: input.quality,
      summarySnippet: "Queued for local reprocessing…",
    };
    mockStore[index] = next;
    return delay(next);
  }
  return mapMeeting(
    await request<RawMeeting>(`/meetings/${encodeURIComponent(id)}/reprocess`, {
      method: "POST",
      body: JSON.stringify({
        transcription_model: backendModelFor(input.quality),
        transcription_language: input.language,
        transcription_hotwords: input.hotwords ?? [],
      }),
    }),
  );
}

/** Re-run only summary/action analysis from the saved transcript. Audio is not retranscribed. */
export async function reanalyzeMeeting(id: string): Promise<Meeting> {
  if (USE_MOCK_API) {
    const index = mockStore.findIndex((meeting) => meeting.id === id);
    const existing = mockStore[index];
    if (!existing) throw new TaraApiError("Meeting not found", 404);
    const next: Meeting = {
      ...existing,
      status: "processing",
      summarySnippet: "Queued for local analysis…",
    };
    mockStore[index] = next;
    return delay(next);
  }
  return mapMeeting(
    await request<RawMeeting>(`/meetings/${encodeURIComponent(id)}/reanalyze`, {
      method: "POST",
    }),
  );
}

export async function askMeeting(id: string, question: string): Promise<ChatAnswer> {
  if (USE_MOCK_API) {
    const found = mockStore.find((meeting) => meeting.id === id);
    if (!found) throw new TaraApiError("Meeting not found", 404);
    return delay(mockChatAnswer(found, question), 350);
  }
  const result = await request<{ answer: string; citations: ChatAnswer["citations"] }>(
    `/meetings/${encodeURIComponent(id)}/chat`,
    { method: "POST", body: JSON.stringify({ question }), timeoutMs: 60_000 },
  );
  return { ...result, usedExternalAi: false };
}

export async function emailMeeting(
  id: string,
  input: { toEmail?: string; profileId?: string } = {},
): Promise<{ ok: boolean; toEmail: string; profileId: string | null }> {
  if (USE_MOCK_API) {
    return delay({
      ok: true,
      toEmail: input.toEmail ?? "demo@example.com",
      profileId: input.profileId ?? null,
    });
  }
  const result = await request<{ ok: boolean; to_email: string; profile_id: string | null }>(
    `/meetings/${encodeURIComponent(id)}/email`,
    {
      method: "POST",
      body: JSON.stringify({
        ...(input.toEmail ? { to_email: input.toEmail } : {}),
        ...(input.profileId ? { profile_id: input.profileId } : {}),
      }),
    },
  );
  return { ok: result.ok, toEmail: result.to_email, profileId: result.profile_id };
}

export async function exportMeeting(id: string, format: ExportFormat): Promise<Blob> {
  if (USE_MOCK_API) return delay(new Blob([`# ${id}\n`], { type: "text/markdown" }));
  const response = await fetch(
    `${API_BASE}/meetings/${encodeURIComponent(id)}/export/${encodeURIComponent(format)}`,
  );
  if (!response.ok) throw new TaraApiError(await errorDetail(response), response.status);
  return response.blob();
}

function intelligenceModel(status: RawIntelligenceModelStatus): ModelInfo {
  const modelStatus: ModelInfo["status"] =
    status.install_state === "installed"
      ? "ready"
      : status.install_state === "failed"
        ? "error"
        : status.install_state === "not_installed"
          ? "not_downloaded"
          : "downloading";
  return {
    id: "intelligence",
    kind: "summarisation",
    name: status.model || "Tara local intelligence",
    description: "Creates grounded, context-aware summaries locally. Without it, Tara only performs basic extraction.",
    qualityTier: null,
    sizeBytes: status.model_size_bytes ?? 2_500_000_000,
    languages: "Norwegian and English",
    speedHint: "Runs locally",
    recommended: true,
    bundled: false,
    status: modelStatus,
    progress: null,
    downloadedBytes: status.model_installed ? (status.model_size_bytes ?? 0) : 0,
    error: status.install_error,
    installPath: status.model_path ?? null,
  };
}

export async function listModels(): Promise<ModelInfo[]> {
  if (USE_MOCK_API) {
    return delay(MOCK_MODELS.filter((model) => model.id === "summary-qwen-3b"));
  }
  return [intelligenceModel(await request<RawIntelligenceModelStatus>("/models/intelligence"))];
}

export async function getModelStorage(): Promise<ModelStorageUsage> {
  if (USE_MOCK_API) return delay(MOCK_MODEL_STORAGE);
  const status = await request<RawIntelligenceModelStatus>("/models/intelligence");
  return {
    modelsPath: status.model_path ?? "Tara models directory",
    usedBytes: status.model_installed ? (status.model_size_bytes ?? 0) : 0,
    freeBytes: 0,
  };
}

export async function downloadModel(id: string): Promise<ModelInfo> {
  if (USE_MOCK_API) {
    const model = MOCK_MODELS.find((item) => item.id === id);
    if (!model) throw new TaraApiError("Model not found", 404);
    model.status = "downloading";
    model.progress = null;
    globalThis.setTimeout(() => {
      model.status = "ready";
      model.downloadedBytes = model.sizeBytes;
      model.installPath = "C:\\Tara\\models\\summary-qwen-3b.gguf";
    }, 1_200);
    return delay({ ...model });
  }
  if (id !== "intelligence") throw new TaraApiError("Whisper models download automatically when first used.");
  return intelligenceModel(
    await request<RawIntelligenceModelStatus>("/models/intelligence/install", { method: "POST" }),
  );
}

export async function deleteModel(id: string): Promise<ModelInfo> {
  if (USE_MOCK_API) {
    const model = MOCK_MODELS.find((item) => item.id === id);
    if (!model) throw new TaraApiError("Model not found", 404);
    model.status = "not_downloaded";
    model.downloadedBytes = 0;
    model.installPath = null;
    return delay({ ...model });
  }
  if (id !== "intelligence") throw new TaraApiError("This model is managed automatically by Tara.");
  return intelligenceModel(
    await request<RawIntelligenceModelStatus>("/models/intelligence", { method: "DELETE" }),
  );
}

export async function cancelModelDownload(): Promise<ModelInfo> {
  throw new TaraApiError("Download cancellation is not supported by the current Tara backend.");
}

export async function listProviders(): Promise<never[]> {
  return [];
}

export async function getProviderCredential(): Promise<never> {
  throw new TaraApiError("External providers are not supported by the current Tara backend.");
}

export async function saveProviderCredential(): Promise<never> {
  throw new TaraApiError("External providers are not supported by the current Tara backend.");
}

export async function deleteProviderCredential(): Promise<void> {
  throw new TaraApiError("External providers are not supported by the current Tara backend.");
}

export async function testProvider(): Promise<never> {
  throw new TaraApiError("External providers are not supported by the current Tara backend.");
}

export function settingsPatch(settings: AppSettings): RawAppSettings {
  return {
    transcription_model: backendModelFor(settings.quality),
    transcription_language: settings.language,
    transcription_hotwords: settings.hotwords,
  };
}
