import type {
  AnalysisTemplate,
  ChatAnswer,
  HealthStatus,
  Meeting,
  MeetingListItem,
  ModelInfo,
  ModelStorageUsage,
  ProcessingState,
  ProviderDefinition,
} from "./taraTypes";

export const MOCK_TEMPLATES: AnalysisTemplate[] = [
  { id: "general", name: "General", description: "Balanced summary for any meeting." },
  { id: "one-on-one", name: "1:1", description: "Personal check-in, growth and blockers." },
  { id: "recruiting", name: "Recruiting", description: "Candidate signals and next steps." },
  { id: "sales", name: "Sales", description: "Needs, objections, pricing and follow-ups." },
  { id: "product", name: "Product", description: "Scope, trade-offs and decisions." },
  { id: "board", name: "Board / update", description: "Metrics, risks and asks." },
];

function peaks(seed: number, count = 320): number[] {
  const out: number[] = [];
  let x = seed;
  for (let i = 0; i < count; i++) {
    x = (x * 1103515245 + 12345) % 2147483648;
    const base = 0.25 + 0.55 * Math.abs(Math.sin(i / 9 + seed));
    out.push(Math.min(1, base * (0.55 + (x / 2147483648) * 0.7)));
  }
  return out;
}

const transcriptA = [
  {
    speaker: "Ari",
    text: "Let's start with where the Windows build stands after last week's crash reports.",
  },
  {
    speaker: "Alex",
    text: "The crash was in the audio device switch. It only happens when a headset is unplugged mid-recording.",
  },
  { speaker: "Ari", text: "So the recording survives, but the meter freezes?" },
  {
    speaker: "Alex",
    text: "Correct. The stream keeps writing to disk, the UI just stops updating levels.",
  },
  {
    speaker: "Mira",
    text: "From a user's point of view that reads as a failed recording. We should surface a device-changed banner.",
  },
  { speaker: "Ari", text: "Agreed. Let's treat that as the blocker for the 1.4 release." },
  {
    speaker: "Alex",
    text: "I can have a fix in by Thursday, including a regression test on device hot-swap.",
  },
  {
    speaker: "Mira",
    text: "I'll write the copy for the banner and the diagnostics panel wording.",
  },
  {
    speaker: "Ari",
    text: "One risk: if we ship the fix without re-validating system audio on Windows 10, we could regress loopback capture.",
  },
  { speaker: "Alex", text: "I'll run the full loopback matrix before we tag anything." },
  {
    speaker: "Mira",
    text: "Should the summary tell people whether their transcript left the machine?",
  },
  {
    speaker: "Ari",
    text: "Yes. Basic summaries stay local, AI summaries must be labelled explicitly.",
  },
];

function buildTranscript(offset: number) {
  return transcriptA.map((line, i) => ({
    id: `t${offset}-${i}`,
    start: 12 + i * 47,
    end: 12 + i * 47 + 41,
    speaker: line.speaker,
    text: line.text,
  }));
}

