from __future__ import annotations

import base64
import atexit
import io
import importlib.util
import json
import os
import re
import secrets
import shutil
import smtplib
import sqlite3
import textwrap
import threading
import time
import uuid
import zipfile
from datetime import datetime, timezone
from contextlib import closing
from email.message import EmailMessage
from pathlib import Path
from typing import Any, Literal

from fastapi import BackgroundTasks, FastAPI, File, HTTPException, Request, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from local_intelligence import LocalLlamaRuntime, local_grounded_answer, local_intelligence

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = Path(os.environ.get("TARA_DATA_DIR", ROOT / "data"))
DB_PATH = DATA_DIR / "tara.sqlite3"
RECORDINGS_DIR = DATA_DIR / "recordings"
MODELS_DIR = DATA_DIR / "models"
DIST_DIR = ROOT / "dist"
DEFAULT_WHISPER_MODEL = "large-v3-turbo"
DEFAULT_WHISPER_DEVICE = "cpu"
DEFAULT_WHISPER_COMPUTE_TYPE = "int8"
DEFAULT_WHISPER_IDLE_UNLOAD_SECONDS = 30 * 60
MEETING_TEMPLATES = {
    "general": "General meeting: extract durable decisions, action items, risks, and topics.",
    "one_on_one": "1:1 meeting: emphasize commitments, feedback, blockers, follow-ups, and ownership.",
    "recruiting": "Recruiting interview: emphasize candidate signals, concerns, next steps, and evaluation evidence.",
    "sales": "Sales meeting: emphasize pain points, objections, buying signals, next steps, stakeholders, and timing.",
    "product": "Product meeting: emphasize user problems, decisions, trade-offs, launch risks, and product actions.",
    "board_update": "Board/update meeting: emphasize strategic decisions, metrics, risks, asks, and accountable follow-ups.",
}

_whisper_model: Any | None = None
_whisper_model_key: tuple[str, str, str] | None = None
_whisper_last_used_at = 0.0
_whisper_unload_timer: threading.Timer | None = None
_whisper_lock = threading.Lock()

DATA_DIR.mkdir(parents=True, exist_ok=True)
RECORDINGS_DIR.mkdir(parents=True, exist_ok=True)
MODELS_DIR.mkdir(parents=True, exist_ok=True)
LOCAL_LLM = LocalLlamaRuntime(DATA_DIR)
atexit.register(LOCAL_LLM.stop)

def cors_origins() -> list[str]:
    origins = ["http://127.0.0.1:5173", "http://localhost:5173", "file://", "null"]
    for origin in os.environ.get("TARA_CORS_ORIGINS", "").split(","):
        origin = origin.strip()
        if origin and origin not in origins:
            origins.append(origin)
    return origins


app = FastAPI(title="Tara Local API", version="0.4.1-beta.1")
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def report_security_warnings() -> None:
    diagnostics = security_diagnostics()
    for warning in diagnostics["warnings"]:
        print(f"Tara security warning: {warning}", flush=True)


@app.middleware("http")
async def require_web_auth(request: Request, call_next):
    desktop_token = os.environ.get("TARA_DESKTOP_API_TOKEN")
    if desktop_token:
        if request.method == "OPTIONS":
            return await call_next(request)
        supplied_token = request.headers.get("x-tara-desktop-token", "")
        if secrets.compare_digest(supplied_token, desktop_token):
            return await call_next(request)
        return Response("Desktop authentication required", status_code=401)

    username = os.environ.get("TARA_WEB_USERNAME")
    password = os.environ.get("TARA_WEB_PASSWORD")
    if not username or not password:
        return await call_next(request)

    authorization = request.headers.get("authorization", "")
    authenticated = False
    if authorization.lower().startswith("basic "):
        try:
            decoded = base64.b64decode(authorization.split(" ", 1)[1]).decode("utf-8")
            supplied_username, supplied_password = decoded.split(":", 1)
            authenticated = secrets.compare_digest(supplied_username, username) and secrets.compare_digest(
                supplied_password,
                password,
            )
        except Exception:
            authenticated = False

    if authenticated:
        return await call_next(request)

    return Response(
        "Authentication required",
        status_code=401,
        headers={"WWW-Authenticate": 'Basic realm="Tara"'},
    )


class TranscriptLine(BaseModel):
    speaker: str = "Speaker"
    start: float = 0
    end: float = 0
    text: str
    source: str | None = None
    confidence: float | None = None
    words: list[dict[str, Any]] = Field(default_factory=list)


class Note(BaseModel):
    id: str
    timestamp: float
    text: str


class Bookmark(BaseModel):
    id: str
    timestamp: float
    label: str


class MeetingCreate(BaseModel):
    title: str = "Untitled meeting"
    duration_seconds: int = 0
    participants: list[str] = Field(default_factory=list)
    audio_file: str | None = None
    audio_sources: dict[str, str] = Field(default_factory=dict)
    notes: list[Note] = Field(default_factory=list)
    bookmarks: list[Bookmark] = Field(default_factory=list)
    analysis_template: str = "general"
    transcription_model: Literal["small", "large-v3-turbo"] | None = None
    transcription_language: Literal["auto", "no", "en", "mixed"] | None = None
    transcription_hotwords: list[str] | None = None


class ChatRequest(BaseModel):
    question: str


class MeetingEmailRequest(BaseModel):
    to_email: str | None = None
    profile_id: str | None = None


class MeetingUpdate(BaseModel):
    title: str | None = None
    transcript: list[TranscriptLine] | None = None
    decisions: list[dict[str, Any]] | None = None
    action_items: list[dict[str, Any]] | None = None
    notes: list[Note] | None = None
    bookmarks: list[Bookmark] | None = None
    analysis_template: str | None = None


class ReprocessRequest(BaseModel):
    transcription_model: Literal["small", "large-v3-turbo"] | None = None
    transcription_language: Literal["auto", "no", "en", "mixed"] | None = None
    transcription_hotwords: list[str] | None = None


class SettingsUpdate(BaseModel):
    transcription_model: Literal["small", "large-v3-turbo"] | None = None
    transcription_language: Literal["auto", "no", "en", "mixed"] | None = None
    transcription_hotwords: list[str] | None = None


class TranscriptionError(RuntimeError):
    pass


class MeetingProcessingError(RuntimeError):
    def __init__(self, stage: str, detail: str):
        super().__init__(f"{stage}: {detail}")
        self.stage = stage
        self.detail = detail


