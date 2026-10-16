import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Download, HardDrive, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { formatBytes } from "@/lib/format";
import {
  deleteModel,
  downloadModel,
  getModelStorage,
  listModels,
  MODEL_MANAGEMENT_AVAILABLE,
} from "@/lib/taraApi";
import type { ModelInfo, ModelKind } from "@/lib/taraTypes";

export function useModels() {
  return useQuery({
    queryKey: ["models"],
    queryFn: listModels,
    retry: false,
    enabled: MODEL_MANAGEMENT_AVAILABLE,
    refetchInterval: (query) =>
      (query.state.data ?? []).some((m) => m.status === "downloading" || m.status === "verifying")
        ? 900
        : false,
  });
}

interface ModelManagerProps {
  /** Limit the list to one kind of model. */
  kind?: ModelKind | undefined;
  /** Hide the storage summary (used inside onboarding). */
  showStorage?: boolean | undefined;
  className?: string | undefined;
}

const KIND_LABEL: Record<ModelKind, string> = {
  transcription: "Transcription models",
  summarisation: "Local summary models",
};

const KIND_HINT: Record<ModelKind, string> = {
  transcription:
    "Turns recorded audio into text on this computer. At least one model must be ready before a recording can be transcribed.",
  summarisation:
    "Required for context-aware summaries. Without it, Tara only extracts explicit decisions and commitments.",
};

export function ModelManager(props: ModelManagerProps) {
  if (!MODEL_MANAGEMENT_AVAILABLE) {
    return (
      <div className={props.className} aria-disabled="true">
        <p className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            <strong className="font-medium text-foreground">Integration required.</strong> Model
            downloads, disk usage and readiness are not connected to the Tara service in this build.
            This area is UI scaffolding only.
          </span>
        </p>
      </div>
    );
  }
  return <ModelManagerPanel {...props} />;
}

function ModelManagerPanel({ kind, showStorage = true, className }: ModelManagerProps) {
  const queryClient = useQueryClient();
  const models = useModels();
  const storage = useQuery({
    queryKey: ["model-storage"],
    queryFn: getModelStorage,
    retry: false,
    enabled: showStorage && MODEL_MANAGEMENT_AVAILABLE,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["models"] });
    void queryClient.invalidateQueries({ queryKey: ["model-storage"] });
  };

  const start = useMutation({ mutationFn: downloadModel, onSuccess: invalidate });
  const remove = useMutation({ mutationFn: deleteModel, onSuccess: invalidate });

  const kinds: ModelKind[] = kind ? [kind] : ["transcription", "summarisation"];
  const all = models.data ?? [];

  return (
    <div className={className}>
      {models.isPending ? (
        <div className="space-y-2">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : models.isError ? (
        <p className="flex items-start gap-2 rounded-md bg-warning/10 p-3 text-xs text-warning">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          Tara can't list installed models while the local service is unavailable. Models already on
          disk are unaffected.
        </p>
      ) : (
        <div className="space-y-6">
          {kinds.map((k) => {
            const group = all.filter((m) => m.kind === k);
            if (group.length === 0) return null;
            return (
              <section key={k}>
                {!kind ? (
                  <>
                    <h3 className="text-sm font-semibold">{KIND_LABEL[k]}</h3>
                    <p className="mt-1 mb-3 text-xs text-muted-foreground">{KIND_HINT[k]}</p>
                  </>
                ) : null}
                <ul className="space-y-2">
                  {group.map((model) => (
                    <li key={model.id}>
                      <ModelRow
                        model={model}
                        busy={
                          (start.isPending && start.variables === model.id) ||
                          (remove.isPending && remove.variables === model.id)
                        }
                        onDownload={() => start.mutate(model.id)}
                        onDelete={() => remove.mutate(model.id)}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      {remove.isError ? (
        <p className="mt-3 text-xs text-destructive">{(remove.error as Error).message}</p>
      ) : null}
      {start.isError ? (
        <p className="mt-3 text-xs text-destructive">{(start.error as Error).message}</p>
      ) : null}

      {showStorage && storage.data ? (
        <p className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
          <HardDrive className="size-3.5 shrink-0" aria-hidden />
          <span>{formatBytes(storage.data.usedBytes)} used by models</span>
          <span aria-hidden>·</span>
          {storage.data.freeBytes > 0 ? (
            <>
              <span>{formatBytes(storage.data.freeBytes)} free on this drive</span>
              <span aria-hidden>·</span>
            </>
          ) : null}
          <span className="font-mono">{storage.data.modelsPath}</span>
        </p>
      ) : null}
    </div>
  );
}

interface ModelRowProps {
  model: ModelInfo;
  busy: boolean;
  onDownload: () => void;
  onDelete: () => void;
}

function ModelRow({ model, busy, onDownload, onDelete }: ModelRowProps) {
  const downloading = model.status === "downloading" || model.status === "verifying";

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
            {model.name}
            {model.recommended ? (
              <span className="rounded-full bg-accent/40 px-2 py-0.5 text-[11px] font-medium text-foreground">
                Recommended
              </span>
            ) : null}
            {model.bundled ? (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                Included with Tara
              </span>
            ) : null}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{model.description}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {formatBytes(model.sizeBytes)} · {model.speedHint} · {model.languages}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {model.status === "ready" ? (
            <>
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-success">
                <CheckCircle2 className="size-3.5" aria-hidden />
                Ready
              </span>
              {!model.bundled ? (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={onDelete}
                  aria-label={`Remove ${model.name}`}
                >
                  <Trash2 className="size-4" aria-hidden />
                  Remove
                </Button>
              ) : null}
            </>
          ) : downloading ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
              Downloading
            </span>
          ) : (
            <Button size="sm" disabled={busy} onClick={onDownload}>
              {busy ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Download className="size-4" aria-hidden />
              )}
              Download
            </Button>
          )}
        </div>
      </div>

      {downloading ? (
        <div className="mt-3">
          <Progress value={model.progress ?? undefined} className="h-1.5" />
          <p className="mt-1.5 text-xs text-muted-foreground">
            {model.status === "verifying"
              ? "Verifying download…"
              : model.progress === null
                ? "Downloading… (progress unavailable)"
                : `Downloading ${model.progress}% · ${formatBytes(model.downloadedBytes)} of ${formatBytes(model.sizeBytes)}`}{" "}
            — you can keep using Tara while this runs.
          </p>
        </div>
      ) : null}

      {model.status === "error" && model.error ? (
        <p className="mt-2 flex items-start gap-2 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {model.error}
        </p>
      ) : null}

      {model.status === "ready" && model.installPath ? (
        <p
          className="mt-2 truncate font-mono text-[11px] text-muted-foreground"
          title={model.installPath}
        >
          {model.installPath}
        </p>
      ) : null}
    </div>
  );
}
