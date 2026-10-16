export type ProcessingStatus = 'queued' | 'transcribing' | 'analyzing' | 'done' | 'failed'

export type AnalysisSource = 'pending' | 'local_llm' | 'basic' | 'openai' | 'heuristic'

export type Confidence = 'high' | 'medium' | 'low'

export type MeetingTemplate = 'general' | 'one_on_one' | 'recruiting' | 'sales' | 'product' | 'board_update'

export type TranscriptLine = {
  speaker: string
  start: number
  end: number
  text: string
  source?: string
  confidence?: number
  words?: Array<{ word: string; start: number; end: number; confidence?: number }>
}

export type TranscriptionModel = 'small' | 'large-v3-turbo'
export type TranscriptionLanguage = 'auto' | 'no' | 'en' | 'mixed'

export type TranscriptionSettings = {
  model: TranscriptionModel
  language: TranscriptionLanguage
  hotwords: string[]
}

export type TranscriptionSourceMetadata = {
  source: string
  model: string
  requested_language: string
  detected_language?: string
  language_probability?: number
  duration?: number
  duration_after_vad?: number
  average_log_probability?: number
  segments: number
}

export type MeetingSummary = {
  executive_summary: string
  purpose: string
  key_discussion_points: string[]
  outcomes: string[]
  evidence?: Array<{ source: string; timestamp: number; quote: string }>
}

export type Decision = {
  text: string
  confidence: Confidence
  timestamp?: number
  source?: string
  quote?: string
}

export type ActionItem = {
  task: string
  owner: string
  deadline: string
  priority: Confidence
  confidence?: Confidence
  timestamp?: number
  source?: string
  quote?: string
  uncertainty?: string
}

export type Note = {
  id: string
  timestamp: number
  text: string
}

export type BookmarkItem = {
  id: string
  timestamp: number
  label: string
}

export type Meeting = {
  id: number
  title: string
  date: string
  duration_seconds: number
  participants: string[]
  transcript: TranscriptLine[]
  summary: MeetingSummary
  decisions: Decision[]
  action_items: ActionItem[]
  risks: string[]
  topics: string[]
  notes: Note[]
  bookmarks: BookmarkItem[]
  audio_file?: string | null
  audio_sources?: Record<string, string>
  transcription_settings?: TranscriptionSettings
  transcription_metadata?: { sources?: TranscriptionSourceMetadata[] }
  processing_status: ProcessingStatus
  processing_error?: string | null
  analysis_source: AnalysisSource
  updated_at?: string | null
  analysis_template: MeetingTemplate
  analysis_version: number
}

export type ChatCitation = {
  timestamp: number
  speaker: string
  quote: string
}

export type HealthResponse = {
  transcription?: {
    faster_whisper: boolean
    ffmpeg: boolean
    model: string
    device?: string
    compute_type?: string
    language: string
    word_timestamps?: boolean
    vad_filter?: boolean
    idle_unload_seconds?: number
    model_loaded?: boolean
  }
  email?: {
    configured: boolean
    host?: string | null
    port: number
    from_email?: string | null
    profiles: EmailProfile[]
  }
  analysis?: {
    mode: 'local_llm' | 'basic_extraction'
    external_ai: boolean
    model?: string | null
    runtime_available?: boolean
    model_installed?: boolean
    model_verified?: boolean
    model_size_bytes?: number | null
    install_state?: 'not_installed' | 'downloading' | 'installed' | 'failed'
    install_error?: string | null
    last_error?: string | null
    privacy?: string
  }
  security?: {
    host: string
    web_auth_enabled: boolean
    externally_bound: boolean
    warnings: string[]
    storage?: {
      encrypted: boolean
      data_dir: string
      recordings_dir: string
    }
  }
}

export type AppSettings = {
  transcription_model: TranscriptionModel
  transcription_language: TranscriptionLanguage
  transcription_hotwords: string[]
}

export type EmailProfile = {
  id: string
  label: string
  auto_send: boolean
  configured: boolean
}

export const emptySummary: MeetingSummary = {
  executive_summary: 'Record or open a meeting to generate meeting intelligence.',
  purpose: '',
  key_discussion_points: [],
  outcomes: [],
}

export function formatTime(seconds: number) {
  const safeSeconds = Math.max(0, Math.floor(seconds))
  const minutes = Math.floor(safeSeconds / 60)
  const remainingSeconds = safeSeconds % 60
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`
}

export function searchableMeetingText(meeting: Meeting) {
  return [
    meeting.title,
    meeting.participants.join(' '),
    meeting.summary.executive_summary,
    meeting.summary.purpose,
    meeting.summary.key_discussion_points.join(' '),
    meeting.summary.outcomes.join(' '),
    meeting.transcript.map((line) => line.text).join(' '),
    meeting.action_items.map((item) => [item.task, item.owner, item.deadline, item.quote].join(' ')).join(' '),
    meeting.decisions.map((decision) => [decision.text, decision.quote].join(' ')).join(' '),
    meeting.risks.join(' '),
    meeting.topics.join(' '),
    meeting.analysis_template,
    meeting.processing_status,
  ].join(' ').toLowerCase()
}

export function filterMeetings(meetings: Meeting[], query: string) {
  const needle = query.trim().toLowerCase()
  if (!needle) return meetings
  return meetings.filter((meeting) => searchableMeetingText(meeting).includes(needle))
}

export function sortMeetingsByDate(meetings: Meeting[], direction: 'newest' | 'oldest' = 'newest') {
  return [...meetings].sort((left, right) => {
    const delta = new Date(right.date).getTime() - new Date(left.date).getTime()
    return direction === 'newest' ? delta : -delta
  })
}

export function meetingStatusLabel(meeting: Meeting) {
  if (meeting.processing_status === 'failed') {
    return meeting.processing_error ? `failed: ${meeting.processing_error}` : 'failed'
  }
  return `${meeting.processing_status} · ${meeting.analysis_source}`
}