def connect() -> sqlite3.Connection:
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def init_db() -> None:
    with closing(connect()) as db:
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS meetings (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              title TEXT NOT NULL,
              date TEXT NOT NULL,
              duration_seconds INTEGER NOT NULL,
              participants TEXT NOT NULL,
              transcript TEXT NOT NULL,
              summary TEXT NOT NULL,
              decisions TEXT NOT NULL,
              action_items TEXT NOT NULL,
              risks TEXT NOT NULL,
              topics TEXT NOT NULL,
              notes TEXT NOT NULL,
              bookmarks TEXT NOT NULL,
              audio_file TEXT
            )
            """
        )
        columns = {row["name"] for row in db.execute("PRAGMA table_info(meetings)").fetchall()}
        migrations = {
            "processing_status": "ALTER TABLE meetings ADD COLUMN processing_status TEXT NOT NULL DEFAULT 'done'",
            "processing_error": "ALTER TABLE meetings ADD COLUMN processing_error TEXT",
            "analysis_source": "ALTER TABLE meetings ADD COLUMN analysis_source TEXT NOT NULL DEFAULT 'heuristic'",
            "updated_at": "ALTER TABLE meetings ADD COLUMN updated_at TEXT",
            "analysis_template": "ALTER TABLE meetings ADD COLUMN analysis_template TEXT NOT NULL DEFAULT 'general'",
            "analysis_version": "ALTER TABLE meetings ADD COLUMN analysis_version INTEGER NOT NULL DEFAULT 1",
            "audio_sources": "ALTER TABLE meetings ADD COLUMN audio_sources TEXT NOT NULL DEFAULT '{}'",
            "transcription_settings": "ALTER TABLE meetings ADD COLUMN transcription_settings TEXT NOT NULL DEFAULT '{}'",
            "transcription_metadata": "ALTER TABLE meetings ADD COLUMN transcription_metadata TEXT NOT NULL DEFAULT '{}'",
        }
        for column, statement in migrations.items():
            if column not in columns:
                db.execute(statement)
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS settings (
              key TEXT PRIMARY KEY,
              value TEXT NOT NULL
            )
            """
        )
        db.commit()


init_db()


def json_load(value: str, fallback: Any) -> Any:
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return fallback


def row_to_meeting(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "title": row["title"],
        "date": row["date"],
        "duration_seconds": row["duration_seconds"],
        "participants": json_load(row["participants"], []),
        "transcript": json_load(row["transcript"], []),
        "summary": json_load(row["summary"], {}),
        "decisions": json_load(row["decisions"], []),
        "action_items": json_load(row["action_items"], []),
        "risks": json_load(row["risks"], []),
        "topics": json_load(row["topics"], []),
        "notes": json_load(row["notes"], []),
        "bookmarks": json_load(row["bookmarks"], []),
        "audio_file": row["audio_file"],
        "audio_sources": json_load(row["audio_sources"], {}) if "audio_sources" in row.keys() else {},
        "transcription_settings": json_load(row["transcription_settings"], {}) if "transcription_settings" in row.keys() else {},
        "transcription_metadata": json_load(row["transcription_metadata"], {}) if "transcription_metadata" in row.keys() else {},
        "processing_status": row["processing_status"],
        "processing_error": row["processing_error"],
        "analysis_source": row["analysis_source"],
        "updated_at": row["updated_at"],
        "analysis_template": row["analysis_template"],
        "analysis_version": row["analysis_version"],
    }


DEFAULT_SETTINGS: dict[str, Any] = {
    "transcription_model": DEFAULT_WHISPER_MODEL,
    "transcription_language": "auto",
    "transcription_hotwords": [],
}


def get_settings() -> dict[str, Any]:
    settings = dict(DEFAULT_SETTINGS)
    with closing(connect()) as db:
        rows = db.execute("SELECT key, value FROM settings").fetchall()
    for row in rows:
        settings[row["key"]] = json_load(row["value"], row["value"])
    return settings


def save_settings(payload: SettingsUpdate) -> dict[str, Any]:
    updates = payload.model_dump(exclude_none=True)
    with closing(connect()) as db:
        for key, value in updates.items():
            db.execute(
                "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                (key, json.dumps(value)),
            )
        db.commit()
    return get_settings()


def transcription_diagnostics() -> dict[str, Any]:
    has_faster_whisper = importlib.util.find_spec("faster_whisper") is not None
    idle_seconds = int(os.environ.get("TARA_WHISPER_IDLE_UNLOAD_SECONDS", str(DEFAULT_WHISPER_IDLE_UNLOAD_SECONDS)))
    settings = get_settings()
    return {
        "faster_whisper": has_faster_whisper,
        "ffmpeg": shutil.which("ffmpeg") is not None,
        "model": os.environ.get("TARA_WHISPER_MODEL", settings["transcription_model"]),
        "device": os.environ.get("TARA_WHISPER_DEVICE", DEFAULT_WHISPER_DEVICE),
        "compute_type": os.environ.get("TARA_WHISPER_COMPUTE_TYPE", DEFAULT_WHISPER_COMPUTE_TYPE),
        "language": os.environ.get("TARA_WHISPER_LANGUAGE", settings["transcription_language"]),
        "word_timestamps": True,
        "vad_filter": True,
        "idle_unload_seconds": idle_seconds,
        "model_loaded": _whisper_model is not None,
        "data_dir": str(DATA_DIR),
        "recordings_dir": str(RECORDINGS_DIR),
        "models_dir": str(MODELS_DIR),
    }


def email_diagnostics() -> dict[str, Any]:
    profiles = email_profiles()
    return {
        "configured": all(
            os.environ.get(name)
            for name in ("TARA_SMTP_HOST", "TARA_SMTP_FROM")
        ),
        "host": os.environ.get("TARA_SMTP_HOST"),
        "port": int(os.environ.get("TARA_SMTP_PORT", "587")),
        "from_email": os.environ.get("TARA_SMTP_FROM"),
        "profiles": [
            {
                "id": profile["id"],
                "label": profile["label"],
                "auto_send": profile["auto_send"],
                "configured": bool(profile["to_email"]),
            }
            for profile in profiles
        ],
    }


def analysis_diagnostics() -> dict[str, Any]:
    return LOCAL_LLM.status()


def security_diagnostics() -> dict[str, Any]:
    host = os.environ.get("TARA_API_HOST", "127.0.0.1")
    web_auth_enabled = bool(os.environ.get("TARA_WEB_USERNAME") and os.environ.get("TARA_WEB_PASSWORD"))
    externally_bound = host not in {"127.0.0.1", "localhost", "::1"}
    warnings = []
    if externally_bound and not web_auth_enabled:
        warnings.append("Backend is bound beyond localhost without TARA_WEB_USERNAME/TARA_WEB_PASSWORD.")
    if "*" in cors_origins():
        warnings.append("CORS allows every origin. Restrict TARA_CORS_ORIGINS for private deployments.")

    return {
        "host": host,
        "web_auth_enabled": web_auth_enabled,
        "externally_bound": externally_bound,
        "cors_origins": cors_origins(),
        "storage": {
            "encrypted": False,
            "data_dir": str(DATA_DIR),
            "recordings_dir": str(RECORDINGS_DIR),
        },
        "warnings": warnings,
    }


def env_truthy(value: str | None) -> bool:
    return str(value or "").lower() in {"1", "true", "yes", "on"}


def email_profiles() -> list[dict[str, Any]]:
    profile_ids = [
        profile.strip()
        for profile in os.environ.get("TARA_EMAIL_PROFILES", "").split(",")
        if profile.strip()
    ]
    profiles = []
    for profile_id in profile_ids:
        key = re.sub(r"[^A-Za-z0-9]+", "_", profile_id).upper()
        label = os.environ.get(f"TARA_EMAIL_PROFILE_{key}_LABEL", profile_id)
        to_email = os.environ.get(f"TARA_EMAIL_PROFILE_{key}_TO")
        profiles.append(
            {
                "id": profile_id,
                "label": label,
                "to_email": to_email,
                "auto_send": env_truthy(os.environ.get(f"TARA_EMAIL_PROFILE_{key}_AUTO_SEND")),
            }
        )
    return profiles