export const MOCK_MEETINGS: Meeting[] = [
  {
    id: "mtg-1042",
    title: "Tara 1.4 release review",
    createdAt: "2026-09-02T09:30:00Z",
    durationSeconds: 2724,
    templateId: "product",
    status: "complete",
    summarySnippet:
      "Device hot-swap crash is the release blocker; fix lands Thursday with a loopback regression pass.",
    summaryKind: "basic_local",
    language: "auto",
    quality: "best",
    transcriptionEngine: "Local Whisper (medium) · on this computer",
    audioUrl: null,
    audioSources: ["microphone", "system", "mixed"],
    waveformPeaks: /* @__PURE__ */ peaks(3),
    transcript: /* @__PURE__ */ buildTranscript(1),
    actions: [
      {
        id: "a1",
        task: "Fix audio device hot-swap crash and add regression test",
        owner: "Alex",
        deadline: "2026-09-04",
        priority: "high",
        confidence: 0.93,
        quote: "I can have a fix in by Thursday, including a regression test on device hot-swap.",
        quoteTimestamp: 341,
      },
      {
        id: "a2",
        task: "Write banner and diagnostics copy for device changes",
        owner: "Mira",
        deadline: "2026-09-05",
        priority: "medium",
        confidence: 0.81,
        quote: "I'll write the copy for the banner and the diagnostics panel wording.",
        quoteTimestamp: 388,
      },
      {
        id: "a3",
        task: "Run full system-audio loopback matrix on Windows 10 before tagging",
        owner: "Alex",
        deadline: "2026-09-08",
        priority: "high",
        confidence: 0.88,
        quote: "I'll run the full loopback matrix before we tag anything.",
        quoteTimestamp: 482,
      },
    ],
    notes: [
      { id: "n1", timestamp: 305, text: "Blocker confirmed for 1.4", kind: "note" },
      { id: "n2", timestamp: 482, text: "Loopback matrix", kind: "bookmark" },
      { id: "n3", timestamp: 529, text: "Privacy labelling decision", kind: "bookmark" },
    ],
    summary: {
      kind: "basic_local",
      dataStayedLocal: true,
      generatedBy: "Local summariser (no network)",
      executiveSummary:
        "The team reviewed the 1.4 release and agreed the audio device hot-swap crash is the single blocker. Recording continues to disk during the fault, but the level meters freeze, which users read as a failed recording. A fix plus a device-change banner will ship together, gated on a full Windows 10 loopback re-validation.",
      purpose: "Decide whether Tara 1.4 is releasable and agree the remaining work.",
      discussionPoints: [
        "Crash reproduces only when a headset is unplugged mid-recording",
        "Audio continues writing to disk; only the UI meter stalls",
        "Users interpret the frozen meter as data loss",
        "Privacy labelling of local vs AI summaries",
      ],
      outcomes: [
        "1.4 is held until the hot-swap fix and banner are merged",
        "Diagnostics panel will state the capture device and any dropped frames",
      ],
      decisions: [
        "Device hot-swap crash is the 1.4 release blocker",
        "Basic summaries stay local; AI summaries must be labelled explicitly",
      ],
      risks: [
        "Shipping the fix without re-validating Windows 10 loopback could regress system-audio capture",
        "Thursday target leaves no slack before the planned tag",
      ],
      topics: ["Release readiness", "Audio capture", "Diagnostics", "Privacy labelling"],
    },
    diagnostics: {
      captureMode: "both",
      microphoneDevice: "Jabra Evolve2 65 (Headset)",
      systemAudioDevice: "WASAPI loopback — Speakers (Realtek)",
      sampleRate: 48000,
      channels: 2,
      fileSizeBytes: 84_233_216,
      filePath: "C:\\Tara\\audio\\mtg-1042.wav",
      droppedFrames: 0,
      warnings: [],
    },
  },
  {
    id: "mtg-1041",
    title: "Weekly 1:1 — Mira",
    createdAt: "2026-09-01T13:00:00Z",
    durationSeconds: 1682,
    templateId: "one-on-one",
    status: "complete",
    summarySnippet:
      "Onboarding copy is ahead of schedule; Mira wants more time on research before the next sprint.",
    summaryKind: "ai_external",
    language: "en",
    quality: "best",
    transcriptionEngine: "Local Whisper (large) · on this computer",
    audioUrl: null,
    audioSources: ["microphone"],
    waveformPeaks: /* @__PURE__ */ peaks(11),
    transcript: /* @__PURE__ */ buildTranscript(2).slice(0, 8),
    actions: [
      {
        id: "b1",
        task: "Book two research sessions with new Windows users",
        owner: "Mira",
        deadline: "2026-09-10",
        priority: "medium",
        confidence: 0.74,
        quote: "I'd like two sessions with people who have never used a transcription tool.",
        quoteTimestamp: 612,
      },
    ],
    notes: [{ id: "n4", timestamp: 240, text: "Wants research time", kind: "note" }],
    summary: {
      kind: "ai_external",
      dataStayedLocal: false,
      generatedBy: "External AI summary — transcript text was sent to the configured provider",
      executiveSummary:
        "Onboarding copy is ahead of schedule. Mira asked for dedicated research time before the next sprint and flagged that first-run wording still over-explains the model download.",
      purpose: "Weekly check-in on workload, blockers and growth.",
      discussionPoints: [
        "Onboarding copy status",
        "Research time in the next sprint",
        "First-run model download wording",
      ],
      outcomes: ["Two research sessions approved for next sprint"],
      decisions: ["Research time is protected before sprint planning"],
      risks: ["Research findings may arrive after the copy is frozen"],
      topics: ["Workload", "Research", "Onboarding"],
    },
    diagnostics: {
      captureMode: "microphone",
      microphoneDevice: "Jabra Evolve2 65 (Headset)",
      systemAudioDevice: null,
      sampleRate: 48000,
      channels: 1,
      fileSizeBytes: 26_112_000,
      filePath: "C:\\Tara\\audio\\mtg-1041.wav",
      droppedFrames: 3,
      warnings: ["3 dropped frames near 04:12 — input level briefly clipped"],
    },
  },
  {
    id: "mtg-1040",
    title: "Nordic Bank — discovery call",
    createdAt: "2026-08-29T08:15:00Z",
    durationSeconds: 3320,
    templateId: "sales",
    status: "processing",
    summarySnippet: "Transcribing locally…",
    summaryKind: null,
    language: "auto",
    quality: "best",
    transcriptionEngine: "Local Whisper (medium) · on this computer",
    audioUrl: null,
    audioSources: ["microphone", "system", "mixed"],
    waveformPeaks: /* @__PURE__ */ peaks(21),
    transcript: [],
    actions: [],
    notes: [{ id: "n5", timestamp: 900, text: "Procurement timeline", kind: "bookmark" }],
    summary: null,
    diagnostics: {
      captureMode: "both",
      microphoneDevice: "Jabra Evolve2 65 (Headset)",
      systemAudioDevice: "WASAPI loopback — Speakers (Realtek)",
      sampleRate: 48000,
      channels: 2,
      fileSizeBytes: 102_400_000,
      filePath: "C:\\Tara\\audio\\mtg-1040.wav",
      droppedFrames: 0,
      warnings: [],
    },
  },
  {
    id: "mtg-1039",
    title: "Board update — August",
    createdAt: "2026-08-27T15:00:00Z",
    durationSeconds: 2140,
    templateId: "board",
    status: "failed",
    summarySnippet: "Transcription failed — the model files could not be read.",
    summaryKind: null,
    language: "auto",
    quality: "best",
    transcriptionEngine: "Local Whisper (large) · on this computer",
    audioUrl: null,
    audioSources: ["system", "mixed"],
    waveformPeaks: /* @__PURE__ */ peaks(31),
    transcript: [],
    actions: [],
    notes: [],
    summary: null,
    diagnostics: {
      captureMode: "system",
      microphoneDevice: null,
      systemAudioDevice: "WASAPI loopback — Speakers (Realtek)",
      sampleRate: 48000,
      channels: 2,
      fileSizeBytes: 65_536_000,
      filePath: "C:\\Tara\\audio\\mtg-1039.wav",
      droppedFrames: 12,
      warnings: ["12 dropped frames — system was under heavy load"],
    },
  },
];

