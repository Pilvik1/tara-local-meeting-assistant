import { afterEach, describe, expect, it, vi } from "vitest";
import { saveAudio } from "./audioStorageAdapter";
import {
  createMeeting,
  emailMeeting,
  getMeeting,
  getProcessingState,
  getTemplates,
  listMeetings,
  mapMeeting,
  reanalyzeMeeting,
  reprocessMeeting,
} from "./taraApi";
import type { RawMeeting } from "./taraTypes";

function rawMeeting(patch: Partial<RawMeeting> = {}): RawMeeting {
  return {
    id: 42,
    title: "Real meeting",
    date: "2026-09-03T08:00:00Z",
    duration_seconds: 61,
    participants: [],
    transcript: [
      { speaker: "You", start: 0, end: 4, text: "Hei from Tara", source: "microphone" },
    ],
    summary: {
      executive_summary: "A grounded local summary.",
      purpose: "Test the integration.",
      key_discussion_points: ["Audio capture"],
      outcomes: ["Ship after proof"],
    },
    decisions: [{ text: "Use the local model", confidence: "high", timestamp: 2 }],
    action_items: [
      {
        task: "Run Windows proof",
        owner: "Alex",
        deadline: "2026-09-04",
        priority: "high",
        confidence: "high",
        timestamp: 3,
        quote: "Run the Windows proof",
      },
    ],
    risks: [],
    topics: ["Tara"],
    notes: [{ id: "n1", timestamp: 10, text: "Check audio" }],
    bookmarks: [{ id: "b1", timestamp: 20, label: "Decision" }],
    audio_file: "C:\\Tara\\recordings\\meeting-mixed.webm",
    audio_sources: {
      microphone: "C:\\Tara\\recordings\\meeting-microphone.webm",
      system: "C:\\Tara\\recordings\\meeting-system.webm",
      mixed: "C:\\Tara\\recordings\\meeting-mixed.webm",
    },
    transcription_settings: { model: "large-v3-turbo", language: "mixed", hotwords: ["Tara"] },
    transcription_metadata: { sources: [] },
    processing_status: "done",
    processing_error: null,
    analysis_source: "local_llm",
    updated_at: "2026-09-03T08:02:00Z",
    analysis_template: "general",
    analysis_version: 1,
    ...patch,
  };
}

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Tara API mapping", () => {
  it("maps snake_case meetings, numeric IDs, local provenance and separate audio sources", () => {
    const meeting = mapMeeting(rawMeeting());
    expect(meeting.id).toBe("42");
    expect(meeting.status).toBe("complete");
    expect(meeting.language).toBe("mixed");
    expect(meeting.quality).toBe("best");
    expect(meeting.summaryKind).toBe("ai_local");
    expect(meeting.summary?.dataStayedLocal).toBe(true);
    expect(meeting.audioSources).toEqual(["microphone", "system", "mixed"]);
    expect(meeting.notes.map((note) => note.kind)).toEqual(["note", "bookmark"]);
  });

  it("unwraps template and meeting response envelopes", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ templates: [{ id: "general", label: "General", description: "Any meeting" }] }),
      )
      .mockResolvedValueOnce(jsonResponse({ meetings: [rawMeeting()] }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getTemplates()).resolves.toEqual([
      { id: "general", name: "General", description: "Any meeting" },
    ]);
    await expect(listMeetings()).resolves.toMatchObject([{ id: "42", status: "complete" }]);
  });

  it("uses the search endpoint for status-only filtering and maps complete to done", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ meetings: [], count: 0 }));
    vi.stubGlobal("fetch", fetchMock);
    await listMeetings({ status: "complete" });
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/meetings/search?q=&status=done");
  });

  it("maps analyzing to honest indeterminate UI processing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          id: 42,
          processing_status: "analyzing",
          processing_error: null,
          analysis_source: "local_llm",
        }),
      ),
    );
    await expect(getProcessingState("42")).resolves.toMatchObject({
      meetingId: "42",
      stage: "analysing",
      progress: null,
    });
  });

  it("sends the exact create and reprocess payloads", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(rawMeeting({ processing_status: "queued" })))
      .mockResolvedValueOnce(jsonResponse(rawMeeting({ processing_status: "queued" })));
    vi.stubGlobal("fetch", fetchMock);

    await createMeeting({
      title: "Captured meeting",
      templateId: "product",
      durationSeconds: 90,
      audioFile: "mixed.webm",
      audioSources: { microphone: "mic.webm", system: "system.webm", mixed: "mixed.webm" },
      notes: [
        { id: "n", timestamp: 4, text: "note", kind: "note" },
        { id: "b", timestamp: 8, text: "bookmark", kind: "bookmark" },
      ],
      language: "no",
      quality: "best",
      hotwords: ["Bekk"],
    });
    const createInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(createInit.body))).toEqual({
      title: "Captured meeting",
      duration_seconds: 90,
      participants: [],
      audio_file: "mixed.webm",
      audio_sources: { microphone: "mic.webm", system: "system.webm", mixed: "mixed.webm" },
      notes: [{ id: "n", timestamp: 4, text: "note" }],
      bookmarks: [{ id: "b", timestamp: 8, label: "bookmark" }],
      analysis_template: "product",
      transcription_model: "large-v3-turbo",
      transcription_language: "no",
      transcription_hotwords: ["Bekk"],
    });

    await reprocessMeeting("42", { language: "en", quality: "fast", hotwords: ["Tara"] });
    const reprocessInit = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect(JSON.parse(String(reprocessInit.body))).toEqual({
      transcription_model: "small",
      transcription_language: "en",
      transcription_hotwords: ["Tara"],
    });
  });

  it("sends and maps the exact email contract", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ ok: true, to_email: "recipient@example.com", profile_id: "work" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      emailMeeting("42", { toEmail: "recipient@example.com", profileId: "work" }),
    ).resolves.toEqual({ ok: true, toEmail: "recipient@example.com", profileId: "work" });
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({
      to_email: "recipient@example.com",
      profile_id: "work",
    });
  });

  it("reanalyzes the saved transcript without a transcription payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(rawMeeting({ processing_status: "analyzing", analysis_source: "pending" })),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(reanalyzeMeeting("42")).resolves.toMatchObject({
      id: "42",
      status: "processing",
    });
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/meetings/42/reanalyze");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "POST" });
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).body).toBeUndefined();
  });

  it("surfaces FastAPI detail errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ detail: "Meeting not found" }, 404)));
    await expect(getMeeting("404")).rejects.toThrow("Meeting not found");
  });
});

describe("audio storage bridge", () => {
  it("passes Tara's exact object-shaped bridge payload", async () => {
    const save = vi.fn().mockResolvedValue({ path: "C:\\Tara\\recordings\\test-microphone.webm" });
    vi.stubGlobal("window", { tara: { platform: "win32", saveAudio: save } });
    const blob = new Blob(["audio"], { type: "audio/webm" });
    await expect(saveAudio("Test", blob, "microphone")).resolves.toEqual({
      filePath: "C:\\Tara\\recordings\\test-microphone.webm",
      bytes: 5,
    });
    expect(save).toHaveBeenCalledWith({
      title: "Test",
      source: "microphone",
      buffer: expect.any(ArrayBuffer),
      mimeType: "audio/webm",
    });
  });
});