def resolve_email_recipient(payload: MeetingEmailRequest) -> tuple[str, str | None]:
    if payload.profile_id:
        profile = next((item for item in email_profiles() if item["id"] == payload.profile_id), None)
        if not profile:
            raise HTTPException(status_code=404, detail="Email profile was not found")
        if not profile["to_email"]:
            raise HTTPException(status_code=503, detail="Email profile is missing a recipient address")
        return str(profile["to_email"]), str(profile["id"])
    if payload.to_email:
        return payload.to_email, None
    raise HTTPException(status_code=400, detail="Provide to_email or profile_id")


def unload_whisper_model_if_idle() -> None:
    global _whisper_model, _whisper_model_key, _whisper_unload_timer

    idle_seconds = int(os.environ.get("TARA_WHISPER_IDLE_UNLOAD_SECONDS", str(DEFAULT_WHISPER_IDLE_UNLOAD_SECONDS)))
    with _whisper_lock:
        if _whisper_model is not None and time.monotonic() - _whisper_last_used_at >= idle_seconds:
            _whisper_model = None
            _whisper_model_key = None
        _whisper_unload_timer = None


def schedule_whisper_unload() -> None:
    global _whisper_unload_timer

    idle_seconds = int(os.environ.get("TARA_WHISPER_IDLE_UNLOAD_SECONDS", str(DEFAULT_WHISPER_IDLE_UNLOAD_SECONDS)))
    if idle_seconds <= 0:
        return
    if _whisper_unload_timer is not None:
        _whisper_unload_timer.cancel()
    _whisper_unload_timer = threading.Timer(idle_seconds, unload_whisper_model_if_idle)
    _whisper_unload_timer.daemon = True
    _whisper_unload_timer.start()


def get_whisper_model(model_name: str) -> Any:
    global _whisper_model, _whisper_model_key, _whisper_last_used_at

    try:
        from faster_whisper import WhisperModel  # type: ignore
    except ImportError as exc:
        raise TranscriptionError(
            "Audio was saved, but faster-whisper is not installed. "
            "Install it with: python -m pip install faster-whisper"
        ) from exc

    model_name = os.environ.get("TARA_WHISPER_MODEL", model_name)
    device = os.environ.get("TARA_WHISPER_DEVICE", DEFAULT_WHISPER_DEVICE)
    compute_type = os.environ.get("TARA_WHISPER_COMPUTE_TYPE", DEFAULT_WHISPER_COMPUTE_TYPE)
    model_key = (model_name, device, compute_type)

    with _whisper_lock:
        if _whisper_model is None or _whisper_model_key != model_key:
            _whisper_model = WhisperModel(
                model_name,
                device=device,
                compute_type=compute_type,
                cpu_threads=max(2, os.cpu_count() or 4),
                download_root=str(MODELS_DIR / "whisper"),
            )
            _whisper_model_key = model_key
        _whisper_last_used_at = time.monotonic()
        schedule_whisper_unload()
        return _whisper_model


