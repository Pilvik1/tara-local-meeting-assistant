import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { CalendarDays, Clock3, LibraryBig, Mic, Plug, Search, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/tara/AppShell";
import { EmptyState } from "@/components/tara/EmptyState";
import { PrivacyBadge } from "@/components/tara/PrivacyBadge";
import { StatusPill } from "@/components/tara/StatusPill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate, formatDuration } from "@/lib/format";
import { getHealth, getTemplates, listMeetings } from "@/lib/taraApi";
import type { MeetingStatus } from "@/lib/taraTypes";
import { hasSeenOnboarding } from "@/lib/settingsStore";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Meetings — Tara" },
      {
        name: "description",
        content:
          "Tara records, transcribes and summarises your meetings locally on Windows. Browse, search and review every recording.",
      },
      { property: "og:title", content: "Meetings — Tara" },
      {
        property: "og:description",
        content: "Private, local-first meeting recording and transcription for Windows.",
      },
    ],
  }),
  component: MeetingLibrary,
});

const FILTERS: { value: MeetingStatus | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "complete", label: "Complete" },
  { value: "processing", label: "Processing" },
  { value: "failed", label: "Failed" },
];

function MeetingLibrary() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<MeetingStatus | "all">("all");
  const [showOnboarding, setShowOnboarding] = useState(false);

  useEffect(() => {
    setShowOnboarding(!hasSeenOnboarding());
  }, []);

  const health = useQuery({ queryKey: ["health"], queryFn: getHealth, retry: false });
  const templates = useQuery({ queryKey: ["templates"], queryFn: getTemplates, retry: false });
  const meetings = useQuery({
    queryKey: ["meetings", query, status],
    queryFn: () => listMeetings({ query, status }),
    retry: false,
  });

  const templateName = useMemo(() => {
    const map = new Map((templates.data ?? []).map((t) => [t.id, t.name]));
    return (id: string) => map.get(id) ?? id;
  }, [templates.data]);

  const offline = health.isError;

  return (
    <AppShell>
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
        <header className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight">Meetings</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Recorded and transcribed on this computer. Transcription runs after the meeting ends.
            </p>
          </div>
          <Button asChild size="lg" className="shrink-0">
            <Link to="/new">
              <Mic className="size-4" aria-hidden />
              New recording
            </Link>
          </Button>
        </header>

        {showOnboarding ? (
          <div className="mt-6 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-4 shadow-card">
            <p className="min-w-0 flex-1 text-sm">
              First time here? A 60-second tour covers privacy, the first model download and headset
              setup.
            </p>
            <Button asChild variant="outline" size="sm">
              <Link to="/onboarding">Take the tour</Link>
            </Button>
          </div>
        ) : null}

        {offline ? (
          <div className="mt-6 flex items-start gap-3 rounded-lg border border-warning/30 bg-warning/10 p-4">
            <Plug className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
            <div className="min-w-0 text-sm">
              <p className="font-medium text-foreground">Tara's local service isn't responding</p>
              <p className="mt-0.5 text-muted-foreground">
                Recordings already on disk are safe. Retry once the service has finished starting.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => void health.refetch()}>
              Retry
            </Button>
          </div>
        ) : health.data && health.data.warnings.length > 0 ? (
          <p className="mt-6 rounded-lg border border-border bg-card p-3 text-xs text-muted-foreground">
            {health.data.warnings[0]}
          </p>
        ) : null}

        <div className="mt-6 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
          <div className="relative min-w-0">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search meetings"
              aria-label="Search meetings"
              className="pl-9"
            />
          </div>
          <div
            className="flex shrink-0 gap-1 rounded-md border border-border bg-card p-1"
            role="group"
            aria-label="Filter by status"
          >
            {FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => setStatus(f.value)}
                aria-pressed={status === f.value}
                className={cn(
                  "rounded px-3 py-1.5 text-sm transition-colors",
                  status === f.value
                    ? "bg-secondary font-medium text-secondary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <section aria-label="Meeting list" className="mt-5 space-y-3">
          {meetings.isLoading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-28 w-full rounded-lg" />
            ))
          ) : meetings.isError ? (
            <EmptyState
              icon={TriangleAlert}
              title="Meetings couldn't be loaded"
              description={
                meetings.error instanceof Error
                  ? meetings.error.message
                  : "Something went wrong reading the local library."
              }
              action={
                <Button variant="outline" onClick={() => void meetings.refetch()}>
                  Try again
                </Button>
              }
            />
          ) : (meetings.data ?? []).length === 0 ? (
            <EmptyState
              icon={LibraryBig}
              title={query || status !== "all" ? "No meetings match" : "No meetings yet"}
              description={
                query || status !== "all"
                  ? "Try a different search term or clear the filter."
                  : "Start a recording and Tara will transcribe it locally once the meeting ends."
              }
              action={
                query || status !== "all" ? (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setQuery("");
                      setStatus("all");
                    }}
                  >
                    Clear filters
                  </Button>
                ) : (
                  <Button asChild>
                    <Link to="/new">
                      <Mic className="size-4" aria-hidden />
                      New recording
                    </Link>
                  </Button>
                )
              }
            />
          ) : (
            <ul className="space-y-3">
              {(meetings.data ?? []).map((meeting) => (
                <li key={meeting.id}>
                  <Link
                    to="/meeting/$meetingId"
                    params={{ meetingId: meeting.id }}
                    className="block rounded-lg border border-border bg-card p-4 shadow-card transition-colors hover:border-ring/50"
                  >
                    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
                      <h2 className="truncate text-base font-semibold text-foreground">
                        {meeting.title}
                      </h2>
                      <StatusPill status={meeting.status} className="shrink-0" />
                    </div>
                    <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                      {meeting.summarySnippet}
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1.5">
                        <CalendarDays className="size-3.5" aria-hidden />
                        {formatDate(meeting.createdAt)}
                      </span>
                      <span className="inline-flex items-center gap-1.5 tabular">
                        <Clock3 className="size-3.5" aria-hidden />
                        {formatDuration(meeting.durationSeconds)}
                      </span>
                      <span className="rounded-full bg-muted px-2 py-0.5">
                        {templateName(meeting.templateId)}
                      </span>
                      {meeting.summaryKind ? <PrivacyBadge kind={meeting.summaryKind} /> : null}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </AppShell>
  );
}
