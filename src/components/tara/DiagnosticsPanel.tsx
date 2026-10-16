import { AlertTriangle } from "lucide-react";
import { formatBytes } from "@/lib/format";
import type { RecordingDiagnostics } from "@/lib/taraTypes";

const MODE_LABEL = {
  microphone: "Microphone only",
  system: "System audio only",
  both: "Microphone + system audio",
} as const;

export function DiagnosticsPanel({ diagnostics }: { diagnostics: RecordingDiagnostics }) {
  const rows: [string, string][] = [
    ["Capture mode", MODE_LABEL[diagnostics.captureMode]],
    ["Microphone", diagnostics.microphoneDevice ?? "Not captured"],
    ["System audio", diagnostics.systemAudioDevice ?? "Not captured"],
    ["Sample rate", diagnostics.sampleRate ? `${(diagnostics.sampleRate / 1000).toFixed(1)} kHz` : "Not reported"],
    ["Audio tracks", String(diagnostics.channels)],
    ["Audio file", diagnostics.fileSizeBytes ? formatBytes(diagnostics.fileSizeBytes) : "Stored locally"],
    ["Stored at", diagnostics.filePath || "Tara recordings directory"],
    ["Dropped frames", String(diagnostics.droppedFrames)],
  ];

  return (
    <section
      aria-label="Recording diagnostics"
      className="rounded-lg border border-border bg-card p-4 shadow-card"
    >
      <h3 className="text-sm font-semibold text-foreground">Recording diagnostics</h3>
      <dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div
            key={label}
            className="flex min-w-0 items-baseline justify-between gap-3 border-b border-border/60 pb-1.5"
          >
            <dt className="shrink-0 text-xs text-muted-foreground">{label}</dt>
            <dd className="truncate text-xs font-medium text-foreground" title={value}>
              {value}
            </dd>
          </div>
        ))}
      </dl>

      {diagnostics.warnings.length > 0 ? (
        <ul className="mt-3 space-y-1.5">
          {diagnostics.warnings.map((w) => (
            <li
              key={w}
              className="flex items-start gap-2 rounded-md bg-warning/10 p-2 text-xs text-warning"
            >
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>{w}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">No capture problems were detected.</p>
      )}
    </section>
  );
}