def _transcribe_source(
    audio_path: Path,
    source: str,
    speaker: str,
    settings: dict[str, Any],
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    if not audio_path.exists():
        raise TranscriptionError(f"Audio file was not found: {audio_path}")
    model_name = str(settings.get("model") or DEFAULT_WHISPER_MODEL)
    language = str(settings.get("language") or "auto")
    hotwords = ", ".join(str(word).strip() for word in settings.get("hotwords") or [] if str(word).strip())
    try:
        model = get_whisper_model(model_name)
        transcription_started_at = time.monotonic()
        options: dict[str, Any] = {
            "vad_filter": True,
            # Greedy decoding is materially faster on CPU and, in our real-speech benchmark,
            # produced cleaner punctuation than beam search with previous-text conditioning.
            "beam_size": 1,
            "word_timestamps": True,
            "condition_on_previous_text": False,
        }
        if language in {"no", "en"}:
            options["language"] = language
        elif language == "mixed":
            options["multilingual"] = True
        if hotwords:
            options["hotwords"] = hotwords
        generated, info = model.transcribe(str(audio_path), **options)
        segments = list(generated)
        average_log_probability = (
            sum(float(segment.avg_logprob) for segment in segments) / len(segments) if segments else -99.0
        )
        # If VAD or decoding rejected nearly everything, retry without VAD before declaring audio empty.
        if not segments or average_log_probability < -1.25:
            retry_options = dict(options)
            retry_options["vad_filter"] = False
            retry_options["beam_size"] = 5
            retry_options["condition_on_previous_text"] = False
            retry_generated, retry_info = model.transcribe(str(audio_path), **retry_options)
            retry_segments = list(retry_generated)
            retry_average = (
                sum(float(segment.avg_logprob) for segment in retry_segments) / len(retry_segments)
                if retry_segments
                else -99.0
            )
            if retry_segments and (not segments or retry_average > average_log_probability):
                segments, info, average_log_probability = retry_segments, retry_info, retry_average
        transcription_seconds = time.monotonic() - transcription_started_at
    except Exception as exc:
        raise TranscriptionError(f"Transcription failed for {source}: {exc}") from exc

    transcript = [
        {
            "speaker": speaker,
            "source": source,
            "start": round(segment.start, 2),
            "end": round(segment.end, 2),
            "text": segment.text.strip(),
            "confidence": round(max(0.0, min(1.0, 1.0 + float(segment.avg_logprob))), 3),
            "words": [
                {
                    "word": word.word.strip(),
                    "start": round(word.start, 2),
                    "end": round(word.end, 2),
                    "confidence": round(float(getattr(word, "probability", 0.0)), 3),
                }
                for word in (segment.words or [])
                if word.word.strip()
            ],
        }
        for segment in segments
        if segment.text.strip()
    ]
    metadata = {
        "source": source,
        "model": model_name,
        "requested_language": language,
        "detected_language": getattr(info, "language", None),
        "language_probability": round(float(getattr(info, "language_probability", 0.0)), 4),
        "duration": round(float(getattr(info, "duration", 0.0)), 2),
        "duration_after_vad": round(float(getattr(info, "duration_after_vad", 0.0)), 2),
        "average_log_probability": round(average_log_probability, 4),
        "transcription_seconds": round(transcription_seconds, 2),
        "segments": len(transcript),
    }
    return transcript, metadata


def transcribe_audio(
    audio_file: str | None,
    audio_sources: dict[str, str],
    notes: list[Note],
    settings: dict[str, Any],
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    sources = {key: value for key, value in audio_sources.items() if value}
    if not sources and audio_file:
        sources = {"mixed": audio_file}
    if "microphone" in sources and "system" in sources:
        sources.pop("mixed", None)

    if sources:
        lines: list[dict[str, Any]] = []
        metadata: list[dict[str, Any]] = []
        labels = {"microphone": "You", "system": "Meeting audio", "mixed": "Speaker"}
        for source, path in sources.items():
            source_lines, source_metadata = _transcribe_source(
                Path(path), source, labels.get(source, source.replace("_", " ").title()), settings
            )
            lines.extend(source_lines)
            metadata.append(source_metadata)
        lines.sort(key=lambda line: (float(line.get("start") or 0), float(line.get("end") or 0)))
        if lines:
            return lines, {"sources": metadata}
        raise TranscriptionError("Audio was saved, but no speech was detected in the recording.")

    if notes:
        return [
            {
                "speaker": "User note",
                "source": "note",
                "start": note.timestamp,
                "end": note.timestamp,
                "text": note.text,
            }
            for note in notes
        ], {"sources": [], "notes_only": True}

    return [
        {
            "speaker": "Tara",
            "source": "system",
            "start": 0,
            "end": 0,
            "text": "No transcript text was available. Record audio and install faster-whisper for local transcription.",
        }
    ], {"sources": [], "audio_missing": True}


def nearest_timestamp(text: str, transcript: list[dict[str, Any]]) -> float:
    return nearest_evidence(text, transcript)["timestamp"]


def nearest_evidence(text: str, transcript: list[dict[str, Any]]) -> dict[str, Any]:
    text_words = set(re.findall(r"\w+", text.lower()))
    best_score = 0
    best_line: dict[str, Any] | None = None
    for line in transcript:
        line_words = set(re.findall(r"\w+", str(line.get("text", "")).lower()))
        score = len(text_words & line_words)
        if score > best_score:
            best_score = score
            best_line = line
    if not best_line and transcript:
        best_line = transcript[0]
    return {
        "timestamp": float(best_line.get("start", 0) or 0) if best_line else 0.0,
        "quote": str(best_line.get("text", ""))[:280] if best_line else "",
    }


def normalize_confidence(value: Any, fallback: str = "medium") -> str:
    value = str(value or fallback).lower()
    return value if value in {"high", "medium", "low"} else fallback


def normalize_template(value: str | None) -> str:
    return value if value in MEETING_TEMPLATES else "general"


def infer_owner(text: str) -> str:
    patterns = [
        r"\bowner[:\s]+([A-Z][A-Za-z .'-]{1,40})",
        r"\b([A-Z][A-Za-z .'-]{1,40})\s+(?:will|should|needs? to|to)\b",
    ]
    for pattern in patterns:
        match = re.search(pattern, text)
        if match:
            return match.group(1).strip(" .")
    return "Unclear"


def infer_deadline(text: str) -> str:
    match = re.search(r"\b(?:by|before|until|on)\s+([A-Za-z0-9 ,./-]{2,30})", text, flags=re.IGNORECASE)
    if match:
        return match.group(1).strip(" .")
    return "Unclear"


def normalize_intelligence(payload: dict[str, Any], transcript: list[dict[str, Any]]) -> dict[str, Any]:
    summary = payload.get("summary") if isinstance(payload.get("summary"), dict) else {}
    summary = {
        "executive_summary": str(summary.get("executive_summary") or "No substantive meeting content was available."),
        "purpose": str(summary.get("purpose") or "Unknown"),
        "key_discussion_points": list(summary.get("key_discussion_points") or []),
        "outcomes": list(summary.get("outcomes") or []),
    }

    decisions = []
    for item in payload.get("decisions") or []:
        if isinstance(item, str):
            item = {"text": item}
        text = str(item.get("text") or "").strip()
        if text:
            evidence = nearest_evidence(str(item.get("source") or text), transcript)
            decisions.append(
                {
                    "text": text,
                    "confidence": normalize_confidence(item.get("confidence")),
                    "timestamp": float(item.get("timestamp") or evidence["timestamp"]),
                    "source": item.get("source") or "Transcript-derived",
                    "quote": item.get("quote") or evidence["quote"],
                }
            )

    actions = []
    for item in payload.get("action_items") or []:
        if isinstance(item, str):
            item = {"task": item}
        task = str(item.get("task") or "").strip()
        if task:
            evidence = nearest_evidence(str(item.get("source") or task), transcript)
            actions.append(
                {
                    "task": task,
                    "owner": item.get("owner") or infer_owner(task),
                    "deadline": item.get("deadline") or infer_deadline(task),
                    "priority": normalize_confidence(item.get("priority")),
                    "confidence": normalize_confidence(item.get("confidence")),
                    "timestamp": float(item.get("timestamp") or evidence["timestamp"]),
                    "source": item.get("source") or "Transcript-derived",
                    "quote": item.get("quote") or evidence["quote"],
                    "uncertainty": item.get("uncertainty") or "",
                }
            )

    return {
        "summary": summary,
        "decisions": decisions[:10],
        "action_items": actions[:14],
        "risks": list(payload.get("risks") or [])[:10],
        "topics": list(payload.get("topics") or [])[:10],
    }


def sentences(text: str) -> list[str]:
    return [part.strip() for part in re.split(r"(?<=[.!?])\s+", text) if part.strip()]


def heuristic_intelligence(transcript: list[dict[str, Any]], notes: list[Note], template: str = "general") -> dict[str, Any]:
    raw_parts = [str(line.get("text") or "") for line in transcript] + [note.text for note in notes]
    parts = list(dict.fromkeys(part for text in raw_parts for part in sentences(text)))
    lower_parts = [(part, part.lower()) for part in parts]

    decision_words = (
        "decided", "agreed", "approved", "committed", "decision",
        "bestemte", "besluttet", "ble enige", "vedtok", "vedtatt", "godkjente", "godkjent",
    )
    action_words = (
        "follow up", "owner", "deadline", "todo", "action item",
        "følge opp", "ansvarlig", "frist", "oppgave",
    )
    risk_words = (
        "risk", "blocker", "blocked", "concern", "unclear", "question", "missing", "dependency",
        "risiko", "blokkering", "bekymring", "uklar", "mangler", "avhengighet",
    )
    if template == "sales":
        action_words += ("next step", "pilot", "proposal", "procurement")
        risk_words += ("objection", "budget", "competitor")
    elif template == "recruiting":
        decision_words += ("advance", "reject", "hire", "shortlist")
        risk_words += ("concern", "gap", "reference")
    elif template == "product":
        decision_words += ("ship", "launch", "prioritize", "deprioritize")
        risk_words += ("scope", "usability", "technical debt")

    def contains_phrase(lower: str, phrases: tuple[str, ...]) -> bool:
        return any(re.search(rf"(?<!\w){re.escape(phrase)}(?!\w)", lower) for phrase in phrases)

    def explicit_commitment(part: str, lower: str) -> bool:
        if re.search(
            r"\b(?:will|shall|should|skal|må|bør)\s+(?:not|ikke|just|bare)\b|\bwon't\b",
            lower,
        ):
            return False
        pronoun_commitment = re.search(
            r"\b(?:i|we|he|she|they|jeg|vi|han|hun|de)\s+(?:will|skal)\b",
            lower,
        )
        named_commitment = re.search(r"\b[A-ZÆØÅ][\wÆØÅæøå'-]+\s+(?:will|skal)\b", part)
        return bool(pronoun_commitment or named_commitment or contains_phrase(lower, action_words))

    decisions = [
        {
            "text": part,
            "confidence": "medium",
            "timestamp": nearest_timestamp(part, transcript),
            "source": "Heuristic transcript match",
            "quote": nearest_evidence(part, transcript)["quote"],
        }
        for part, lower in lower_parts
        if contains_phrase(lower, decision_words)
        and not re.search(r"\b(?:not|ikke)\s+(?:agreed|approved|enig|godkjent)\b", lower)
    ][:8]
    actions = [
        {
            "task": part,
            "owner": infer_owner(part),
            "deadline": infer_deadline(part),
            "priority": "medium",
            "confidence": "low",
            "timestamp": nearest_timestamp(part, transcript),
            "source": "Heuristic transcript match",
            "quote": nearest_evidence(part, transcript)["quote"],
            "uncertainty": "Owner/deadline not explicit in transcript.",
        }
        for part, lower in lower_parts
        if explicit_commitment(part, lower)
    ][:10]
    risks = [part for part, lower in lower_parts if contains_phrase(lower, risk_words)][:8]

    evidence_parts = list(
        dict.fromkeys(
            [item["text"] for item in decisions]
            + [item["task"] for item in actions]
            + risks
        )
    )
    body = " ".join(evidence_parts)

    keywords = re.findall(r"\b[^\W\d_][\w-]{3,}\b", body.lower(), flags=re.UNICODE)
    stop = {
        "about", "there", "their", "meeting", "transcript", "should", "would", "could", "local",
        "dette", "denne", "eller", "møte", "møtet", "transkripsjon", "lokalt", "skal", "ville",
    }
    counts: dict[str, int] = {}
    for keyword in keywords:
        if keyword not in stop:
            counts[keyword] = counts.get(keyword, 0) + 1
    topics = [word.title() for word, _ in sorted(counts.items(), key=lambda item: item[1], reverse=True)[:6]]

    findings: list[str] = []
    if decisions:
        findings.append(f"{len(decisions)} decision{'s' if len(decisions) != 1 else ''}")
    if actions:
        findings.append(f"{len(actions)} action item{'s' if len(actions) != 1 else ''}")
    if risks:
        findings.append(f"{len(risks)} risk or open question{'s' if len(risks) != 1 else ''}")
    summary = {
        "executive_summary": (
            f"Basic extraction identified {', '.join(findings)}. "
            "Install Tara's local intelligence model for a narrative summary."
            if findings
            else "No substantive decisions, action items, or risks were identified by basic extraction."
        ),
        "purpose": "Not identified by basic extraction.",
        "key_discussion_points": evidence_parts[:5],
        "outcomes": [decision["text"] for decision in decisions[:3]],
    }
    return normalize_intelligence({
        "summary": summary,
        "decisions": decisions,
        "action_items": actions,
        "risks": risks,
        "topics": topics,
    }, transcript)


def set_processing_status(meeting_id: int, status: str, error: str | None = None, analysis_source: str | None = None) -> None:
    assignments = ["processing_status = ?", "processing_error = ?", "updated_at = ?"]
    values: list[Any] = [status, error, datetime.now(timezone.utc).isoformat()]
    if analysis_source is not None:
        assignments.append("analysis_source = ?")
        values.append(analysis_source)
    values.append(meeting_id)
    with closing(connect()) as db:
        db.execute(
            f"UPDATE meetings SET {', '.join(assignments)} WHERE id = ?",
            values,
        )
        db.commit()


def fail_processing(meeting_id: int, exc: Exception) -> None:
    if isinstance(exc, MeetingProcessingError):
        set_processing_status(meeting_id, "failed", f"{exc.stage}: {exc.detail}")
        return
    if isinstance(exc, TranscriptionError):
        set_processing_status(meeting_id, "failed", f"transcription: {exc}")
        return
    set_processing_status(meeting_id, "failed", f"processing: {exc}")


def analyze_meeting_content(
    meeting: dict[str, Any],
    notes: list[Note],
) -> tuple[str, dict[str, Any]]:
    template = normalize_template(str(meeting.get("analysis_template") or "general"))
    transcription_settings = meeting.get("transcription_settings") or {
        "model": DEFAULT_WHISPER_MODEL,
        "language": "auto",
        "hotwords": [],
    }
    requested_language = str(transcription_settings.get("language") or "auto")
    transcription_metadata = meeting.get("transcription_metadata") or {}
    detected = [
        item.get("detected_language")
        for item in transcription_metadata.get("sources", [])
        if item.get("detected_language")
    ]
    output_language = {
        "no": "Norwegian",
        "en": "English",
        "mixed": "the same language or language mix as the meeting",
    }.get(requested_language, "Norwegian" if detected and detected[0] == "no" else "English")
    local_result = local_intelligence(
        LOCAL_LLM,
        meeting["transcript"],
        MEETING_TEMPLATES[template],
        output_language,
    )
    source = "local_llm" if local_result else "basic"
    intelligence = local_result or heuristic_intelligence(meeting["transcript"], notes, template)
    return source, intelligence


def persist_analysis(meeting_id: int, source: str, intelligence: dict[str, Any]) -> None:
    with closing(connect()) as db:
        db.execute(
            """
            UPDATE meetings
            SET summary = ?, decisions = ?, action_items = ?, risks = ?, topics = ?,
                processing_status = 'done', processing_error = NULL, analysis_source = ?,
                analysis_version = analysis_version + 1, updated_at = ?
            WHERE id = ?
            """,
            (
                json.dumps(intelligence["summary"]),
                json.dumps(intelligence["decisions"]),
                json.dumps(intelligence["action_items"]),
                json.dumps(intelligence["risks"]),
                json.dumps(intelligence["topics"]),
                source,
                datetime.now(timezone.utc).isoformat(),
                meeting_id,
            ),
        )
        db.commit()


def reanalyze_meeting_content(meeting_id: int) -> None:
    try:
        set_processing_status(meeting_id, "analyzing", analysis_source="pending")
        meeting = get_meeting(meeting_id)
        notes = [Note(**note) for note in meeting["notes"]]
        source, intelligence = analyze_meeting_content(meeting, notes)
        persist_analysis(meeting_id, source, intelligence)
        send_auto_email_profiles(get_meeting(meeting_id))
    except Exception as exc:
        fail_processing(meeting_id, exc)


def process_meeting(meeting_id: int) -> None:
    try:
        set_processing_status(meeting_id, "transcribing", analysis_source="pending")
        meeting = get_meeting(meeting_id)
        notes = [Note(**note) for note in meeting["notes"]]
        try:
            transcription_settings = meeting.get("transcription_settings") or {
                "model": DEFAULT_WHISPER_MODEL,
                "language": "auto",
                "hotwords": [],
            }
            transcript, transcription_metadata = transcribe_audio(
                meeting["audio_file"], meeting.get("audio_sources") or {}, notes, transcription_settings
            )
        except TranscriptionError:
            raise
        except Exception as exc:
            raise MeetingProcessingError("transcription", str(exc)) from exc

        set_processing_status(meeting_id, "analyzing")
        try:
            meeting_for_analysis = {
                **meeting,
                "transcript": transcript,
                "transcription_metadata": transcription_metadata,
            }
            source, intelligence = analyze_meeting_content(meeting_for_analysis, notes)
        except Exception as exc:
            raise MeetingProcessingError("analysis", str(exc)) from exc

        with closing(connect()) as db:
            db.execute(
                """
                UPDATE meetings
                SET transcript = ?, summary = ?, decisions = ?, action_items = ?, risks = ?, topics = ?,
                    processing_status = 'done', processing_error = NULL, analysis_source = ?, transcription_metadata = ?,
                    analysis_version = analysis_version + 1, updated_at = ?
                WHERE id = ?
                """,
                (
                    json.dumps(transcript),
                    json.dumps(intelligence["summary"]),
                    json.dumps(intelligence["decisions"]),
                    json.dumps(intelligence["action_items"]),
                    json.dumps(intelligence["risks"]),
                    json.dumps(intelligence["topics"]),
                    source,
                    json.dumps(transcription_metadata),
                    datetime.now(timezone.utc).isoformat(),
                    meeting_id,
                ),
            )
            db.commit()
        send_auto_email_profiles(get_meeting(meeting_id))
    except Exception as exc:
        fail_processing(meeting_id, exc)


def meeting_markdown(meeting: dict[str, Any]) -> str:
    transcript = "\n".join(
        f"- [{line['start']:.0f}s] **{line['speaker']}**: {line['text']}" for line in meeting["transcript"]
    )
    decisions = "\n".join(
        "\n".join(
            [
                f"- [{float(item.get('timestamp', 0)):.0f}s] {item['text']} ({item.get('confidence', 'medium')})",
                f"  - Evidence: {item.get('quote')}" if item.get("quote") else "",
            ]
        ).strip()
        for item in meeting["decisions"]
    )
    actions = "\n".join(
        "\n".join(
            [
                f"- [{float(item.get('timestamp', 0)):.0f}s] **{item['task']}** | Owner: {item['owner']} | Deadline: {item['deadline']} | Priority: {item['priority']}",
                f"  - Evidence: {item.get('quote')}" if item.get("quote") else "",
            ]
        ).strip()
        for item in meeting["action_items"]
    )
    risks = "\n".join(f"- {risk}" for risk in meeting["risks"])
    topics = "\n".join(f"- {topic}" for topic in meeting["topics"])
    outcomes = "\n".join(f"- {outcome}" for outcome in meeting["summary"].get("outcomes", []))
    return textwrap.dedent(
        f"""
        # {meeting['title']}

        Date: {meeting['date']}
        Duration: {meeting['duration_seconds']} seconds
        Audio: {meeting.get('audio_file') or 'Not saved'}
        Processing: {meeting.get('processing_status')} via {meeting.get('analysis_source')}
        Analysis: v{meeting.get('analysis_version', 1)} / {meeting.get('analysis_template', 'general')}

        ## Executive Summary
        {meeting['summary'].get('executive_summary', '')}

        ## Purpose
        {meeting['summary'].get('purpose', 'Unknown')}

        ## Topics
        {topics or '- None identified'}

        ## Outcomes
        {outcomes or '- None identified'}

        ## Decisions
        {decisions or '- None identified'}

        ## Action Items
        {actions or '- None identified'}

        ## Risks and Open Questions
        {risks or '- None identified'}

        ## Transcript
        {transcript}
        """
    ).strip() + "\n"


def action_items_markdown(meeting: dict[str, Any]) -> str:
    actions = "\n".join(
        "\n".join(
            [
                f"- [ ] **{item['task']}**",
                f"  - Owner: {item['owner']}",
                f"  - Deadline: {item['deadline']}",
                f"  - Priority: {item['priority']}",
                f"  - Source: [{float(item.get('timestamp', 0)):.0f}s] {item.get('quote')}" if item.get("quote") else "",
            ]
        ).strip()
        for item in meeting["action_items"]
    )
    return textwrap.dedent(
        f"""
        # Action Items: {meeting['title']}

        Date: {meeting['date']}
        Analysis: v{meeting.get('analysis_version', 1)} / {meeting.get('analysis_template', 'general')}

        {actions or '- No action items identified'}
        """
    ).strip() + "\n"


def searchable_meeting_text(meeting: dict[str, Any]) -> str:
    return " ".join(
        [
            meeting["title"],
            meeting["summary"].get("executive_summary", ""),
            meeting["summary"].get("purpose", ""),
            " ".join(meeting["summary"].get("key_discussion_points", [])),
            " ".join(meeting["summary"].get("outcomes", [])),
            " ".join(line.get("text", "") for line in meeting["transcript"]),
            " ".join(item.get("text", "") + " " + item.get("quote", "") for item in meeting["decisions"]),
            " ".join(
                " ".join([item.get("task", ""), item.get("owner", ""), item.get("deadline", ""), item.get("quote", "")])
                for item in meeting["action_items"]
            ),
            " ".join(meeting["risks"]),
            " ".join(meeting["topics"]),
            meeting.get("analysis_template", "general"),
            meeting.get("processing_status", ""),
        ]
    ).lower()


def meeting_email_text(meeting: dict[str, Any]) -> str:
    transcript = "\n".join(
        f"[{float(line.get('start', 0)):.0f}s] {line.get('speaker', 'Speaker')}: {line.get('text', '')}"
        for line in meeting["transcript"]
    )
    return textwrap.dedent(
        f"""
        Tara meeting summary

        Title: {meeting['title']}
        Date: {meeting['date']}
        Duration: {meeting['duration_seconds']} seconds

        Summary
        {meeting['summary'].get('executive_summary', '')}

        Transcript
        {transcript or 'No transcript available.'}
        """
    ).strip() + "\n"


def send_meeting_email(meeting: dict[str, Any], to_email: str) -> None:
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", to_email):
        raise HTTPException(status_code=400, detail="Recipient email address is invalid")

    host = os.environ.get("TARA_SMTP_HOST")
    from_email = os.environ.get("TARA_SMTP_FROM")
    if not host or not from_email:
        raise HTTPException(
            status_code=503,
            detail="Email is not configured. Set TARA_SMTP_HOST and TARA_SMTP_FROM.",
        )

    port = int(os.environ.get("TARA_SMTP_PORT", "587"))
    username = os.environ.get("TARA_SMTP_USERNAME")
    password = os.environ.get("TARA_SMTP_PASSWORD")
    use_tls = os.environ.get("TARA_SMTP_TLS", "true").lower() not in {"0", "false", "no"}

    message = EmailMessage()
    message["From"] = from_email
    message["To"] = to_email
    message["Subject"] = f"Tara summary: {meeting['title']}"
    message.set_content(meeting_email_text(meeting))

    try:
        with smtplib.SMTP(host, port, timeout=30) as smtp:
            if use_tls:
                smtp.starttls()
            if username and password:
                smtp.login(username, password)
            smtp.send_message(message)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Email delivery failed: {exc}") from exc


def send_auto_email_profiles(meeting: dict[str, Any]) -> None:
    for profile in email_profiles():
        if not profile["auto_send"] or not profile["to_email"]:
            continue
        try:
            send_meeting_email(meeting, str(profile["to_email"]))
        except Exception as exc:
            print(f"Tara auto-email failed for profile {profile['id']}: {exc}")


def simple_docx(markdown: str) -> bytes:
    escaped = (
        markdown.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .splitlines()
    )
    document = "".join(f"<w:p><w:r><w:t>{line or ' '}</w:t></w:r></w:p>" for line in escaped)
    content_types = """<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>"""
    rels = """<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>"""
    doc = f"""<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>{document}</w:body></w:document>"""
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as archive:
        archive.writestr("[Content_Types].xml", content_types)
        archive.writestr("_rels/.rels", rels)
        archive.writestr("word/document.xml", doc)
    return out.getvalue()


def simple_pdf(markdown: str) -> bytes:
    lines = markdown.replace("(", "[").replace(")", "]").splitlines()[:45]
    text_commands = ["BT /F1 10 Tf 50 790 Td"]
    for index, line in enumerate(lines):
        escaped = line.replace("\\", "\\\\")
        text_commands.append(f"0 -14 Td ({escaped[:95]}) Tj")
    text_commands.append("ET")
    stream = "\n".join(text_commands).encode("latin-1", errors="ignore")
    objects = [
        b"1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
        b"2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
        b"3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj",
        b"4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj",
        b"5 0 obj << /Length " + str(len(stream)).encode() + b" >> stream\n" + stream + b"\nendstream endobj",
    ]
    pdf = io.BytesIO()
    pdf.write(b"%PDF-1.4\n")
    offsets = [0]
    for obj in objects:
        offsets.append(pdf.tell())
        pdf.write(obj + b"\n")
    xref = pdf.tell()
    pdf.write(f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode())
    for offset in offsets[1:]:
        pdf.write(f"{offset:010d} 00000 n \n".encode())
    pdf.write(f"trailer << /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF".encode())
    return pdf.getvalue()


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "ok": True,
        "desktop_instance_id": os.environ.get("TARA_DESKTOP_INSTANCE_ID"),
        "database": str(DB_PATH),
        "transcription": transcription_diagnostics(),
        "analysis": analysis_diagnostics(),
        "email": email_diagnostics(),
        "security": security_diagnostics(),
    }


@app.get("/settings")
def read_settings() -> dict[str, Any]:
    return get_settings()


@app.patch("/settings")
def update_settings(payload: SettingsUpdate) -> dict[str, Any]:
    return save_settings(payload)


@app.get("/models/intelligence")
def intelligence_model_status() -> dict[str, Any]:
    return LOCAL_LLM.status()


@app.post("/models/intelligence/install")
def install_intelligence_model(background_tasks: BackgroundTasks) -> dict[str, Any]:
    if not LOCAL_LLM.status()["runtime_available"]:
        raise HTTPException(status_code=503, detail="The bundled local intelligence runtime is unavailable.")
    if LOCAL_LLM.status()["model_installed"]:
        return LOCAL_LLM.status()
    background_tasks.add_task(LOCAL_LLM.install_model)
    status = LOCAL_LLM.status()
    status["install_state"] = "downloading"
    return status


@app.delete("/models/intelligence")
def remove_intelligence_model() -> dict[str, Any]:
    LOCAL_LLM.remove_model()
    return LOCAL_LLM.status()


@app.post("/audio")
async def upload_audio(file: UploadFile = File(...)) -> dict[str, Any]:
    extension = {
        "audio/webm": ".webm",
        "audio/mp4": ".mp4",
        "audio/mpeg": ".mp3",
        "audio/wav": ".wav",
        "audio/x-wav": ".wav",
    }.get(file.content_type or "", ".webm")
    filename = f"{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')}-{uuid.uuid4().hex}{extension}"
    audio_path = RECORDINGS_DIR / filename

    size = 0
    with audio_path.open("wb") as output:
        while chunk := await file.read(1024 * 1024):
            size += len(chunk)
            output.write(chunk)

    if size == 0:
        audio_path.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail="Uploaded audio file was empty")

    return {"path": str(audio_path), "size": size, "content_type": file.content_type}


