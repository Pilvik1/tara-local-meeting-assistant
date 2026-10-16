import { AlertTriangle, Download, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { ProcessingState } from "@/lib/taraTypes";
import { cn } from "@/lib/utils";

const STAGES = [
  { key: "queued", label: "Queued" },
  { key: "transcribing", label: "Transcribing" },
  { key: "analysing", label: "Analysing" },
  { key: "complete", label: "Complete" },
] as const;

function stageIndex(stage: ProcessingState["stage"]): number {
  if (stage === "downloading_model") return 1;
  const found = STAGES.findIndex((s) => s.key === stage);
  return found === -1 ? 0 : found;
}

export function ProcessingPanel({
  state,
  onRetry,
  retrying,
}: {
  state: ProcessingState;
  onRetry: () => void;
  retrying?: boolean;
}) {
  const active = stageIndex(state.stage);
  const failed = state.stage === "failed";
  const downloading = state.stage === "downloading_model";

  if (failed) {
    return (
      <section className="rounded-lg border border-destructive/30 bg-card p-6 shadow-card">
        <h2 className="flex items-center gap-2 text-base font-semibold text-destructive">
          <AlertTriangle className="size-4" aria-hidden />
          Processing failed
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {state.error ?? "Transcription stopped before it finished."}
        </p>
        <Button className="mt-4" onClick={onRetry} disabled={retrying}>
          {retrying ? "Starting…" : "Retry processing"}
        </Button>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-border bg-card p-6 shadow-card">
      <h2 className="flex items-center gap-2 text-base font-semibold">
        {downloading ? (
          <Download className="size-4 text-foreground" aria-hidden />
        ) : state.stage === "analysing" ? (
          <Sparkles className="size-4" aria-hidden />
        ) : (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        )}
        {downloading ? "Downloading the speech model" : state.message || "Processing"}
      </h2>

      <p className="mt-2 text-sm text-muted-foreground">
        {downloading
          ? "This happens once. The model is about 1.5 GB and is stored on this computer — after this, transcription works offline."
          : "Transcription runs after the recording has ended. You can leave this screen and come back later; processing continues in the background."}
      </p>

      <ol className="mt-5 grid gap-2 sm:grid-cols-4">
        {STAGES.map((stage, i) => (
          <li
            key={stage.key}
            aria-current={i === active ? "step" : undefined}
            className={cn(
              "rounded-md border px-3 py-2 text-xs",
              i < active
                ? "border-success/30 bg-success/10 text-success"
                : i === active
                  ? "border-ring bg-accent/20 font-medium text-foreground"
                  : "border-border text-muted-foreground",
            )}
          >
            {downloading && stage.key === "transcribing" ? "Downloading model" : stage.label}
          </li>
        ))}
      </ol>

      <div className="mt-5">
        {state.progress === null ? (
          <>
            <div
              className="h-2 w-full overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-label="Processing"
            >
              <div className="h-full w-1/3 animate-[pulse_1.6s_ease-in-out_infinite] rounded-full bg-primary" />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Exact progress isn't available for this step — Tara will update as soon as it can.
            </p>
          </>
        ) : (
          <>
            <Progress value={state.progress} aria-label="Processing progress" />
            <p className="tabular mt-2 text-xs text-muted-foreground">{state.progress}% complete</p>
          </>
        )}
      </div>
    </section>
  );
}