export const MOCK_HEALTH: HealthStatus = {
  ok: true,
  version: __TARA_VERSION__,
  modelReady: true,
  modelName: "whisper-medium (local)",
  externalAiEnabled: false,
  storagePath: "C:\\Tara\\data",
  audioPath: "C:\\Tara\\audio",
  warnings: ["System audio loopback was last verified 6 days ago."],
  intelligenceInstallState: "installed",
  intelligenceInstallError: null,
  intelligenceRuntimeAvailable: true,
  intelligenceModelInstalled: true,
  intelligenceModelVerified: true,
  intelligenceModelSizeBytes: 2.5 * 1024 ** 3,
};

export function mockProcessingState(meeting: MeetingListItem): ProcessingState {
  if (meeting.status === "failed") {
    return {
      meetingId: meeting.id,
      stage: "failed",
      progress: null,
      message: "Transcription stopped",
      error:
        "The local model files at C:\\Tara\\models could not be read. The audio file is safe and untouched.",
    };
  }
  if (meeting.status === "complete") {
    return {
      meetingId: meeting.id,
      stage: "complete",
      progress: 100,
      message: "Complete",
      error: null,
    };
  }
  return {
    meetingId: meeting.id,
    stage: "transcribing",
    progress: 46,
    message: "Transcribing locally — 46% of the recording processed",
    error: null,
  };
}

export function mockChatAnswer(meeting: Meeting, question: string): ChatAnswer {
  const lines = meeting.transcript.length ? meeting.transcript : buildTranscript(9);
  const picked = lines.slice(0, 2);
  const lead = picked[0]?.text ?? "";
  return {
    answer:
      meeting.transcript.length === 0
        ? "This meeting has no transcript yet, so I can only answer once processing has finished."
        : `Based on this meeting: ${lead} The team then agreed on the follow-up described below. (Question: “${question}”)`,
    citations: picked.map((l) => ({
      speaker: l.speaker,
      quote: l.text,
      timestamp: l.start,
    })),
    usedExternalAi: false,
  };
}

