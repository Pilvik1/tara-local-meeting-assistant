import { Pause, Play, Rewind, FastForward, Volume2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { formatDuration } from "@/lib/format";
import type { MeetingNote } from "@/lib/taraTypes";
import type { RecordingSource } from "@/lib/taraTypes";
import { meetingAudioUrl } from "@/lib/taraApi";
import { cn } from "@/lib/utils";

const SPEEDS = [1, 1.25, 1.5, 2] as const;

export interface WaveformPlayerHandle {
  seekTo(seconds: number): void;
}

interface WaveformPlayerProps {
  peaks: number[];
  durationSeconds: number;
  /** Local file/object URL. Null when the audio is not available in this context. */
  audioUrl: string | null;
  meetingId?: string;
  audioSources?: RecordingSource[];
  markers?: MeetingNote[];
  /** Externally requested seek position (seconds). */
  seekRequest?: { seconds: number; nonce: number } | null;
  onPositionChange?: (seconds: number) => void;
}

export function WaveformPlayer({
  peaks,
  durationSeconds,
  audioUrl,
  meetingId,
  audioSources = [],
  markers = [],
  seekRequest,
  onPositionChange,
}: WaveformPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const [source, setSource] = useState<RecordingSource>(
    audioSources.includes("mixed") ? "mixed" : (audioSources[0] ?? "mixed"),
  );
  const [decodedPeaks, setDecodedPeaks] = useState<number[]>([]);
  const activeAudioUrl = audioUrl && meetingId ? meetingAudioUrl(meetingId, source) : audioUrl;

  useEffect(() => {
    if (!activeAudioUrl) return;
    const controller = new AbortController();
    void fetch(activeAudioUrl, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Audio could not be loaded.");
        return response.arrayBuffer();
      })
      .then(async (buffer) => {
        const context = new AudioContext();
        try {
          const decoded = await context.decodeAudioData(buffer.slice(0));
          const samples = decoded.getChannelData(0);
          const count = 200;
          const bucket = Math.max(1, Math.floor(samples.length / count));
          const next = Array.from({ length: count }, (_, index) => {
            let max = 0;
            const end = Math.min(samples.length, (index + 1) * bucket);
            for (let cursor = index * bucket; cursor < end; cursor += 1) {
              max = Math.max(max, Math.abs(samples[cursor] ?? 0));
            }
            return max;
          });
          setDecodedPeaks(next);
        } finally {
          await context.close();
        }
      })
      .catch(() => setDecodedPeaks([]));
    return () => controller.abort();
  }, [activeAudioUrl]);

  const bars = useMemo(
    () =>
      decodedPeaks.length
        ? decodedPeaks
        : peaks.length
          ? peaks
          : Array.from({ length: 200 }, () => 0.06),
    [decodedPeaks, peaks],
  );

  const seek = useCallback(
    (seconds: number) => {
      const clamped = Math.min(Math.max(0, seconds), durationSeconds);
      setPosition(clamped);
      if (audioRef.current) audioRef.current.currentTime = clamped;
      onPositionChange?.(clamped);
    },
    [durationSeconds, onPositionChange],
  );

  useEffect(() => {
    if (seekRequest) seek(seekRequest.seconds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seekRequest?.nonce]);

  // Demo playhead when no real audio file is attached (browser preview).
  useEffect(() => {
    if (!playing || activeAudioUrl) return;
    const id = setInterval(() => {
      setPosition((p) => {
        const next = p + 0.25 * speed;
        if (next >= durationSeconds) {
          setPlaying(false);
          return durationSeconds;
        }
        return next;
      });
    }, 250);
    return () => clearInterval(id);
  }, [playing, activeAudioUrl, speed, durationSeconds]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = speed;
  }, [speed]);

  const toggle = () => {
    const audio = audioRef.current;
    if (audio) {
      if (playing) audio.pause();
      else void audio.play();
    }
    setPlaying((p) => !p);
  };

  const progress = durationSeconds > 0 ? position / durationSeconds : 0;

  const handleScrub = (event: React.MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;
    seek(ratio * durationSeconds);
  };

  return (
    <section
      aria-label="Audio playback"
      className="rounded-lg border border-border bg-card p-4 shadow-card"
    >
      {activeAudioUrl ? (
        <audio
          key={activeAudioUrl}
          ref={audioRef}
          src={activeAudioUrl}
          onTimeUpdate={(e) => setPosition(e.currentTarget.currentTime)}
          onEnded={() => setPlaying(false)}
          className="sr-only"
        />
      ) : null}

      <div className="flex items-center gap-3">
        <Button
          type="button"
          onClick={toggle}
          size="icon"
          aria-label={playing ? "Pause playback" : "Play recording"}
          className="size-11 rounded-full"
        >
          {playing ? <Pause className="size-5" /> : <Play className="size-5" />}
        </Button>

        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-11"
          aria-label="Back 15 seconds"
          onClick={() => seek(position - 15)}
        >
          <Rewind className="size-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-11"
          aria-label="Forward 15 seconds"
          onClick={() => seek(position + 15)}
        >
          <FastForward className="size-4" />
        </Button>

        <span className="tabular text-sm text-muted-foreground">
          {formatDuration(position)} / {formatDuration(durationSeconds)}
        </span>

        <div className="ml-auto flex items-center gap-1">
          <Volume2 className="size-4 text-muted-foreground" aria-hidden />
          {SPEEDS.map((s) => (
            <Button
              key={s}
              type="button"
              variant={s === speed ? "secondary" : "ghost"}
              size="sm"
              className="h-8 px-2 text-xs"
              aria-pressed={s === speed}
              onClick={() => setSpeed(s)}
            >
              {s}×
            </Button>
          ))}
        </div>
      </div>

      {audioUrl && audioSources.length > 1 ? (
        <div className="mt-3 flex flex-wrap gap-1" role="group" aria-label="Recording source">
          {audioSources.map((item) => (
            <Button
              key={item}
              type="button"
              variant={source === item ? "secondary" : "ghost"}
              size="sm"
              onClick={() => {
                setPlaying(false);
                setPosition(0);
                setSource(item);
              }}
            >
              {item === "microphone" ? "You" : item === "system" ? "Meeting audio" : "Combined"}
            </Button>
          ))}
        </div>
      ) : null}

      <div
        role="slider"
        tabIndex={0}
        aria-label="Playback position"
        aria-valuemin={0}
        aria-valuemax={Math.round(durationSeconds)}
        aria-valuenow={Math.round(position)}
        aria-valuetext={formatDuration(position)}
        onClick={handleScrub}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") seek(position + 5);
          if (e.key === "ArrowLeft") seek(position - 5);
        }}
        className="relative mt-4 flex h-20 cursor-pointer items-end gap-[2px] rounded-md bg-muted/60 px-2 py-2"
      >
        {bars.map((peak, i) => {
          const played = i / bars.length <= progress;
          return (
            <span
              key={i}
              style={{ height: `${Math.max(6, peak * 100)}%` }}
              className={cn("flex-1 rounded-[1px]", played ? "bg-primary" : "bg-border")}
            />
          );
        })}

        {markers.map((marker) => (
          <span
            key={marker.id}
            title={`${marker.kind === "bookmark" ? "Bookmark" : "Note"} · ${formatDuration(marker.timestamp)}`}
            style={{ left: `${(marker.timestamp / Math.max(1, durationSeconds)) * 100}%` }}
            className="absolute top-1 h-3 w-[2px] -translate-x-1/2 rounded-full bg-foreground"
          />
        ))}

        <span
          style={{ left: `${progress * 100}%` }}
          className="pointer-events-none absolute inset-y-1 w-[2px] -translate-x-1/2 bg-foreground"
          aria-hidden
        />
      </div>

      {!activeAudioUrl ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Preview mode: showing the stored waveform. In the desktop app the local audio file is
          played directly from disk — it is never uploaded.
        </p>
      ) : null}
    </section>
  );
}
