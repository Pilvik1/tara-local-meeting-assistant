import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  Bookmark,
  Circle,
  Headphones,
  Mic,
  MonitorSpeaker,
  Pause,
  Play,
  Square,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { LevelMeter } from "@/components/tara/LevelMeter";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { getAudioCaptureAdapter, type CaptureResult } from "@/lib/audioCaptureAdapter";
import { formatDuration } from "@/lib/format";
import {
  addSessionNote,
  endSession,
  patchSession,
  useRecordingSession,
} from "@/lib/recordingStore";
import { saveAudio } from "@/lib/audioStorageAdapter";
import { createMeeting } from "@/lib/taraApi";
import type { RecordingSource } from "@/lib/taraTypes";

export const Route = createFileRoute("/record")({
  head: () => ({
    meta: [
      { title: "Recording — Tara" },
      {
        name: "description",
        content: "Recording locally. Timer, live levels, notes and bookmarks.",
      },
      { property: "og:title", content: "Recording — Tara" },
      {
        property: "og:description",
        content: "A focused recording screen for local meeting capture.",
      },
    ],
  }),
  component: RecordingView,
});

function RecordingView() {
  const navigate = useNavigate();
  const session = useRecordingSession();
  const adapter = getAudioCaptureAdapter();

  const [elapsed, setElapsed] = useState(0);
  const [levels, setLevels] = useState({ microphone: 0, system: 0 });
  const [note, setNote] = useState("");
  const [confirmStop, setConfirmStop] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [captureStopped, setCaptureStopped] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const baseRef = useRef(0);
  const capturedRef = useRef<CaptureResult | null>(null);
  const savedSourcesRef = useRef<Partial<Record<RecordingSource, string>>>({});

  useEffect(() => {
    if (!session) void navigate({ to: "/" });
  }, [session, navigate]);

  useEffect(() => {
    if (!session) return;
    void adapter.startMonitoring(
      { mode: session.captureMode, microphoneDeviceId: session.microphoneDeviceId },
      setLevels,
    );
    return () => {
      void adapter.stopMonitoring();
    };
  }, [adapter, session?.captureMode, session?.microphoneDeviceId, session]);

  useEffect(() => {
    if (!session || session.isPaused || captureStopped) return;
    const id = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(id);
  }, [session, session?.isPaused, captureStopped]);

  if (!session) return null;

  const usesMic = session.captureMode !== "system";
  const usesSystem = session.captureMode !== "microphone";

  const togglePause = async () => {
    if (session.isPaused) {
      await adapter.resumeRecording();
      baseRef.current = elapsed;
      patchSession({ isPaused: false });
    } else {
      await adapter.pauseRecording();
      patchSession({ isPaused: true });
    }
  };

  const addNote = (kind: "note" | "bookmark") => {
    const text = kind === "bookmark" ? note.trim() || "Bookmark" : note.trim();
    if (kind === "note" && !text) return;
    addSessionNote({
      id: `${kind}-${Date.now()}`,
      timestamp: elapsed,
      text,
      kind,
    });
    setNote("");
    setFeedback(`${kind === "bookmark" ? "Bookmark" : "Note"} saved at ${formatDuration(elapsed)}`);
  };

  const stop = async () => {
    setStopping(true);
    try {
      const result = capturedRef.current ?? (await adapter.stopRecording());
      capturedRef.current = result;
      setCaptureStopped(true);
      const audioSources = savedSourcesRef.current;
      for (const [source, blob] of Object.entries(result.blobs) as Array<
        [RecordingSource, Blob]
      >) {
        if (audioSources[source]) continue;
        if (!blob.size) continue;
        const saved = await saveAudio(session.title, blob, source);
        audioSources[source] = saved.filePath;
      }
      if (!Object.keys(audioSources).length) {
        throw new Error("The recording produced no audio data.");
      }
      const meeting = await createMeeting({
        title: session.title,
        templateId: session.templateId,
        durationSeconds: result.durationSeconds,
        audioFile: audioSources.mixed ?? audioSources.microphone ?? audioSources.system ?? null,
        audioSources,
        notes: session.notes,
        language: session.language,
        quality: session.quality,
        hotwords: session.hotwords,
      });
      endSession();
      capturedRef.current = null;
      savedSourcesRef.current = {};
      void navigate({ to: "/meeting/$meetingId", params: { meetingId: meeting.id } });
    } catch (error) {
      setStopping(false);
      const detail =
        error instanceof Error
          ? error.message
          : "Tara could not save the recording or create the meeting.";
      setFeedback(`${detail} Select Stop again to retry.`);
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-surface px-6 py-10">
      <div className="w-full max-w-2xl rounded-xl border border-border bg-card p-8 shadow-raised">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-2 rounded-full border border-destructive/30 bg-destructive/10 px-2.5 py-1 text-xs font-medium text-destructive">
            <Circle
              className={
                session.isPaused ? "size-2.5 fill-current" : "size-2.5 animate-pulse fill-current"
              }
              aria-hidden
            />
            {captureStopped ? "Recording stopped" : session.isPaused ? "Paused" : "Recording locally"}
          </span>
          {usesMic ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
              <Mic className="size-3.5" aria-hidden />
              {session.microphoneLabel ?? "Microphone"}
            </span>
          ) : null}
          {usesSystem ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
              <MonitorSpeaker className="size-3.5" aria-hidden />
              System audio
            </span>
          ) : null}
        </div>

        <h1 className="mt-6 truncate text-xl font-semibold tracking-tight">{session.title}</h1>
        <p className="mt-1 text-xs uppercase tracking-wide text-muted-foreground">
          {session.templateId.replace("-", " ")} template
        </p>

        <p
          className="tabular mt-6 text-6xl font-semibold tracking-tight"
          aria-live="off"
          role="timer"
        >
          {formatDuration(elapsed)}
        </p>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <LevelMeter label="You" level={levels.microphone} active={usesMic && !session.isPaused} />
          <LevelMeter
            label="Other participants"
            level={levels.system}
            active={usesSystem && !session.isPaused}
          />
        </div>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Button
            variant="outline"
            size="lg"
            onClick={() => void togglePause()}
            disabled={captureStopped}
          >
            {session.isPaused ? <Play className="size-4" /> : <Pause className="size-4" />}
            {session.isPaused ? "Resume" : "Pause"}
          </Button>
          <Button variant="destructive" size="lg" onClick={() => setConfirmStop(true)}>
            <Square className="size-4 fill-current" aria-hidden />
            Stop recording
          </Button>
        </div>

        <div className="mt-8 border-t border-border pt-6">
          <label htmlFor="quick-note" className="text-sm font-medium">
            Quick note
          </label>
          <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto_auto] gap-2">
            <Input
              id="quick-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addNote("note");
              }}
              placeholder={`Note at ${formatDuration(elapsed)}`}
            />
            <Button variant="secondary" onClick={() => addNote("note")} disabled={!note.trim()}>
              Add note
            </Button>
            <Button variant="outline" onClick={() => addNote("bookmark")}>
              <Bookmark className="size-4" aria-hidden />
              Bookmark
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground" role="status">
            {feedback ??
              `${session.notes.length} note${session.notes.length === 1 ? "" : "s"} in this recording. Transcription starts when you stop.`}
          </p>

          {session.notes.length > 0 ? (
            <ul className="mt-3 max-h-40 space-y-1.5 overflow-y-auto">
              {session.notes
                .slice()
                .reverse()
                .map((n) => (
                  <li key={n.id} className="flex items-baseline gap-3 text-sm">
                    <span className="tabular shrink-0 text-xs text-muted-foreground">
                      {formatDuration(n.timestamp)}
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      {n.kind === "bookmark" ? (
                        <Bookmark className="mr-1 inline size-3.5" aria-hidden />
                      ) : null}
                      {n.text}
                    </span>
                  </li>
                ))}
            </ul>
          ) : null}
        </div>

        <p className="mt-6 flex items-start gap-2 text-xs text-muted-foreground">
          <Headphones className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          Audio is captured locally and saved to Tara when you stop. Nothing leaves this computer.
        </p>
      </div>

      <AlertDialog open={confirmStop} onOpenChange={setConfirmStop}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Stop this recording?</AlertDialogTitle>
            <AlertDialogDescription>
              Recording will end and Tara will start transcribing locally. You cannot resume this
              recording afterwards.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep recording</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void stop()}
              disabled={stopping}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {stopping ? "Stopping…" : "Stop and transcribe"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