/* ------------------------------------------------------------------ *
 * Models + providers (preview data)
 * ------------------------------------------------------------------ */

const GB = 1024 ** 3;
const MB = 1024 ** 2;

export const MOCK_MODELS: ModelInfo[] = [
  {
    id: "whisper-small",
    kind: "transcription",
    name: "Whisper Small",
    description: "Fastest. Good for clear audio and short meetings.",
    qualityTier: "fast",
    sizeBytes: 488 * MB,
    languages: "99 languages incl. Norwegian",
    speedHint: "~6x realtime on CPU",
    recommended: false,
    bundled: true,
    status: "ready",
    progress: null,
    downloadedBytes: 488 * MB,
    error: null,
    installPath: "C:\\Tara\\models\\whisper-small",
  },
  {
    id: "whisper-medium",
    kind: "transcription",
    name: "Whisper Medium",
    description: "Balanced accuracy and speed. Recommended for most meetings.",
    qualityTier: "best",
    sizeBytes: 1.5 * GB,
    languages: "99 languages incl. Norwegian",
    speedHint: "~2x realtime on CPU",
    recommended: true,
    bundled: false,
    status: "ready",
    progress: null,
    downloadedBytes: 1.5 * GB,
    error: null,
    installPath: "C:\\Tara\\models\\whisper-medium",
  },
  {
    id: "whisper-large-v3",
    kind: "transcription",
    name: "Whisper Large v3",
    description: "Best accuracy, especially for accents and noisy rooms.",
    qualityTier: "best",
    sizeBytes: 3.1 * GB,
    languages: "99 languages incl. Norwegian",
    speedHint: "~0.8x realtime on CPU",
    recommended: false,
    bundled: false,
    status: "not_downloaded",
    progress: null,
    downloadedBytes: 0,
    error: null,
    installPath: null,
  },
  {
    id: "summary-qwen-3b",
    kind: "summarisation",
    name: "Local summariser (3B)",
    description: "Runs summaries on this computer. Solid for structured notes.",
    qualityTier: null,
    sizeBytes: 2.2 * GB,
    languages: "Norwegian and English",
    speedHint: "~40s per hour of meeting",
    recommended: true,
    bundled: false,
    status: "not_downloaded",
    progress: null,
    downloadedBytes: 0,
    error: null,
    installPath: null,
  },
  {
    id: "summary-qwen-8b",
    kind: "summarisation",
    name: "Local summariser (8B)",
    description: "Noticeably better decisions and action items. Needs 16 GB RAM.",
    qualityTier: null,
    sizeBytes: 5.4 * GB,
    languages: "Norwegian and English",
    speedHint: "~2 min per hour of meeting",
    recommended: false,
    bundled: false,
    status: "not_downloaded",
    progress: null,
    downloadedBytes: 0,
    error: null,
    installPath: null,
  },
];

export const MOCK_MODEL_STORAGE: ModelStorageUsage = {
  modelsPath: "C:\\Tara\\models",
  usedBytes: 2 * GB,
  freeBytes: 184 * GB,
};

export const MOCK_PROVIDERS: ProviderDefinition[] = [
  {
    id: "openai",
    name: "OpenAI",
    needsBaseUrl: false,
    models: ["gpt-4.1", "gpt-4.1-mini", "o4-mini"],
    supportsTranscription: true,
    docsHint: "Create a key at platform.openai.com → API keys.",
  },
  {
    id: "anthropic",
    name: "Anthropic",
    needsBaseUrl: false,
    models: ["claude-sonnet-4", "claude-haiku-4"],
    supportsTranscription: false,
    docsHint: "Create a key at console.anthropic.com → API keys.",
  },
  {
    id: "azure_openai",
    name: "Azure OpenAI",
    needsBaseUrl: true,
    models: ["gpt-4.1", "gpt-4o-mini"],
    supportsTranscription: true,
    docsHint: "Use your resource endpoint and a deployment name.",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    needsBaseUrl: false,
    models: ["anthropic/claude-sonnet-4", "google/gemini-2.5-pro", "openai/gpt-4.1"],
    supportsTranscription: false,
    docsHint: "Create a key at openrouter.ai → Keys.",
  },
  {
    id: "custom",
    name: "Custom OpenAI-compatible",
    needsBaseUrl: true,
    models: [],
    supportsTranscription: true,
    docsHint: "Any server exposing /v1/chat/completions, including one on your own network.",
  },
];
