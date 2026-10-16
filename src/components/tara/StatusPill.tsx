import { AlertTriangle, CheckCircle2, Clock, Loader2 } from "lucide-react";
import type { MeetingStatus } from "@/lib/taraTypes";
import { cn } from "@/lib/utils";

const MAP = {
  complete: {
    label: "Complete",
    icon: CheckCircle2,
    className: "border-success/30 bg-success/10 text-success",
  },
  processing: {
    label: "Processing",
    icon: Loader2,
    className: "border-ring/30 bg-accent/25 text-foreground",
  },
  queued: {
    label: "Queued",
    icon: Clock,
    className: "border-border bg-muted text-muted-foreground",
  },
  failed: {
    label: "Failed",
    icon: AlertTriangle,
    className: "border-destructive/30 bg-destructive/10 text-destructive",
  },
} as const;

export function StatusPill({ status, className }: { status: MeetingStatus; className?: string }) {
  const config = MAP[status];
  const Icon = config.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium",
        config.className,
        className,
      )}
    >
      <Icon className={cn("size-3.5", status === "processing" && "animate-spin")} aria-hidden />
      {config.label}
    </span>
  );
}
