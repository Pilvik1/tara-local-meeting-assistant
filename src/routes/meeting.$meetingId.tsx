import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute, useParams } from "@tanstack/react-router";
import {
  ArrowLeft,
  Bookmark,
  Check,
  Cloud,
  FileDown,
  Mail,
  MessageSquareQuote,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Search,
  Send,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/tara/AppShell";
import { DiagnosticsPanel } from "@/components/tara/DiagnosticsPanel";
import { ModelManager, useModels } from "@/components/tara/ModelManager";
import { DataLocationNote, PrivacyBadge } from "@/components/tara/PrivacyBadge";
import { ProcessingPanel } from "@/components/tara/ProcessingPanel";
import { StatusPill } from "@/components/tara/StatusPill";
import { TranscriptionControls } from "@/components/tara/TranscriptionControls";
import { WaveformPlayer } from "@/components/tara/WaveformPlayer";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { formatBytes, formatDateTime, formatDuration } from "@/lib/format";
import { useSettings } from "@/lib/settingsStore";
import {
  askMeeting,
  emailMeeting,
  exportMeeting,
  getMeeting,
  getProcessingState,
  getTemplates,
  reanalyzeMeeting,
  reprocessMeeting,
  updateMeeting,
} from "@/lib/taraApi";
import type {
  ActionItem,
  ChatAnswer,
  ExportFormat,
  Meeting,
  TranscriptLine,
} from "@/lib/taraTypes";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/meeting/$meetingId")({
  head: () => ({
    meta: [
      { title: "Meeting — Tara" },
      {
        name: "description",
        content:
          "Summary, transcript, actions and notes for a locally recorded meeting, with playback, diagnostics and meeting Q&A.",
      },
      { property: "og:title", content: "Meeting — Tara" },
      {
        property: "og:description",
        content: "Review a Tara meeting: summary, transcript, action items and cited answers.",
      },
    ],
  }),
  component: MeetingDetail,
});

