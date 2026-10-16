import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  Headphones,
  Info,
  Mic,
  MonitorSpeaker,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/tara/AppShell";
import { LevelMeter } from "@/components/tara/LevelMeter";
import { TranscriptionControls } from "@/components/tara/TranscriptionControls";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getAudioCaptureAdapter, type AudioInputDevice } from "@/lib/audioCaptureAdapter";
import { useSettings } from "@/lib/settingsStore";
import { startSession } from "@/lib/recordingStore";
import { getTemplates } from "@/lib/taraApi";
import type { CaptureMode } from "@/lib/taraTypes";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/new")({
  head: () => ({
    meta: [
      { title: "New recording — Tara" },
      {
        name: "description",
        content:
          "Check your microphone and system audio, pick a template and start recording your meeting locally.",
      },
      { property: "og:title", content: "New recording — Tara" },
      {
        property: "og:description",
        content: "Audio preflight: capture mode, device check and level meters before you record.",
      },
    ],
  }),
  component: Preflight,
});

const MODES: { value: CaptureMode; label: string; description: string; icon: typeof Mic }[] = [
  {
    value: "microphone",
    label: "Microphone",
    description: "Only you. Good for dictation and in-person notes.",
    icon: Mic,
  },
  {
    value: "system",
    label: "System audio",
    description: "Only what your computer plays — the other participants.",
    icon: MonitorSpeaker,
  },
  {
    value: "both",
    label: "Both",
    description: "You and the other participants. Recommended for calls.",
    icon: Headphones,
  },
];