@app.get("/meetings")
def list_meetings() -> dict[str, Any]:
    with closing(connect()) as db:
        rows = db.execute("SELECT * FROM meetings ORDER BY date DESC").fetchall()
    return {"meetings": [row_to_meeting(row) for row in rows]}


@app.get("/meetings/search")
def search_meetings(q: str = "", status: str = "all") -> dict[str, Any]:
    with closing(connect()) as db:
        rows = db.execute("SELECT * FROM meetings ORDER BY date DESC").fetchall()
    meetings = [row_to_meeting(row) for row in rows]
    needle = q.strip().lower()
    if needle:
        meetings = [meeting for meeting in meetings if needle in searchable_meeting_text(meeting)]
    if status == "processing":
        meetings = [meeting for meeting in meetings if meeting["processing_status"] in {"queued", "transcribing", "analyzing"}]
    elif status in {"done", "failed"}:
        meetings = [meeting for meeting in meetings if meeting["processing_status"] == status]
    return {"meetings": meetings, "count": len(meetings)}


@app.get("/analysis/templates")
def list_analysis_templates() -> dict[str, Any]:
    return {
        "templates": [
            {"id": template_id, "label": template_id.replace("_", " ").title(), "description": description}
            for template_id, description in MEETING_TEMPLATES.items()
        ]
    }