function MeetingDetail() {
  const { meetingId } = useParams({ from: "/meeting/$meetingId" });
  const queryClient = useQueryClient();
  const [settings] = useSettings();

  const meeting = useQuery({
    queryKey: ["meeting", meetingId],
    queryFn: () => getMeeting(meetingId),
    retry: false,
  });
  const templates = useQuery({ queryKey: ["templates"], queryFn: getTemplates, retry: false });
  const processing = useQuery({
    queryKey: ["processing", meetingId],
    queryFn: () => getProcessingState(meetingId),
    retry: false,
    enabled: meeting.data ? meeting.data.status !== "complete" : false,
    refetchInterval: (query) =>
      query.state.data &&
      ["queued", "transcribing", "analysing", "downloading_model"].includes(query.state.data.stage)
        ? 3000
        : false,
  });

  useEffect(() => {
    if (processing.data?.stage === "complete") {
      void queryClient.invalidateQueries({ queryKey: ["meeting", meetingId] });
      void queryClient.invalidateQueries({ queryKey: ["meetings"] });
    }
  }, [processing.data?.stage, queryClient, meetingId]);

  const [title, setTitle] = useState("");
  const [editingTitle, setEditingTitle] = useState(false);
  const [seekRequest, setSeekRequest] = useState<{ seconds: number; nonce: number } | null>(null);
  const [language, setLanguage] = useState(settings.language);
  const [quality, setQuality] = useState(settings.quality);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (meeting.data) {
      setTitle(meeting.data.title);
      setLanguage(meeting.data.language);
      setQuality(meeting.data.quality);
    }
  }, [meeting.data]);

  const save = useMutation({
    mutationFn: (patch: Parameters<typeof updateMeeting>[1]) => updateMeeting(meetingId, patch),
    onSuccess: (updated) => queryClient.setQueryData(["meeting", meetingId], updated),
  });

  const reprocess = useMutation({
    mutationFn: () =>
      reprocessMeeting(meetingId, {
        language,
        quality,
        hotwords: settings.hotwords,
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData(["meeting", meetingId], updated);
      void queryClient.invalidateQueries({ queryKey: ["processing", meetingId] });
      void queryClient.invalidateQueries({ queryKey: ["meetings"] });
      setNotice(
        "Processing restarted. You can leave this screen — it continues in the background.",
      );
    },
  });

  const reanalyze = useMutation({
    mutationFn: () => reanalyzeMeeting(meetingId),
    onSuccess: (updated) => {
      queryClient.setQueryData(["meeting", meetingId], updated);
      void queryClient.invalidateQueries({ queryKey: ["processing", meetingId] });
      void queryClient.invalidateQueries({ queryKey: ["meetings"] });
      setNotice("Intelligent analysis started from the saved transcript. Audio is not being retranscribed.");
    },
    onError: (error) => {
      setNotice(error instanceof Error ? error.message : "Could not start intelligent analysis.");
    },
  });

  const templateName =
    templates.data?.find((t) => t.id === meeting.data?.templateId)?.name ??
    meeting.data?.templateId ??
    "—";

  const handleExport = async (format: ExportFormat) => {
    try {
      const blob = await exportMeeting(meetingId, format);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${title || meetingId}.${format === "actions" || format === "markdown" ? "md" : format}`;
      a.click();
      URL.revokeObjectURL(url);
      setNotice(`Exported as ${format}.`);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Export failed.");
    }
  };

  const handleEmail = async () => {
    try {
      const result = await emailMeeting(meetingId);
      setNotice(`Summary sent to ${result.toEmail}.`);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Email failed.");
    }
  };

  if (meeting.isLoading) {
    return (
      <AppShell>
        <main className="mx-auto w-full max-w-4xl flex-1 space-y-4 px-6 py-8">
          <Skeleton className="h-9 w-64" />
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-72 w-full" />
        </main>
      </AppShell>
    );
  }

  if (meeting.isError || !meeting.data) {
    return (
      <AppShell>
        <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-8">
          <div className="rounded-lg border border-destructive/30 bg-card p-6">
            <h1 className="flex items-center gap-2 text-base font-semibold text-destructive">
              <TriangleAlert className="size-4" aria-hidden />
              This meeting couldn't be opened
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {meeting.error instanceof Error ? meeting.error.message : "Unknown error."}
            </p>
            <div className="mt-4 flex gap-2">
              <Button variant="outline" onClick={() => void meeting.refetch()}>
                Try again
              </Button>
              <Button asChild variant="ghost">
                <Link to="/">Back to meetings</Link>
              </Button>
            </div>
          </div>
        </main>
      </AppShell>
    );
  }

  const data = meeting.data;
  const isComplete = data.status === "complete";
  const state = processing.data;

  return (
    <AppShell>
      <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-8">
        <Button asChild variant="ghost" size="sm" className="-ml-2 mb-4">
          <Link to="/">
            <ArrowLeft className="size-4" aria-hidden />
            Meetings
          </Link>
        </Button>

        <header className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4">
          <div className="min-w-0">
            {editingTitle ? (
              <div className="flex items-center gap-2">
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  aria-label="Meeting title"
                  className="text-lg"
                  autoFocus
                />
                <Button
                  size="icon"
                  aria-label="Save title"
                  onClick={() => {
                    save.mutate({ title });
                    setEditingTitle(false);
                  }}
                >
                  <Check className="size-4" />
                </Button>
              </div>
            ) : (
              <div className="flex min-w-0 items-center gap-2">
                <h1 className="truncate text-2xl font-semibold tracking-tight">{data.title}</h1>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Edit meeting title"
                  onClick={() => setEditingTitle(true)}
                >
                  <Pencil className="size-4" />
                </Button>
              </div>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
              <span>{formatDateTime(data.createdAt)}</span>
              <span className="tabular">{formatDuration(data.durationSeconds)}</span>
              <span className="rounded-full bg-muted px-2 py-0.5">{templateName}</span>
              <span>{data.transcriptionEngine}</span>
              <StatusPill status={data.status} />
            </div>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                aria-label="More actions"
                className="min-h-11 min-w-11"
              >
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Export</DropdownMenuLabel>
              {(["markdown", "docx", "pdf", "actions"] as ExportFormat[]).map((format) => (
                <DropdownMenuItem key={format} onSelect={() => void handleExport(format)}>
                  <FileDown className="size-4" aria-hidden />
                  {format === "actions" ? "Action items (CSV)" : format.toUpperCase()}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => reanalyze.mutate()}>
                <RefreshCw className="size-4" aria-hidden />
                Re-analyse saved transcript
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void handleEmail()}>
                <Mail className="size-4" aria-hidden />
                Email summary
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        {notice ? (
          <p
            role="status"
            className="mt-4 rounded-md border border-border bg-card p-3 text-xs text-muted-foreground"
          >
            {notice}
          </p>
        ) : null}

        {!isComplete && state ? (
          <div className="mt-6">
            <ProcessingPanel
              state={state}
              retrying={reprocess.isPending}
              onRetry={() => reprocess.mutate()}
            />
          </div>
        ) : null}

        <div className="mt-6 space-y-5">
          <WaveformPlayer
            peaks={data.waveformPeaks}
            durationSeconds={data.durationSeconds}
            audioUrl={data.audioUrl}
            meetingId={data.id}
            audioSources={data.audioSources}
            markers={data.notes}
            seekRequest={seekRequest}
          />

          {isComplete ? (
            <Tabs defaultValue="summary">
              <TabsList>
                <TabsTrigger value="summary">Summary</TabsTrigger>
                <TabsTrigger value="transcript">Transcript</TabsTrigger>
                <TabsTrigger value="actions">Actions</TabsTrigger>
                <TabsTrigger value="notes">Notes</TabsTrigger>
              </TabsList>

              <TabsContent value="summary" className="mt-4">
                <SummaryTab
                  meeting={data}
                  onReanalyze={() => reanalyze.mutate()}
                  reanalyzing={reanalyze.isPending}
                />
              </TabsContent>
              <TabsContent value="transcript" className="mt-4">
                <TranscriptTab
                  meeting={data}
                  onSeek={(seconds) => setSeekRequest({ seconds, nonce: Date.now() })}
                  onSave={(transcript) => save.mutate({ transcript })}
                />
              </TabsContent>
              <TabsContent value="actions" className="mt-4">
                <ActionsTab
                  meeting={data}
                  onSeek={(seconds) => setSeekRequest({ seconds, nonce: Date.now() })}
                  onSave={(actions) => save.mutate({ actions })}
                />
              </TabsContent>
              <TabsContent value="notes" className="mt-4">
                <NotesTab
                  meeting={data}
                  onSeek={(seconds) => setSeekRequest({ seconds, nonce: Date.now() })}
                />
              </TabsContent>
            </Tabs>
          ) : null}

          {isComplete ? (
            <AskThisMeeting
              meetingId={meetingId}
              onSeek={(s) => setSeekRequest({ seconds: s, nonce: Date.now() })}
            />
          ) : null}

          <section className="rounded-lg border border-border bg-card p-4 shadow-card">
            <h2 className="mb-3 text-sm font-semibold">Transcription settings</h2>
            <TranscriptionControls
              idPrefix="meeting"
              language={language}
              quality={quality}
              onLanguageChange={setLanguage}
              onQualityChange={setQuality}
              onRetranscribe={() => reprocess.mutate()}
              busy={reprocess.isPending}
            />
          </section>

          <DiagnosticsPanel diagnostics={data.diagnostics} />
        </div>
      </main>
    </AppShell>
  );
}

/* ------------------------------- Summary ------------------------------- */

function SummaryTab({
  meeting,
  onReanalyze,
  reanalyzing,
}: {
  meeting: Meeting;
  onReanalyze: () => void;
  reanalyzing: boolean;
}) {
  const models = useModels();
  const intelligenceReady = (models.data ?? []).some(
    (model) => model.kind === "summarisation" && model.status === "ready",
  );
  const summary = meeting.summary;
  if (!summary) {
    return (
      <p className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
        No summary has been generated for this meeting yet.
      </p>
    );
  }

  const lists: [string, string[]][] = [
    ["Discussion points", summary.discussionPoints],
    ["Outcomes", summary.outcomes],
    ["Decisions", summary.decisions],
    ["Risks", summary.risks],
  ];

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-border bg-card p-5 shadow-card">
        <div className="flex flex-wrap items-center gap-2">
          <PrivacyBadge kind={summary.kind} />
          <span className="text-xs text-muted-foreground">{summary.generatedBy}</span>
        </div>
        <DataLocationNote stayedLocal={summary.dataStayedLocal} />

        <h2 className="mt-4 text-sm font-semibold">Executive summary</h2>
        <p className="mt-1.5 text-sm leading-relaxed">{summary.executiveSummary}</p>

        <h3 className="mt-4 text-sm font-semibold">Purpose</h3>
        <p className="mt-1.5 text-sm text-muted-foreground">{summary.purpose}</p>

        {summary.kind === "basic_local" ? (
          <div className="mt-4 rounded-md border border-border bg-muted/60 p-3">
            <div className="flex items-start gap-3">
              <Cloud className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-foreground">This is not an AI summary.</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Basic extraction only detects explicit decisions and commitments. Install Tara's
                  local intelligence model once for grounded summaries that understand context;
                  meeting data still stays on this computer.
                </p>
              </div>
            </div>
            <ModelManager kind="summarisation" showStorage={false} className="mt-3" />
            {intelligenceReady ? (
              <div className="mt-3">
                <Button size="sm" onClick={onReanalyze} disabled={reanalyzing}>
                  <RefreshCw className={reanalyzing ? "size-4 animate-spin" : "size-4"} aria-hidden />
                  {reanalyzing ? "Starting…" : "Generate intelligent summary"}
                </Button>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Uses the saved transcript. Whisper will not run again.
                </p>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      <div className="grid gap-4 sm:grid-cols-2">
        {lists.map(([label, items]) => (
          <section key={label} className="rounded-lg border border-border bg-card p-4 shadow-card">
            <h3 className="text-sm font-semibold">{label}</h3>
            {items.length ? (
              <ul className="mt-2 space-y-1.5">
                {items.map((item) => (
                  <li key={item} className="flex gap-2 text-sm text-muted-foreground">
                    <span aria-hidden className="mt-2 size-1 shrink-0 rounded-full bg-border" />
                    <span className="min-w-0">{item}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">
                {label === "Actions"
                  ? "No action points identified."
                  : label === "Decisions"
                    ? "No decisions identified."
                    : label === "Risks"
                      ? "No risks identified."
                      : label === "Outcomes"
                        ? "No outcomes identified."
                        : "No substantive discussion points identified."}
              </p>
            )}
          </section>
        ))}
      </div>

      <section className="rounded-lg border border-border bg-card p-4 shadow-card">
        <h3 className="text-sm font-semibold">Topics</h3>
        <ul className="mt-2 flex flex-wrap gap-2">
          {summary.topics.map((topic) => (
            <li
              key={topic}
              className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground"
            >
              {topic}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/* ------------------------------ Transcript ------------------------------ */

function TranscriptTab({
  meeting,
  onSeek,
  onSave,
}: {
  meeting: Meeting;
  onSeek: (seconds: number) => void;
  onSave: (lines: TranscriptLine[]) => void;
}) {
  const [lines, setLines] = useState<TranscriptLine[]>(meeting.transcript);
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => setLines(meeting.transcript), [meeting.transcript]);

  const filtered = useMemo(
    () =>
      query.trim()
        ? lines.filter(
            (l) =>
              l.text.toLowerCase().includes(query.toLowerCase()) ||
              l.speaker.toLowerCase().includes(query.toLowerCase()),
          )
        : lines,
    [lines, query],
  );

  const patch = (id: string, changes: Partial<TranscriptLine>) => {
    const next = lines.map((l) => (l.id === id ? { ...l, ...changes } : l));
    setLines(next);
    onSave(next);
  };

  if (lines.length === 0) {
    return (
      <p className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
        No transcript is available for this meeting.
      </p>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-card">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search the transcript"
          aria-label="Search the transcript"
          className="pl-9"
        />
      </div>

      <ol className="mt-4 space-y-3">
        {filtered.map((line) => (
          <li key={line.id} className="grid grid-cols-[auto_minmax(0,1fr)] gap-3">
            <button
              type="button"
              onClick={() => onSeek(line.start)}
              className="tabular h-fit rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground hover:text-foreground"
              aria-label={`Play from ${formatDuration(line.start)}`}
            >
              {formatDuration(line.start)}
            </button>
            <div className="min-w-0">
              {editingId === line.id ? (
                <div className="space-y-2">
                  <Input
                    value={line.speaker}
                    aria-label="Speaker name"
                    onChange={(e) => patch(line.id, { speaker: e.target.value })}
                    className="h-8 max-w-48 text-xs"
                  />
                  <Textarea
                    value={line.text}
                    aria-label="Transcript text"
                    onChange={(e) => patch(line.id, { text: e.target.value })}
                    rows={3}
                  />
                  <Button size="sm" onClick={() => setEditingId(null)}>
                    Done
                  </Button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setEditingId(line.id)}
                  className="w-full rounded text-left hover:bg-muted/60"
                  aria-label={`Edit line from ${line.speaker}`}
                >
                  <span className="block text-xs font-medium text-foreground">{line.speaker}</span>
                  <span className="block text-sm text-muted-foreground">{line.text}</span>
                </button>
              )}
            </div>
          </li>
        ))}
      </ol>
      {filtered.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          Nothing in the transcript matches “{query}”.
        </p>
      ) : null}
    </div>
  );
}

/* -------------------------------- Actions -------------------------------- */

function ActionsTab({
  meeting,
  onSeek,
  onSave,
}: {
  meeting: Meeting;
  onSeek: (seconds: number) => void;
  onSave: (actions: ActionItem[]) => void;
}) {
  const [items, setItems] = useState<ActionItem[]>(meeting.actions);
  useEffect(() => setItems(meeting.actions), [meeting.actions]);

  const patch = (id: string, changes: Partial<ActionItem>) => {
    const next = items.map((a) => (a.id === id ? { ...a, ...changes } : a));
    setItems(next);
    onSave(next);
  };

  if (items.length === 0) {
    return (
      <p className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
        No action points identified.
      </p>
    );
  }

  return (
    <ul className="space-y-3">
      {items.map((action) => (
        <li key={action.id} className="rounded-lg border border-border bg-card p-4 shadow-card">
          <Textarea
            value={action.task}
            aria-label="Task"
            rows={2}
            onChange={(e) => patch(action.id, { task: e.target.value })}
          />
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <label className="space-y-1 text-xs">
              <span className="text-muted-foreground">Owner</span>
              <Input
                value={action.owner}
                onChange={(e) => patch(action.id, { owner: e.target.value })}
              />
            </label>
            <label className="space-y-1 text-xs">
              <span className="text-muted-foreground">Deadline</span>
              <Input
                type="date"
                value={action.deadline ?? ""}
                onChange={(e) => patch(action.id, { deadline: e.target.value || null })}
              />
            </label>
            <label className="space-y-1 text-xs">
              <span className="text-muted-foreground">Priority</span>
              <select
                value={action.priority}
                onChange={(e) =>
                  patch(action.id, { priority: e.target.value as ActionItem["priority"] })
                }
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </label>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span
              className={cn(
                "rounded-full px-2 py-0.5",
                action.confidence > 0.85 ? "bg-success/10 text-success" : "bg-muted",
              )}
            >
              {Math.round(action.confidence * 100)}% confidence
            </span>
            <button
              type="button"
              onClick={() => onSeek(action.quoteTimestamp)}
              className="tabular rounded bg-muted px-1.5 py-0.5 hover:text-foreground"
            >
              {formatDuration(action.quoteTimestamp)}
            </button>
          </div>
          <blockquote className="mt-2 border-l-2 border-border pl-3 text-sm italic text-muted-foreground">
            “{action.quote}”
          </blockquote>
        </li>
      ))}
    </ul>
  );
}

/* --------------------------------- Notes --------------------------------- */

function NotesTab({ meeting, onSeek }: { meeting: Meeting; onSeek: (seconds: number) => void }) {
  if (meeting.notes.length === 0) {
    return (
      <p className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
        You didn't add notes or bookmarks during this recording.
      </p>
    );
  }
  return (
    <ul className="space-y-2">
      {meeting.notes.map((note) => (
        <li
          key={note.id}
          className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-3 rounded-lg border border-border bg-card p-3 shadow-card"
        >
          <button
            type="button"
            onClick={() => onSeek(note.timestamp)}
            className="tabular rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground hover:text-foreground"
            aria-label={`Play from ${formatDuration(note.timestamp)}`}
          >
            {formatDuration(note.timestamp)}
          </button>
          <span className="min-w-0 text-sm">
            {note.kind === "bookmark" ? (
              <Bookmark className="mr-1.5 inline size-3.5 text-muted-foreground" aria-hidden />
            ) : null}
            {note.text}
          </span>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------ Ask meeting ------------------------------ */

function AskThisMeeting({
  meetingId,
  onSeek,
}: {
  meetingId: string;
  onSeek: (seconds: number) => void;
}) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<ChatAnswer | null>(null);
  const ask = useMutation({
    mutationFn: (q: string) => askMeeting(meetingId, q),
    onSuccess: setAnswer,
  });

  return (
    <section className="rounded-lg border border-border bg-card p-4 shadow-card">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <MessageSquareQuote className="size-4" aria-hidden />
        Ask this meeting
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Answers are drawn from this transcript only and always show the quote they came from.
      </p>

      <form
        className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (question.trim()) ask.mutate(question.trim());
        }}
      >
        <Input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="e.g. What did we decide about the release?"
          aria-label="Ask a question about this meeting"
        />
        <Button type="submit" disabled={!question.trim() || ask.isPending}>
          <Send className="size-4" aria-hidden />
          {ask.isPending ? "Asking…" : "Ask"}
        </Button>
      </form>

      {ask.isError ? (
        <p role="alert" className="mt-3 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {ask.error instanceof Error ? ask.error.message : "The question could not be answered."}
        </p>
      ) : null}

      {answer ? (
        <div className="mt-4 rounded-md bg-muted/60 p-3">
          <p className="text-sm">{answer.answer}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            {answer.usedExternalAi
              ? "Answered using the external AI provider."
              : "Answered locally on this computer."}
          </p>
          <ul className="mt-3 space-y-2">
            {answer.citations.map((c, i) => (
              <li key={i} className="rounded-md border border-border bg-card p-2.5">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{c.speaker}</span>
                  <button
                    type="button"
                    onClick={() => onSeek(c.timestamp)}
                    className="tabular rounded bg-muted px-1.5 py-0.5 hover:text-foreground"
                  >
                    {formatDuration(c.timestamp)}
                  </button>
                </div>
                <blockquote className="mt-1 text-sm italic text-muted-foreground">
                  “{c.quote}”
                </blockquote>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

export { formatBytes };
