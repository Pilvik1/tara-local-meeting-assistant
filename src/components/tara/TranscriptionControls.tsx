import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { TranscriptionLanguage, TranscriptionQuality } from "@/lib/taraTypes";

export const LANGUAGE_OPTIONS: { value: TranscriptionLanguage; label: string }[] = [
  { value: "auto", label: "Auto-detect" },
  { value: "no", label: "Norwegian" },
  { value: "en", label: "English" },
  { value: "mixed", label: "Mixed Norwegian / English" },
];

export const QUALITY_OPTIONS: {
  value: TranscriptionQuality;
  label: string;
  hint: string;
}[] = [
  {
    value: "fast",
    label: "Fast",
    hint: "Small model. Quickest, less accurate on names and numbers.",
  },
  { value: "best", label: "Best", hint: "Large-v3-turbo. Recommended for accurate meetings; uses more disk and memory." },
];

interface TranscriptionControlsProps {
  language: TranscriptionLanguage;
  quality: TranscriptionQuality;
  onLanguageChange: (value: TranscriptionLanguage) => void;
  onQualityChange: (value: TranscriptionQuality) => void;
  onRetranscribe?: () => void;
  busy?: boolean;
  idPrefix?: string;
}

export function TranscriptionControls({
  language,
  quality,
  onLanguageChange,
  onQualityChange,
  onRetranscribe,
  busy = false,
  idPrefix = "tc",
}: TranscriptionControlsProps) {
  const qualityHint = QUALITY_OPTIONS.find((q) => q.value === quality)?.hint;

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-language`}>Language</Label>
        <Select
          value={language}
          onValueChange={(v) => onLanguageChange(v as TranscriptionLanguage)}
        >
          <SelectTrigger id={`${idPrefix}-language`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LANGUAGE_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-quality`}>Transcription quality</Label>
        <Select value={quality} onValueChange={(v) => onQualityChange(v as TranscriptionQuality)}>
          <SelectTrigger id={`${idPrefix}-quality`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {QUALITY_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <p className="text-xs text-muted-foreground sm:col-span-2">
        {qualityHint}{" "}
        {language === "auto"
          ? "Choosing the actual language is usually faster and more accurate than auto-detect."
          : "The selected language is passed directly to Whisper for faster, more reliable decoding."}
      </p>

      {onRetranscribe ? (
        <div className="sm:col-span-2">
          <Button type="button" variant="outline" onClick={onRetranscribe} disabled={busy}>
            <RefreshCw className={busy ? "size-4 animate-spin" : "size-4"} aria-hidden />
            {busy ? "Starting…" : "Retranscribe"}
          </Button>
          <p className="mt-1.5 text-xs text-muted-foreground">
            Re-runs transcription locally from the stored audio using these settings. The existing
            transcript is replaced when it finishes.
          </p>
        </div>
      ) : null}
    </div>
  );
}
