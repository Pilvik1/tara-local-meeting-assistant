import { cn } from "@/lib/utils";

interface LevelMeterProps {
  label: string;
  /** 0..1 */
  level: number;
  active: boolean;
  hint?: string | undefined;
  className?: string | undefined;
}

const SEGMENTS = 24;

export function LevelMeter({ label, level, active, hint, className }: LevelMeterProps) {
  const filled = active ? Math.round(level * SEGMENTS) : 0;
  const percent = Math.round((active ? level : 0) * 100);

  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-foreground">{label}</span>
        <span className="tabular text-xs text-muted-foreground">
          {active ? `${percent}%` : "not in use"}
        </span>
      </div>
      <div
        role="meter"
        aria-label={`${label} input level`}
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        className="flex h-6 items-stretch gap-[3px] rounded-md border border-border bg-muted p-1"
      >
        {Array.from({ length: SEGMENTS }).map((_, i) => (
          <span
            key={i}
            className={cn(
              "flex-1 rounded-[2px] transition-colors duration-75",
              i < filled
                ? i > SEGMENTS - 4
                  ? "bg-destructive"
                  : i > SEGMENTS - 8
                    ? "bg-accent"
                    : "bg-primary"
                : "bg-border/60",
            )}
          />
        ))}
      </div>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
