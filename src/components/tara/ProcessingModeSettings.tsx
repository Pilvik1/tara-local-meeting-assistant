import { Cloud, ShieldCheck } from "lucide-react";

/** The current Tara backend supports local processing only. */
export function ProcessingModeSettings() {
  return (
    <div className="space-y-2">
      <div className="rounded-lg border border-success/30 bg-success/5 p-3">
        <p className="flex items-center gap-2 text-sm font-medium">
          <ShieldCheck className="size-4 text-success" aria-hidden />
          Fully local
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Audio, transcription and analysis stay on this computer. Tara never silently falls back
          to a cloud provider.
        </p>
      </div>
      <div className="rounded-lg border border-border bg-muted/40 p-3 opacity-70" aria-disabled>
        <p className="flex items-center gap-2 text-sm font-medium">
          <Cloud className="size-4" aria-hidden />
          External providers — not configured
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Provider credentials and external processing are not supported by this Tara build. No data
          can leave the device through this UI.
        </p>
      </div>
    </div>
  );
}