function Preflight() {
  const navigate = useNavigate();
  const [settings] = useSettings();
  const adapter = getAudioCaptureAdapter();

  const [title, setTitle] = useState("");
  const [templateId, setTemplateId] = useState("general");
  const [mode, setMode] = useState<CaptureMode>(settings.defaultCaptureMode);
  const [deviceId, setDeviceId] = useState<string | null>(settings.defaultMicrophoneDeviceId);
  const [devices, setDevices] = useState<AudioInputDevice[]>([]);
  const [levels, setLevels] = useState({ microphone: 0, system: 0 });
  const [systemReady, setSystemReady] = useState<boolean | null>(null);
  const [language, setLanguage] = useState(settings.language);
  const [quality, setQuality] = useState(settings.quality);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);

  const templates = useQuery({ queryKey: ["templates"], queryFn: getTemplates, retry: false });

  const refreshDevices = useCallback(async () => {
    try {
      const list = await adapter.listMicrophones();
      setDevices(list);
      setDeviceId((current) => current ?? list[0]?.deviceId ?? null);
      setCaptureError(null);
    } catch (e) {
      setDevices([]);
      setCaptureError(
        e instanceof Error ? e.message : "Audio capture is not available in this build.",
      );
    }
  }, [adapter]);

  useEffect(() => {
    void refreshDevices();
    void adapter.isSystemAudioReady().then(setSystemReady);
  }, [adapter, refreshDevices]);

  useEffect(() => {
    let cancelled = false;
    void adapter
      .startMonitoring({ mode, microphoneDeviceId: deviceId }, (next) => {
        if (!cancelled) setLevels(next);
      })
      .then(() => {
        if (!cancelled && mode !== "microphone") setSystemReady(true);
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setLevels({ microphone: 0, system: 0 });
          setCaptureError(
            reason instanceof Error ? reason.message : "The selected audio source is unavailable.",
          );
          if (mode !== "microphone") setSystemReady(false);
        }
      });
    return () => {
      cancelled = true;
      void adapter.stopMonitoring();
    };
  }, [adapter, mode, deviceId]);

  const needsMic = mode !== "system";
  const needsSystem = mode !== "microphone";
  const ready =
    !captureError &&
    title.trim().length > 0 &&
    (!needsMic || Boolean(deviceId)) &&
    (!needsSystem || systemReady === true);

  const handleStart = async () => {
    setStarting(true);
    setError(null);
    try {
      await adapter.startRecording({ mode, microphoneDeviceId: deviceId });
      await adapter.stopMonitoring();
      startSession({
        title: title.trim(),
        templateId,
        captureMode: mode,
        microphoneDeviceId: deviceId,
        microphoneLabel: devices.find((d) => d.deviceId === deviceId)?.label ?? null,
        language,
        quality,
        hotwords: settings.hotwords,
      });
      void navigate({ to: "/record" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "The recording could not be started.");
      setStarting(false);
    }
  };

  return (
    <AppShell>
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-8">
        {captureError ? (
          <p
            role="status"
            className="mb-4 rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-warning"
          >
            {captureError}
          </p>
        ) : null}
        <Button asChild variant="ghost" size="sm" className="-ml-2 mb-4">
          <Link to="/">
            <ArrowLeft className="size-4" aria-hidden />
            Meetings
          </Link>
        </Button>

        <h1 className="text-2xl font-semibold tracking-tight">New recording</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Check your audio before you start. Transcription runs locally once the meeting ends.
        </p>

        <div className="mt-6 space-y-5">
          <section className="rounded-lg border border-border bg-card p-4 shadow-card">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="meeting-title">Meeting title</Label>
                <Input
                  id="meeting-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Weekly product review"
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="meeting-template">Template</Label>
                <Select value={templateId} onValueChange={setTemplateId}>
                  <SelectTrigger id="meeting-template" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(templates.data ?? []).map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </section>

          <section className="rounded-lg border border-border bg-card p-4 shadow-card">
            <h2 className="text-sm font-semibold">What should Tara capture?</h2>
            <div
              className="mt-3 grid gap-2 sm:grid-cols-3"
              role="radiogroup"
              aria-label="Capture mode"
            >
              {MODES.map((m) => {
                const Icon = m.icon;
                const active = mode === m.value;
                return (
                  <button
                    key={m.value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setMode(m.value)}
                    className={cn(
                      "rounded-md border p-3 text-left transition-colors",
                      active
                        ? "border-ring bg-accent/20"
                        : "border-border hover:border-ring/50 hover:bg-muted/60",
                    )}
                  >
                    <Icon className="size-4" aria-hidden />
                    <span className="mt-2 block text-sm font-medium">{m.label}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {m.description}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="mt-4 flex items-start gap-2 rounded-md bg-muted p-3 text-xs text-muted-foreground">
              <Headphones className="mt-0.5 size-4 shrink-0" aria-hidden />
              <p>
                <strong className="font-medium text-foreground">Using a headset?</strong> System
                audio captures the other participants as your computer plays them; your microphone
                captures you. With a headset the two stay cleanly separated, which keeps speaker
                names accurate.
              </p>
            </div>

            {needsMic ? (
              <div className="mt-4 grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
                <div className="min-w-0 space-y-1.5">
                  <Label htmlFor="mic-device">Microphone</Label>
                  <Select value={deviceId ?? ""} onValueChange={setDeviceId}>
                    <SelectTrigger id="mic-device" className="w-full">
                      <SelectValue placeholder="Select a microphone" />
                    </SelectTrigger>
                    <SelectContent>
                      {devices.map((d) => (
                        <SelectItem key={d.deviceId} value={d.deviceId}>
                          {d.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void refreshDevices()}
                  aria-label="Refresh microphone list"
                  className="min-h-11"
                >
                  <RefreshCw className="size-4" aria-hidden />
                  Refresh
                </Button>
              </div>
            ) : null}

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <LevelMeter
                label="Microphone level"
                level={levels.microphone}
                active={needsMic}
                hint={needsMic ? "Speak normally — the bars should move." : undefined}
              />
              <div className="space-y-1.5">
                <span className="block text-xs font-medium">System audio</span>
                <div
                  className={cn(
                    "flex h-6 items-center gap-2 rounded-md border px-2 text-xs",
                    !needsSystem
                      ? "border-border bg-muted text-muted-foreground"
                      : systemReady === true
                        ? "border-success/30 bg-success/10 text-success"
                        : systemReady === false
                          ? "border-destructive/30 bg-destructive/10 text-destructive"
                          : "border-border bg-muted text-muted-foreground",
                  )}
                >
                  {!needsSystem
                    ? "Not in use"
                    : systemReady === true
                      ? "Loopback ready"
                      : systemReady === false
                        ? "Loopback unavailable"
                        : "Checking…"}
                </div>
                <LevelMeter label="Output level" level={levels.system} active={needsSystem} />
              </div>
            </div>
          </section>

          <section className="rounded-lg border border-border bg-card p-4 shadow-card">
            <h2 className="mb-3 text-sm font-semibold">Transcription</h2>
            <TranscriptionControls
              idPrefix="preflight"
              language={language}
              quality={quality}
              onLanguageChange={setLanguage}
              onQualityChange={setQuality}
            />
          </section>

          <ModelReadinessNotice />

          <div className="flex items-start gap-2 rounded-md border border-border bg-card p-3 text-xs text-muted-foreground">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
            <p>
              Please tell the other participants that you are recording. Audio is written only to{" "}
              <span className="font-mono">{settings.audioPath}</span> on this computer.
            </p>
          </div>

          {error ? (
            <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <Button size="lg" disabled={!ready || starting} onClick={() => void handleStart()}>
              <Mic className="size-4" aria-hidden />
              {starting ? "Starting…" : "Start recording"}
            </Button>
            {!ready ? (
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <Info className="size-3.5" aria-hidden />
                {title.trim().length === 0
                  ? "Add a meeting title to continue."
                  : needsMic && !deviceId
                    ? "Select a microphone to continue."
                    : "Waiting for system audio to become available."}
              </span>
            ) : null}
          </div>
        </div>
      </main>
    </AppShell>
  );
}

function ModelReadinessNotice() {
  return (
    <div className="flex items-start gap-2 rounded-md border border-border bg-muted/50 p-3 text-xs text-muted-foreground">
      <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
      <p>
        Recording does not wait for Whisper. If the selected model is not cached, Tara queues this
        meeting while it downloads the model once for future offline use.
      </p>
    </div>
  );
}
