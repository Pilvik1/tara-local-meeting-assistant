# Tara Architecture

## Objective

Tara is a local-first Windows desktop application for recording meetings,
transcribing audio, generating evidence-linked meeting intelligence, and keeping
a searchable local archive.

## Runtime topology

```text
Electron main process
  ├─ starts the bundled FastAPI executable
  ├─ grants trusted-origin microphone / loopback capture permissions
  ├─ writes audio through a narrow IPC bridge
  └─ loads the static Vite renderer

React renderer ──HTTP on 127.0.0.1──> FastAPI backend
                                            ├─ SQLite
                                            ├─ faster-whisper / CTranslate2
                                            ├─ llama.cpp / optional Qwen GGUF
                                            └─ Markdown, DOCX and PDF export
```

The packaged backend and renderer are local processes. The backend binds to
`127.0.0.1:8765` by default.

## Electron trust boundary

- `contextIsolation` and renderer sandboxing are enabled.
- renderer Node.js integration is disabled.
- `electron/preload.cjs` exposes only platform identification and a `saveAudio`
  IPC call.
- new windows and untrusted navigation are denied.
- media permissions are accepted only for packaged `file://` content or the
  loopback Vite development origin.
- the main process sanitizes filenames and stores recordings in Electron's
  per-user Tara data directory.
- each packaged launch generates a high-entropy API token and instance identity;
  Electron adds the token to renderer API requests and verifies it is connected
  to the backend process it launched.

## Capture

Microphone capture uses `getUserMedia`. Windows system audio uses Electron's
display-media handler and WASAPI loopback. **Both** mode keeps microphone and
system audio as separate synchronized recordings and also creates a listening
mix for immediate review.

The renderer reports live input levels and saves recordings only when the user
explicitly starts a session. Windows loopback records all system audio during the
session.

## Backend and persistence

FastAPI owns persistence and processing authority. SQLite stores meetings,
transcript segments, summaries, decisions, actions, risks, topics, notes,
bookmarks, settings, processing provenance, and source-audio paths.

Audio responses are limited to files under Tara-controlled recording roots. The
backend supports optional non-loopback development binding, but its diagnostics
warn when external binding lacks web authentication or restrictive CORS.

## Transcription

Tara uses `faster-whisper` with CPU/int8 defaults:

- Fast: `small`;
- Best: `large-v3-turbo`;
- language: Auto, Norwegian, English, or Mixed;
- Silero VAD, word timestamps, confidence metadata, and custom hotwords.

Microphone and system tracks are transcribed separately and merged by timestamp.
The current decode profile uses greedy decoding for lower latency. Low-confidence
or empty VAD output is retried without VAD before the meeting fails.

Whisper-compatible model weights are downloaded on first use into Tara's local
model directory and reused offline.

## Local meeting intelligence

The Windows package contains a pinned, checksum-verified CPU build of llama.cpp.
The optional Qwen3-4B Q4_K_M GGUF is downloaded only after an explicit user
action, verified against a pinned SHA-256 digest, and stored locally with its
license when available.

Long transcripts are processed in timestamped chunks. The local model returns
structured JSON for summaries, decisions, actions, risks, topics, and Q&A. A
deterministic validator requires exact transcript evidence, rejects unsupported
claims, and strips invented owners or deadlines. Transcript lines that resemble
prompt-injection instructions are excluded from model context and evidence.

When the local model is absent, Tara exposes a clearly labelled deterministic
basic-extraction mode. There is no hosted-AI fallback.

## Explicit external paths

The normal desktop path is local after models are installed. External network
activity is limited to:

- GitHub release downloads;
- Whisper-compatible and Qwen model downloads;
- optional SMTP delivery configured by the operator.

SMTP delivery sends meeting text outside the device and is disabled unless
environment configuration is present.

## Packaging and release

GitHub Actions on Windows:

1. installs and audits Node/Python dependencies;
2. runs backend and renderer tests;
3. builds the static production renderer;
4. freezes the backend with PyInstaller;
5. installs the pinned llama.cpp runtime and verifies its archive hash;
6. starts the frozen backend and verifies capabilities plus restart persistence;
7. builds NSIS installer and portable executables;
8. publishes checksums and an SPDX SBOM for tags.

The optional Qwen and Whisper weights are not embedded in the installer.

## Known architectural limits

- no application-level encryption for recordings or SQLite;
- no automatic updates or release signing yet;
- no individual diarization of remote participants;
- no live transcription;
- Windows is the only proven system-audio release target.