@app.post("/meetings")
def create_meeting(payload: MeetingCreate, background_tasks: BackgroundTasks) -> dict[str, Any]:
    created_at = datetime.now(timezone.utc).isoformat()
    analysis_template = normalize_template(payload.analysis_template)
    saved_settings = get_settings()
    transcription_settings = {
        "model": payload.transcription_model or saved_settings["transcription_model"],
        "language": payload.transcription_language or saved_settings["transcription_language"],
        "hotwords": (
            payload.transcription_hotwords
            if payload.transcription_hotwords is not None
            else saved_settings["transcription_hotwords"]
        ),
    }
    audio_file = payload.audio_file or payload.audio_sources.get("mixed")

    with closing(connect()) as db:
        cursor = db.execute(
            """
            INSERT INTO meetings (
              title, date, duration_seconds, participants, transcript, summary, decisions,
              action_items, risks, topics, notes, bookmarks, audio_file, audio_sources,
              transcription_settings, transcription_metadata, processing_status, processing_error,
              analysis_source, updated_at, analysis_template, analysis_version
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                payload.title,
                created_at,
                payload.duration_seconds,
                json.dumps(payload.participants),
                json.dumps([]),
                json.dumps({"executive_summary": "Processing meeting audio.", "purpose": "", "key_discussion_points": [], "outcomes": []}),
                json.dumps([]),
                json.dumps([]),
                json.dumps([]),
                json.dumps([]),
                json.dumps([note.model_dump() for note in payload.notes]),
                json.dumps([bookmark.model_dump() for bookmark in payload.bookmarks]),
                audio_file,
                json.dumps(payload.audio_sources),
                json.dumps(transcription_settings),
                json.dumps({}),
                "queued",
                None,
                "pending",
                created_at,
                analysis_template,
                0,
            ),
        )
        db.commit()
        row = db.execute("SELECT * FROM meetings WHERE id = ?", (cursor.lastrowid,)).fetchone()
    meeting = row_to_meeting(row)
    background_tasks.add_task(process_meeting, meeting["id"])
    return meeting


@app.get("/meetings/{meeting_id}")
def get_meeting(meeting_id: int) -> dict[str, Any]:
    with closing(connect()) as db:
        row = db.execute("SELECT * FROM meetings WHERE id = ?", (meeting_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Meeting not found")
    return row_to_meeting(row)


@app.get("/meetings/{meeting_id}/processing")
def get_processing_status(meeting_id: int) -> dict[str, Any]:
    meeting = get_meeting(meeting_id)
    return {
        "id": meeting["id"],
        "processing_status": meeting["processing_status"],
        "processing_error": meeting["processing_error"],
        "analysis_source": meeting["analysis_source"],
        "updated_at": meeting["updated_at"],
        "can_reprocess": bool(meeting.get("audio_file") or meeting.get("audio_sources") or meeting.get("notes")),
        "transcription_metadata": meeting.get("transcription_metadata") or {},
    }


@app.get("/meetings/{meeting_id}/audio/{source}")
def meeting_audio(meeting_id: int, source: str) -> FileResponse:
    meeting = get_meeting(meeting_id)
    sources = dict(meeting.get("audio_sources") or {})
    if meeting.get("audio_file"):
        sources.setdefault("mixed", meeting["audio_file"])
    audio_path_value = sources.get(source)
    if not audio_path_value:
        raise HTTPException(status_code=404, detail="Requested recording source is unavailable")
    audio_path = Path(audio_path_value).resolve()
    if not audio_path.is_file():
        raise HTTPException(status_code=404, detail="Recorded audio file was not found")
    allowed_roots = [RECORDINGS_DIR.resolve(), (DATA_DIR.parent / "recordings").resolve()]
    if not any(root == audio_path.parent or root in audio_path.parents for root in allowed_roots):
        raise HTTPException(status_code=403, detail="Recording path is outside Tara storage")
    media_type = "audio/mp4" if audio_path.suffix.lower() == ".mp4" else "audio/webm"
    return FileResponse(audio_path, media_type=media_type, filename=audio_path.name)


@app.patch("/meetings/{meeting_id}")
def update_meeting(meeting_id: int, payload: MeetingUpdate) -> dict[str, Any]:
    existing = get_meeting(meeting_id)
    updates: dict[str, Any] = {}
    if payload.title is not None:
        updates["title"] = payload.title
    if payload.transcript is not None:
        updates["transcript"] = json.dumps([line.model_dump() for line in payload.transcript])
    if payload.decisions is not None:
        updates["decisions"] = json.dumps(payload.decisions)
    if payload.action_items is not None:
        updates["action_items"] = json.dumps(payload.action_items)
    if payload.notes is not None:
        updates["notes"] = json.dumps([note.model_dump() for note in payload.notes])
    if payload.bookmarks is not None:
        updates["bookmarks"] = json.dumps([bookmark.model_dump() for bookmark in payload.bookmarks])
    if payload.analysis_template is not None:
        updates["analysis_template"] = normalize_template(payload.analysis_template)
    if not updates:
        return existing
    updates["updated_at"] = datetime.now(timezone.utc).isoformat()
    assignments = ", ".join(f"{key} = ?" for key in updates)
    with closing(connect()) as db:
        db.execute(f"UPDATE meetings SET {assignments} WHERE id = ?", (*updates.values(), meeting_id))
        db.commit()
    return get_meeting(meeting_id)


@app.post("/meetings/{meeting_id}/reprocess")
def reprocess_meeting(
    meeting_id: int,
    background_tasks: BackgroundTasks,
    payload: ReprocessRequest | None = None,
) -> dict[str, Any]:
    meeting = get_meeting(meeting_id)
    if meeting["processing_status"] in {"queued", "transcribing", "analyzing"}:
        raise HTTPException(status_code=409, detail="Meeting is already processing")
    if not meeting.get("audio_file") and not meeting.get("audio_sources") and not meeting.get("notes"):
        raise HTTPException(status_code=409, detail="Meeting has no audio or notes to reprocess")
    if payload:
        settings = dict(meeting.get("transcription_settings") or {})
        updates = payload.model_dump(exclude_none=True)
        if "transcription_model" in updates:
            settings["model"] = updates["transcription_model"]
        if "transcription_language" in updates:
            settings["language"] = updates["transcription_language"]
        if "transcription_hotwords" in updates:
            settings["hotwords"] = updates["transcription_hotwords"]
        with closing(connect()) as db:
            db.execute(
                "UPDATE meetings SET transcription_settings = ?, updated_at = ? WHERE id = ?",
                (json.dumps(settings), datetime.now(timezone.utc).isoformat(), meeting_id),
            )
            db.commit()
    set_processing_status(meeting_id, "queued", analysis_source="pending")
    background_tasks.add_task(process_meeting, meeting_id)
    return get_meeting(meeting_id)


@app.post("/meetings/{meeting_id}/reanalyze")
def reanalyze_meeting(meeting_id: int, background_tasks: BackgroundTasks) -> dict[str, Any]:
    meeting = get_meeting(meeting_id)
    if meeting["processing_status"] in {"queued", "transcribing", "analyzing"}:
        raise HTTPException(status_code=409, detail="Meeting is already processing")
    if not meeting.get("transcript") and not meeting.get("notes"):
        raise HTTPException(status_code=409, detail="Meeting has no transcript or notes to analyze")
    set_processing_status(meeting_id, "analyzing", analysis_source="pending")
    background_tasks.add_task(reanalyze_meeting_content, meeting_id)
    return get_meeting(meeting_id)


@app.post("/meetings/{meeting_id}/chat")
def chat(meeting_id: int, payload: ChatRequest) -> dict[str, Any]:
    meeting = get_meeting(meeting_id)
    local_answer = local_grounded_answer(LOCAL_LLM, meeting["transcript"], payload.question)
    if local_answer:
        return local_answer
    body = " ".join(line["text"] for line in meeting["transcript"]).lower()
    question_terms = [term for term in re.findall(r"\w+", payload.question.lower()) if len(term) > 3]
    matches = [
        line
        for line in meeting["transcript"]
        if any(term in line["text"].lower() for term in question_terms)
    ]
    if not body.strip():
        answer = "I do not have enough meeting content to answer that."
    elif matches:
        answer = "Basic search found these relevant transcript excerpts: " + " ".join(line["text"] for line in matches[:4])
    else:
        answer = "I could not find direct support for that in the meeting content."
    return {
        "answer": answer,
        "citations": [
            {"timestamp": line.get("start", 0), "speaker": line.get("speaker", "Speaker"), "quote": line.get("text", "")}
            for line in matches[:4]
        ],
    }


@app.post("/meetings/{meeting_id}/email")
def email_meeting(meeting_id: int, payload: MeetingEmailRequest) -> dict[str, Any]:
    meeting = get_meeting(meeting_id)
    if meeting["processing_status"] != "done":
        raise HTTPException(status_code=409, detail="Meeting must finish processing before it can be emailed")
    to_email, profile_id = resolve_email_recipient(payload)
    send_meeting_email(meeting, to_email)
    return {"ok": True, "to_email": to_email, "profile_id": profile_id}


@app.get("/meetings/{meeting_id}/export/{format}")
def export_meeting(meeting_id: int, format: Literal["markdown", "actions", "docx", "pdf"]) -> Response:
    meeting = get_meeting(meeting_id)
    filename = re.sub(r"[^A-Za-z0-9]+", "-", meeting["title"]).strip("-").lower() or "meeting"
    markdown = action_items_markdown(meeting) if format == "actions" else meeting_markdown(meeting)
    if format == "markdown":
        return Response(
            markdown,
            media_type="text/markdown",
            headers={"Content-Disposition": f'attachment; filename="{filename}.md"'},
        )
    if format == "actions":
        return Response(
            markdown,
            media_type="text/markdown",
            headers={"Content-Disposition": f'attachment; filename="{filename}-action-items.md"'},
        )
    if format == "docx":
        return Response(
            simple_docx(markdown),
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            headers={"Content-Disposition": f'attachment; filename="{filename}.docx"'},
        )
    return Response(
        simple_pdf(markdown),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}.pdf"'},
    )


if (DIST_DIR / "assets").exists():
    app.mount("/assets", StaticFiles(directory=DIST_DIR / "assets"), name="assets")


@app.get("/{path:path}")
def web_app(path: str) -> FileResponse:
    requested = (DIST_DIR / path).resolve()
    if DIST_DIR.exists() and requested.is_file() and DIST_DIR in requested.parents:
        return FileResponse(requested)

    index = DIST_DIR / "index.html"
    if index.exists():
        return FileResponse(index)

    raise HTTPException(status_code=404, detail="Tara web build not found. Run npm run build first.")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        app,
        host=os.environ.get("TARA_API_HOST", "127.0.0.1"),
        port=int(os.environ.get("TARA_API_PORT", os.environ.get("PORT", "8765"))),
        reload=False,
    )
