import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Clock, Download, Headphones, Mic, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { markOnboardingSeen } from "@/lib/settingsStore";

export const Route = createFileRoute("/onboarding")({
  head: () => ({
    meta: [
      { title: "Welcome to Tara" },
      {
        name: "description",
        content:
          "How Tara records meetings privately on your computer: local transcription, first model download and headset capture.",
      },
      { property: "og:title", content: "Welcome to Tara" },
      {
        property: "og:description",
        content: "A short introduction to private, local meeting recording with Tara.",
      },
    ],
  }),
  component: Onboarding,
});

const STEPS = [
  {
    icon: ShieldCheck,
    title: "Everything stays on this computer",
    body: "Audio, transcripts and summaries are written to your local disk. This Tara build has no external processing path, so nothing is uploaded.",
  },
  {
    icon: Clock,
    title: "Transcription happens after the meeting",
    body: "Tara records first and transcribes afterwards. You'll see honest progress — Queued, Transcribing, Analysing — and you can leave the screen while it runs.",
  },
  {
    icon: Download,
    title: "Choose your transcription model",
    body: "Best uses Whisper large-v3-turbo and is recommended for accuracy. Its weights download automatically during the first transcription, then remain available offline. Fast uses the smaller model and can be selected in Settings.",
    models: true,
  },
  {
    icon: Headphones,
    title: "Use a headset for the best result",
    body: "System audio captures the other participants. Your microphone captures you. With a headset the two never bleed into each other, so speakers stay separated.",
  },
  {
    icon: Mic,
    title: "Microphone permission",
    body: "Windows will ask once for microphone access. Tara only listens while you are recording — the level meter shows exactly when it is active.",
  },
] as const;

function Onboarding() {
  const navigate = useNavigate();
  const [index, setIndex] = useState(0);
  const step = STEPS[index]!;
  const Icon = step.icon;
  const last = index === STEPS.length - 1;
  const showModels = "models" in step && step.models === true;

  const finish = () => {
    markOnboardingSeen();
    void navigate({ to: "/" });
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface px-6 py-10">
      <div
        className={`w-full rounded-xl border border-border bg-card p-8 shadow-raised ${
          showModels ? "max-w-2xl" : "max-w-lg"
        }`}
      >
        <span className="grid size-11 place-items-center rounded-full bg-accent/30 text-foreground">
          <Icon className="size-5" aria-hidden />
        </span>
        <h1 className="mt-5 text-xl font-semibold tracking-tight">{step.title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{step.body}</p>

        {showModels ? (
          <>
            <div className="mt-5 rounded-md border border-border bg-muted/50 p-3 text-xs text-muted-foreground">
              Recording can start immediately. If Whisper is not cached yet, the meeting waits in
              the processing queue while Tara downloads and verifies it locally. Exact download
              percentage is not available from the current backend.
            </div>
          </>
        ) : null}

        <div className="mt-8 flex items-center gap-2">
          <ol className="flex flex-1 items-center gap-1.5" aria-label="Progress">
            {STEPS.map((s, i) => (
              <li
                key={s.title}
                aria-current={i === index ? "step" : undefined}
                className={
                  i === index
                    ? "h-1.5 w-6 rounded-full bg-foreground"
                    : "h-1.5 w-3 rounded-full bg-border"
                }
              />
            ))}
          </ol>
          <Button variant="ghost" onClick={finish}>
            Skip
          </Button>
          {index > 0 ? (
            <Button variant="outline" onClick={() => setIndex((i) => i - 1)}>
              Back
            </Button>
          ) : null}
          <Button onClick={() => (last ? finish() : setIndex((i) => i + 1))}>
            {last ? "Get started" : "Next"}
          </Button>
        </div>
      </div>
    </main>
  );
}
