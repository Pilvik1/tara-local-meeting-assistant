import { Cloud, Laptop } from "lucide-react";
import type { SummaryKind } from "@/lib/taraTypes";
import { cn } from "@/lib/utils";

export function PrivacyBadge({ kind, className }: { kind: SummaryKind; className?: string }) {
  const local = kind !== "ai_external";
  const Icon = local ? Laptop : Cloud;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium",
        local
          ? "border-success/30 bg-success/10 text-success"
          : "border-warning/30 bg-warning/10 text-warning",
        className,
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      {kind === "ai_local"
        ? "AI summary — fully local"
        : kind === "basic_local"
          ? "Basic extraction (no AI) — fully local"
          : "AI summary — external model"}
    </span>
  );
}

export function DataLocationNote({ stayedLocal }: { stayedLocal: boolean }) {
  return (
    <p className="text-xs text-muted-foreground">
      {stayedLocal
        ? "Transcript and audio stayed on this computer. Nothing was uploaded."
        : "Transcript text was sent to the configured external AI provider. Audio stayed on this computer."}
    </p>
  );
}
