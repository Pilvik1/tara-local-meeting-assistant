import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, Info } from "lucide-react";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/tara/AppShell";
import { ModelManager } from "@/components/tara/ModelManager";
import { ProcessingModeSettings } from "@/components/tara/ProcessingModeSettings";
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
import { hasElectronBridge } from "@/lib/audioStorageAdapter";
import { useSettings } from "@/lib/settingsStore";
import {
  API_BASE,
  USE_MOCK_API,
  getBackendSettings,
  getHealth,
  patchBackendSettings,
  settingsPatch,
} from "@/lib/taraApi";
import type { CaptureMode, TranscriptionLanguage, TranscriptionQuality } from "@/lib/taraTypes";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Tara" },
      {
        name: "description",
        content:
          "Audio defaults, transcription language and quality, local storage paths, privacy status and diagnostics for Tara.",
      },
      { property: "og:title", content: "Settings — Tara" },
      {
        property: "og:description",
        content: "Configure Tara's local recording and transcription.",
      },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const [settings, setSettings] = useSettings();
  const [hotwordText, setHotwordText] = useState(settings.hotwords.join(", "));
  const queryClient = useQueryClient();
  const [devices, setDevices] = useState<AudioInputDevice[]>([]);
  const health = useQuery({ queryKey: ["health"], queryFn: getHealth, retry: false });
  const backendSettings = useQuery({
    queryKey: ["settings"],
    queryFn: getBackendSettings,
    retry: false,
  });
  const saveBackendSettings = useMutation({
    mutationFn: patchBackendSettings,
    onSuccess: (updated) => queryClient.setQueryData(["settings"], updated),
  });

  useEffect(() => {
    void getAudioCaptureAdapter().listMicrophones().then(setDevices).catch(() => setDevices([]));
  }, []);

  const language = backendSettings.data?.transcription_language ?? settings.language;
  const quality: TranscriptionQuality = backendSettings.data
    ? backendSettings.data.transcription_model === "small"
      ? "fast"
      : "best"
    : settings.quality;
  const saveTranscription = (patch: {
    language?: TranscriptionLanguage;
    quality?: TranscriptionQuality;
    hotwords?: string[];
  }) => {
    const next = { ...settings, ...patch };
    setSettings(patch);
    const raw = settingsPatch(next);
    queryClient.setQueryData(["settings"], raw);
    saveBackendSettings.mutate(raw);
  };

  useEffect(() => {
    if (backendSettings.data) {
      setHotwordText(backendSettings.data.transcription_hotwords.join(", "));
    }
  }, [backendSettings.data]);

  return (
    <AppShell>
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-8">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          These defaults apply to new recordings. Existing meetings keep the settings they were
          recorded with.
        </p>

        <div className="mt-6 space-y-5">
          <section className="rounded-lg border border-border bg-card p-4 shadow-card">
            <h2 className="text-sm font-semibold">Audio</h2>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="default-mode">Default capture mode</Label>
                <Select
                  value={settings.defaultCaptureMode}
                  onValueChange={(v) => setSettings({ defaultCaptureMode: v as CaptureMode })}
                >
                  <SelectTrigger id="default-mode" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="microphone">Microphone</SelectItem>
                    <SelectItem value="system">System audio</SelectItem>
                    <SelectItem value="both">Both</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="default-device">Default microphone</Label>
                <Select
                  value={settings.defaultMicrophoneDeviceId ?? devices[0]?.deviceId ?? ""}
                  onValueChange={(v) => setSettings({ defaultMicrophoneDeviceId: v })}
                >
                  <SelectTrigger id="default-device" className="w-full">
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
            </div>
          </section>

          <section className="rounded-lg border border-border bg-card p-4 shadow-card">
            <h2 className="mb-3 text-sm font-semibold">Transcription</h2>
            <TranscriptionControls
              idPrefix="settings"
              language={language}
              quality={quality}
              onLanguageChange={(value) => saveTranscription({ language: value })}
              onQualityChange={(value) => saveTranscription({ quality: value })}
            />
            <p className="mt-3 text-xs text-muted-foreground">
              Model selected: {quality === "fast" ? "small" : "large-v3-turbo"}. Whisper weights
              download automatically on first transcription and are reused offline.
            </p>
            <div className="mt-3 space-y-1.5">
              <Label htmlFor="hotwords">Names and vocabulary</Label>
              <Input
                id="hotwords"
                value={hotwordText}
                onChange={(event) => setHotwordText(event.target.value)}
                onBlur={(event) =>
                  saveTranscription({
                    hotwords: event.target.value
                      .split(",")
                      .map((word) => word.trim())
                      .filter(Boolean),
                  })
                }
                placeholder="Tara, company names, acronyms"
              />
              <p className="text-xs text-muted-foreground">
                Comma-separated hints improve recognition of names and specialised terms.
              </p>
            </div>
            {saveBackendSettings.isError ? (
              <p className="mt-2 text-xs text-destructive">Could not save transcription settings.</p>
            ) : null}
          </section>

          <section className="rounded-lg border border-border bg-card p-4 shadow-card">
            <h2 className="text-sm font-semibold">Models</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              The local intelligence model is required for summaries that understand context. It is
              downloaded once, then works fully offline; basic extraction remains available without it.
            </p>
            <ModelManager className="mt-4" />
          </section>

          <section className="rounded-lg border border-border bg-card p-4 shadow-card">
            <h2 className="text-sm font-semibold">Processing and privacy</h2>
            <p className="mt-1 mb-4 text-xs text-muted-foreground">
              Review where transcription and summarisation happen. Each meeting keeps its processing
              provenance so the history remains accurate.
            </p>
            <ProcessingModeSettings />
          </section>

          <section className="rounded-lg border border-border bg-card p-4 shadow-card">
            <h2 className="text-sm font-semibold">Storage</h2>
            <div className="mt-3 space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="data-path">Data folder</Label>
                <Input
                  id="data-path"
                  value={health.data?.storagePath ?? settings.storagePath}
                  readOnly
                  placeholder="Set by the Tara desktop app"
                  className="font-mono text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="audio-path">Audio folder</Label>
                <Input
                  id="audio-path"
                  value={health.data?.audioPath ?? settings.audioPath}
                  readOnly
                  placeholder="Set by the Tara desktop app"
                  className="font-mono text-xs"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Integration required: opening these folders needs a desktop bridge method that is
                not part of the declared <code>window.tara</code> contract.
              </p>
            </div>
          </section>

          <section className="rounded-lg border border-border bg-card p-4 shadow-card">
            <h2 className="text-sm font-semibold">Diagnostics</h2>
            <dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2">
              {[
                ["App version", health.data?.version ?? "—"],
                [
                  "Local service",
                  health.isError ? "Not responding" : health.data?.ok ? "Running" : "Checking…",
                ],
                ["Service address", API_BASE],
                ["Electron bridge", hasElectronBridge() ? "Connected" : "Not detected (browser)"],
                ["Data source", USE_MOCK_API ? "Mock data (preview)" : "Local API"],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="flex items-baseline justify-between gap-3 border-b border-border/60 pb-1.5"
                >
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="truncate text-xs font-medium" title={value}>
                    {value}
                  </dd>
                </div>
              ))}
            </dl>

            {health.isError ? (
              <p className="mt-3 flex items-start gap-2 rounded-md bg-warning/10 p-2 text-xs text-warning">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                The local service isn't answering yet. Recordings on disk are unaffected.
              </p>
            ) : (health.data?.warnings ?? []).length > 0 ? (
              <ul className="mt-3 space-y-1.5">
                {(health.data?.warnings ?? []).map((w) => (
                  <li
                    key={w}
                    className="flex items-start gap-2 rounded-md bg-muted p-2 text-xs text-muted-foreground"
                  >
                    <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                    {w}
                  </li>
                ))}
              </ul>
            ) : null}

            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => void health.refetch()}
            >
              Run checks again
            </Button>
          </section>
        </div>
      </main>
    </AppShell>
  );
}
